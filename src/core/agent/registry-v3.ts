import type { ChartConfig } from '../chart-config.ts';
import {
  AGENT_ADAPTERS,
  AGENT_BOUNDS,
  AGENT_COMPATIBILITY_VERSIONS,
  AGENT_CONTRACT_VERSION,
  AGENT_SCOPES,
  type AGENT_V3_TOOL_SCOPES,
  type AgentErrorCode,
  type AgentResultMeta,
  type AgentScope,
  type AgentV3Result,
  DEFERRED_AGENT_TOOLS,
} from './contract.ts';
import { describeToMarkdown } from './data-dictionary.ts';
import type {
  AgentHost,
  AgentToolAnnotations,
  DescribeResult,
  JsonSchema,
  QueryResult,
} from './registry.ts';

export type AgentArtifactKind = 'naklidata' | 'portable-semantic-model' | 'data-quality-assertion';

export interface AgentArtifactValidation {
  kind: AgentArtifactKind;
  valid: boolean;
  errors: string[];
  summary: Record<string, unknown>;
}

export interface AgentAffectedObject {
  kind: 'source' | 'table' | 'cell';
  id: string;
  label: string;
}

export interface AgentProposalResult {
  proposalType: 'sql-cell' | 'chart' | 'quality-check';
  createdCell: {
    id: string;
    kind: 'sql' | 'chart' | 'assertion';
    status: 'un-run';
  };
  preview: Record<string, unknown>;
  affectedObjects: AgentAffectedObject[];
  warnings: string[];
  editable: true;
  humanAction: string;
}

export interface AgentChartProposalInput {
  inputCellId: string;
  config: ChartConfig;
}

export interface AgentV3Host extends AgentHost {
  getLineage(): unknown;
  validateArtifact(kind: AgentArtifactKind, artifact: unknown): Promise<AgentArtifactValidation>;
  proposeSqlCell(sql: string, signal: AbortSignal): Promise<AgentProposalResult>;
  proposeChart(input: AgentChartProposalInput, signal: AbortSignal): Promise<AgentProposalResult>;
  proposeQualityCheck(check: unknown, signal: AbortSignal): Promise<AgentProposalResult>;
}

export interface AgentV3ToolExecution<T = unknown> {
  data: T;
  meta: Omit<AgentResultMeta, 'provenance'> & {
    provenance: Omit<AgentResultMeta['provenance'], 'workspaceRevision'>;
  };
}

export interface AgentV3Tool {
  name: string;
  description: string;
  scope: AgentScope;
  inputSchema: JsonSchema;
  annotations: AgentToolAnnotations;
  execute(input: unknown, signal: AbortSignal): Promise<AgentV3ToolExecution>;
}

export interface AgentV3DispatchContext {
  workspaceRevision: number;
  readWorkspaceRevision?: () => number;
  signal: AbortSignal;
  permissionGranted: boolean;
}

class AgentV3Fault extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function buildAgentV3Tools(host: AgentV3Host): AgentV3Tool[] {
  const tools: AgentV3Tool[] = [
    metadataTool(
      'describe',
      'Describe mounted tables, columns, semantics, sensitivity, and source provenance.',
      async (_input, signal) => {
        const data = await host.describe(signal);
        return describeExecution(data);
      },
    ),
    metadataTool(
      'listTables',
      'List mounted tables with stable source and table ownership.',
      async () => {
        const data = await host.listTables();
        return execution(data, {
          sourceIds: data.map((table) => table.sourceId),
          tableIds: data.map((table) => table.tableId),
          untrustedContent: true,
        });
      },
    ),
    metadataTool(
      'listCells',
      'List notebook cells and editable source code, never result rows.',
      async () => execution(await host.listCells(), { untrustedContent: true }),
    ),
    metadataTool(
      'getCapabilities',
      'Return contract versions, scopes, adapters, bounds, tools, and deferred capabilities.',
      async () =>
        execution(
          {
            contractVersion: AGENT_CONTRACT_VERSION,
            compatibilityVersions: AGENT_COMPATIBILITY_VERSIONS,
            scopes: AGENT_SCOPES,
            adapters: AGENT_ADAPTERS,
            bounds: AGENT_BOUNDS,
            tools: tools.map(({ name, description, scope, inputSchema, annotations }) => ({
              name,
              description,
              scope,
              inputSchema,
              annotations,
            })),
            deferredTools: DEFERRED_AGENT_TOOLS,
            executionScope: null,
          },
          {},
        ),
    ),
    metadataTool(
      'getLineage',
      'Return the current source → cell → sink lineage graph without row values.',
      async () => execution(host.getLineage(), { untrustedContent: true }),
    ),
    metadataTool(
      'exportDataDictionary',
      'Render the same sensitivity-aware semantic description used by the schema surface as Markdown.',
      async (_input, signal) => {
        const described = await host.describe(signal);
        return {
          ...describeExecution(described),
          data: { format: 'markdown', text: describeToMarkdown(described) },
        };
      },
    ),
    metadataTool(
      'validateArtifact',
      'Validate a .naklidata workbook, portable semantic model, or tagged data-quality assertion without mutating the workspace.',
      async (input) => {
        const record = objectInput(input, 'validateArtifact');
        const kind = record.kind;
        if (
          kind !== 'naklidata' &&
          kind !== 'portable-semantic-model' &&
          kind !== 'data-quality-assertion'
        ) {
          throw new AgentV3Fault(
            'invalid_input',
            'validateArtifact expects kind to be naklidata, portable-semantic-model, or data-quality-assertion.',
          );
        }
        if (!Object.hasOwn(record, 'artifact')) {
          throw new AgentV3Fault('invalid_input', 'validateArtifact expects an artifact field.');
        }
        const bytes = artifactBytes(record.artifact);
        if (bytes > AGENT_BOUNDS.artifactBytes) {
          throw new AgentV3Fault(
            'validation_failed',
            `Artifact exceeds the ${AGENT_BOUNDS.artifactBytes}-byte validation limit.`,
          );
        }
        return execution(await host.validateArtifact(kind, record.artifact), {
          untrustedContent: true,
        });
      },
      {
        type: 'object',
        properties: {
          kind: {
            enum: ['naklidata', 'portable-semantic-model', 'data-quality-assertion'],
          },
          artifact: {},
        },
        required: ['kind', 'artifact'],
        additionalProperties: false,
      },
    ),
    {
      name: 'query',
      description:
        'Run one bounded, read-only, direct-projection SELECT over one uniquely owned mounted table. Requires values:read; non-public values are redacted.',
      scope: 'values:read',
      inputSchema: {
        type: 'object',
        properties: { sql: { type: 'string' } },
        required: ['sql'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true, gated: true },
      execute: async (input, signal) => {
        const sql = stringField(input, 'sql');
        if (sql === null) {
          throw new AgentV3Fault('invalid_input', 'query expects { sql: string }.');
        }
        const data = await host.query(sql, signal);
        return queryExecution(data);
      },
    },
    proposalTool(
      'proposeSqlCell',
      'Add one editable SQL cell in the idle state. The tool never runs the cell.',
      async (input, signal) => {
        const sql = stringField(input, 'sql');
        if (sql === null || !sql.trim()) {
          throw new AgentV3Fault('invalid_input', 'proposeSqlCell expects { sql: string }.');
        }
        enforceProposalBytes(sql);
        return proposalExecution(await host.proposeSqlCell(sql, signal));
      },
      {
        type: 'object',
        properties: { sql: { type: 'string', minLength: 1 } },
        required: ['sql'],
        additionalProperties: false,
      },
    ),
    proposalTool(
      'proposeChart',
      'Add one editable chart cell against an existing result cell. Exact column ownership is validated and the chart is never executed.',
      async (input, signal) => {
        const record = objectInput(input, 'proposeChart');
        const inputCellId = record.inputCellId;
        if (typeof inputCellId !== 'string' || !inputCellId.trim()) {
          throw new AgentV3Fault('invalid_input', 'proposeChart expects a non-empty inputCellId.');
        }
        const config = chartConfig(record.config);
        return proposalExecution(
          await host.proposeChart({ inputCellId: inputCellId.trim(), config }, signal),
        );
      },
      {
        type: 'object',
        properties: {
          inputCellId: { type: 'string', minLength: 1 },
          config: {
            type: 'object',
            properties: {
              chartType: {
                enum: ['bar', 'line', 'area', 'scatter', 'pie', 'histogram', 'stat', 'table'],
              },
              xColumn: { type: ['string', 'null'] },
              yColumn: { type: ['string', 'null'] },
              groupColumn: { type: ['string', 'null'] },
              title: { type: 'string', minLength: 1, maxLength: 80 },
            },
            required: ['chartType', 'xColumn', 'yColumn', 'groupColumn', 'title'],
            additionalProperties: false,
          },
        },
        required: ['inputCellId', 'config'],
        additionalProperties: false,
      },
    ),
    proposalTool(
      'proposeQualityCheck',
      'Validate a portable data-quality check and add it as one tagged, editable assertion cell. The tool never runs the check.',
      async (input, signal) => {
        const record = objectInput(input, 'proposeQualityCheck');
        if (!Object.hasOwn(record, 'check')) {
          throw new AgentV3Fault('invalid_input', 'proposeQualityCheck expects a check object.');
        }
        enforceProposalBytes(record.check);
        return proposalExecution(await host.proposeQualityCheck(record.check, signal));
      },
      {
        type: 'object',
        properties: { check: { type: 'object' } },
        required: ['check'],
        additionalProperties: false,
      },
    ),
  ];
  return tools;
}

export async function dispatchAgentV3Tool(
  tools: AgentV3Tool[],
  name: string,
  input: unknown,
  context: AgentV3DispatchContext,
): Promise<AgentV3Result> {
  const tool = tools.find((candidate) => candidate.name === name);
  const scope = tool?.scope ?? 'metadata:read';
  if (!tool) {
    return failure(
      name,
      scope,
      context.workspaceRevision,
      'unknown_tool',
      `Unknown v3 tool "${name}".`,
      false,
    );
  }
  if (!context.permissionGranted) {
    return failure(
      name,
      scope,
      context.workspaceRevision,
      'permission_denied',
      `Agent access requires the per-tab "${scope}" grant.`,
      false,
    );
  }
  try {
    const executed = await tool.execute(input, context.signal);
    if (workspaceChanged(context)) {
      return failure(
        name,
        scope,
        context.workspaceRevision,
        'workspace_changed',
        'The workspace changed while the agent request was running. Re-ground before retrying.',
        true,
      );
    }
    if (context.signal.aborted) {
      return failure(
        name,
        scope,
        context.workspaceRevision,
        'cancelled',
        'Agent request was cancelled.',
        true,
      );
    }
    return {
      version: AGENT_CONTRACT_VERSION,
      ok: true,
      tool: name,
      scope,
      data: executed.data,
      meta: {
        ...executed.meta,
        provenance: {
          workspaceRevision: context.workspaceRevision,
          ...executed.meta.provenance,
        },
      },
    };
  } catch (error) {
    if (workspaceChanged(context)) {
      return failure(
        name,
        scope,
        context.workspaceRevision,
        'workspace_changed',
        'The workspace changed while the agent request was running. Re-ground before retrying.',
        true,
      );
    }
    const mapped = mapError(error, context.signal);
    return failure(
      name,
      scope,
      context.workspaceRevision,
      mapped.code,
      mapped.message,
      mapped.retryable,
    );
  }
}

function workspaceChanged(context: AgentV3DispatchContext): boolean {
  return (
    (context.readWorkspaceRevision?.() ?? context.workspaceRevision) !== context.workspaceRevision
  );
}

function metadataTool(
  name: keyof typeof AGENT_V3_TOOL_SCOPES,
  description: string,
  run: (input: unknown, signal: AbortSignal) => Promise<AgentV3ToolExecution>,
  inputSchema: JsonSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
): AgentV3Tool {
  return {
    name,
    description,
    scope: 'metadata:read',
    inputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true, gated: false },
    execute: run,
  };
}

function proposalTool(
  name: keyof typeof AGENT_V3_TOOL_SCOPES,
  description: string,
  run: (input: unknown, signal: AbortSignal) => Promise<AgentV3ToolExecution>,
  inputSchema: JsonSchema,
): AgentV3Tool {
  return {
    name,
    description,
    scope: 'workspace:propose',
    inputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true, gated: true },
    execute: run,
  };
}

function describeExecution(data: DescribeResult): AgentV3ToolExecution<DescribeResult> {
  return execution(data, {
    sourceIds: data.tables.map((table) => table.sourceId),
    tableIds: data.tables.map((table) => table.tableId),
    untrustedContent: true,
    redactedColumnNames: data.tables.flatMap((table) =>
      table.columns
        .filter((column) => column.sensitivity !== 'public')
        .map((column) => `${table.name}.${column.name}`),
    ),
  });
}

function queryExecution(data: QueryResult): AgentV3ToolExecution<QueryResult> {
  return execution(data, {
    sourceIds: data.sourceId ? [data.sourceId] : [],
    tableIds: data.tableId ? [data.tableId] : [],
    untrustedContent: true,
    rowLimit: AGENT_BOUNDS.queryRows,
    rowsReturned: data.rowCount,
    truncated: data.truncated ?? data.rowCount >= AGENT_BOUNDS.queryRows,
    redactedColumnNames: data.redactedColumns,
  });
}

function proposalExecution(data: AgentProposalResult): AgentV3ToolExecution<AgentProposalResult> {
  return execution(data, {
    sourceIds: data.affectedObjects.filter((item) => item.kind === 'source').map((item) => item.id),
    tableIds: data.affectedObjects.filter((item) => item.kind === 'table').map((item) => item.id),
    untrustedContent: true,
  });
}

function execution<T>(
  data: T,
  options: {
    sourceIds?: string[];
    tableIds?: string[];
    untrustedContent?: boolean;
    rowLimit?: number;
    rowsReturned?: number;
    truncated?: boolean;
    redactedColumnNames?: string[];
  },
): AgentV3ToolExecution<T> {
  const redactedColumns = unique(options.redactedColumnNames ?? []);
  return {
    data,
    meta: {
      provenance: {
        sourceIds: unique(options.sourceIds ?? []),
        tableIds: unique(options.tableIds ?? []),
      },
      bounds: {
        rowLimit: options.rowLimit ?? null,
        rowsReturned: options.rowsReturned ?? null,
        truncated: options.truncated ?? false,
      },
      redaction: {
        applied: redactedColumns.length > 0,
        columns: redactedColumns,
        policy: redactedColumns.length > 0 ? 'semantic-sensitivity-v1' : 'none',
      },
      untrustedContent: options.untrustedContent ?? false,
    },
  };
}

function failure(
  tool: string,
  scope: AgentScope,
  workspaceRevision: number,
  code: AgentErrorCode,
  message: string,
  retryable: boolean,
): AgentV3Result {
  return {
    version: AGENT_CONTRACT_VERSION,
    ok: false,
    tool,
    scope,
    error: { code, message: boundedMessage(message), retryable },
    meta: {
      provenance: { workspaceRevision, sourceIds: [], tableIds: [] },
      bounds: { rowLimit: null, rowsReturned: null, truncated: false },
      redaction: { applied: false, columns: [], policy: 'none' },
      untrustedContent: false,
    },
  };
}

function mapError(
  error: unknown,
  signal: AbortSignal,
): { code: AgentErrorCode; message: string; retryable: boolean } {
  if (signal.aborted) {
    return { code: 'cancelled', message: 'Agent request was cancelled.', retryable: true };
  }
  if (error instanceof AgentV3Fault) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/refused|read-only|not allowed|must use select|mounted table|projection/i.test(message)) {
    return { code: 'safety_refusal', message, retryable: false };
  }
  if (/malformed|invalid|expects|required|missing|exceeds/i.test(message)) {
    return { code: 'validation_failed', message, retryable: false };
  }
  return { code: 'internal_error', message: 'Agent tool failed safely.', retryable: false };
}

function objectInput(input: unknown, tool: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentV3Fault('invalid_input', `${tool} expects an object.`);
  }
  return input as Record<string, unknown>;
}

function stringField(input: unknown, key: string): string | null {
  if (input === null || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function artifactBytes(artifact: unknown): number {
  try {
    const text = typeof artifact === 'string' ? artifact : JSON.stringify(artifact);
    if (text === undefined) {
      throw new AgentV3Fault('invalid_input', 'Artifact must be JSON-compatible.');
    }
    return new TextEncoder().encode(text).byteLength;
  } catch (error) {
    if (error instanceof AgentV3Fault) throw error;
    throw new AgentV3Fault('invalid_input', 'Artifact must be finite JSON-compatible data.');
  }
}

function enforceProposalBytes(value: unknown): void {
  if (artifactBytes(value) > AGENT_BOUNDS.proposalCodeBytes) {
    throw new AgentV3Fault(
      'validation_failed',
      `Proposal exceeds the ${AGENT_BOUNDS.proposalCodeBytes}-byte limit.`,
    );
  }
}

function chartConfig(value: unknown): ChartConfig {
  const record = objectInput(value, 'proposeChart.config');
  const chartType = record.chartType;
  const title = record.title;
  const nullableColumn = (name: 'xColumn' | 'yColumn' | 'groupColumn'): string | null => {
    const column = record[name];
    if (column !== null && typeof column !== 'string') {
      throw new AgentV3Fault(
        'invalid_input',
        `proposeChart.config.${name} must be a string or null.`,
      );
    }
    return column;
  };
  if (
    chartType !== 'bar' &&
    chartType !== 'line' &&
    chartType !== 'area' &&
    chartType !== 'scatter' &&
    chartType !== 'pie' &&
    chartType !== 'histogram' &&
    chartType !== 'stat' &&
    chartType !== 'table'
  ) {
    throw new AgentV3Fault('invalid_input', 'proposeChart.config.chartType is unsupported.');
  }
  if (typeof title !== 'string') {
    throw new AgentV3Fault('invalid_input', 'proposeChart.config.title must be a string.');
  }
  return {
    chartType,
    xColumn: nullableColumn('xColumn'),
    yColumn: nullableColumn('yColumn'),
    groupColumn: nullableColumn('groupColumn'),
    title,
  };
}

function boundedMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Agent tool failed safely.';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
