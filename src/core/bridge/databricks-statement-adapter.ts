import { validateReadOnlySql } from '../agent/sql-validator.ts';
import { isSafeBearerToken } from '../bearer-token.ts';
import {
  WAREHOUSE_CONTROL_BYTES_MAX,
  WAREHOUSE_POLL_INTERVAL_DEFAULT_MS,
  WAREHOUSE_POLL_LIMIT_DEFAULT,
  WAREHOUSE_REQUEST_TIMEOUT_DEFAULT_MS,
  WAREHOUSE_RESULT_BYTES_DEFAULT,
  WarehouseAdapterError,
  type WarehouseAdapterRuntime,
  type WarehouseReadAuthorizer,
  type WarehouseReadRequest,
  arrayValue,
  authorizeWarehouseRead,
  bearerHeaders,
  boundedArrowBytes,
  boundedJson,
  fetchWithDeadline,
  httpsBaseUrl,
  normalizeWarehouseRead,
  objectValue,
  optionalString,
  positiveInteger,
  requireWarehouseReadAuthorizer,
  safeInteger,
  sameOriginVendorUrl,
  stringValue,
  vendorFailure,
  waitForNextPoll,
} from './warehouse-adapter-core.ts';

export interface DatabricksArrowChunk {
  index: number;
  rowOffset: number;
  rowCount: number;
  bytes: Uint8Array;
}

export interface DatabricksArrowAssembler {
  assemble(chunks: readonly DatabricksArrowChunk[]): Promise<Uint8Array>;
}

export interface DatabricksStatementAdapterConfig extends WarehouseAdapterRuntime {
  workspaceUrl: string;
  warehouseId: string;
  bearerToken: string;
  catalog?: string;
  schema?: string;
  maxResultBytes?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  arrowAssembler: DatabricksArrowAssembler;
  readAuthorizer: WarehouseReadAuthorizer;
}

export interface DatabricksStatementResult {
  statementId: string;
  rowCount: number;
  truncated: boolean;
  arrow: Uint8Array;
}

interface DatabricksManifestChunk {
  index: number;
  rowOffset: number;
  rowCount: number;
  byteCount: number;
}

const PENDING_STATES = new Set(['PENDING', 'RUNNING']);
const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED']);

/**
 * Dependency-free protocol core for a future server-side Databricks Compute
 * Bridge adapter. It deliberately has no browser registration or source-card
 * wiring; a packaged bridge supplies the Arrow stream assembler and HTTP route.
 */
export class DatabricksStatementAdapter {
  private readonly base: URL;
  private readonly warehouseId: string;
  private readonly token: string;
  private readonly catalog: string | null;
  private readonly schema: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly runtime: WarehouseAdapterRuntime;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly maxResultBytes: number;
  private readonly arrowAssembler: DatabricksArrowAssembler;
  private readonly readAuthorizer: WarehouseReadAuthorizer;

  constructor(config: DatabricksStatementAdapterConfig) {
    this.base = httpsBaseUrl(config.workspaceUrl, 'Databricks workspace URL');
    this.warehouseId = requiredConfig(config.warehouseId, 'Databricks warehouse ID');
    this.token = requiredToken(config.bearerToken);
    this.catalog = optionalConfig(config.catalog);
    this.schema = optionalConfig(config.schema);
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
    this.runtime = {
      ...(config.wait ? { wait: config.wait } : {}),
    };
    this.requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs,
      WAREHOUSE_REQUEST_TIMEOUT_DEFAULT_MS,
      'Databricks request timeout',
    );
    this.pollIntervalMs = positiveInteger(
      config.pollIntervalMs,
      WAREHOUSE_POLL_INTERVAL_DEFAULT_MS,
      'Databricks poll interval',
    );
    this.maxPolls = positiveInteger(
      config.maxPolls,
      WAREHOUSE_POLL_LIMIT_DEFAULT,
      'Databricks poll limit',
    );
    this.maxResultBytes = positiveInteger(
      config.maxResultBytes,
      WAREHOUSE_RESULT_BYTES_DEFAULT,
      'Databricks result byte limit',
    );
    this.arrowAssembler = config.arrowAssembler;
    this.readAuthorizer = requireWarehouseReadAuthorizer(config.readAuthorizer);
  }

  toJSON(): Record<string, unknown> {
    return {
      adapter: 'databricks-statement-execution',
      workspaceOrigin: this.base.origin,
      warehouseIdConfigured: true,
      catalogConfigured: this.catalog !== null,
      schemaConfigured: this.schema !== null,
      maxResultBytes: this.maxResultBytes,
    };
  }

  async execute(request: WarehouseReadRequest): Promise<DatabricksStatementResult> {
    const { sql, rowLimit } = normalizeWarehouseRead(request);
    const validation = validateReadOnlySql(sql);
    if (!validation.ok) {
      throw new WarehouseAdapterError(validation.reason, 'unsafe_query');
    }
    authorizeWarehouseRead(this.readAuthorizer, sql, [this.token]);
    let statementId: string | null = null;
    let terminal = false;
    try {
      let body = await this.apiJson(
        '/api/2.0/sql/statements',
        {
          method: 'POST',
          headers: bearerHeaders(this.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            statement: sql,
            warehouse_id: this.warehouseId,
            format: 'ARROW_STREAM',
            disposition: 'EXTERNAL_LINKS',
            wait_timeout: '0s',
            on_wait_timeout: 'CONTINUE',
            row_limit: rowLimit,
            byte_limit: this.maxResultBytes,
            ...(this.catalog ? { catalog: this.catalog } : {}),
            ...(this.schema ? { schema: this.schema } : {}),
          }),
        },
        request.signal,
      );
      statementId = stringValue(body.statement_id, 'Databricks statement_id');
      for (let poll = 0; ; poll++) {
        const state = databricksState(body);
        if (state === 'SUCCEEDED') {
          terminal = true;
          return await this.collectResult(body, statementId, rowLimit, request.signal);
        }
        if (state === 'FAILED' || state === 'CANCELED' || state === 'CLOSED') {
          terminal = true;
          throw vendorFailure(
            body,
            200,
            `Databricks statement ended in ${state}.`,
            state === 'CANCELED' ? 'cancelled' : 'query_failed',
            [this.token],
          );
        }
        if (!PENDING_STATES.has(state)) {
          throw new WarehouseAdapterError(
            `Unsupported Databricks statement state "${state}".`,
            'protocol_mismatch',
          );
        }
        if (poll >= this.maxPolls) {
          throw new WarehouseAdapterError(
            'Databricks statement exceeded the bounded poll limit.',
            'poll_limit',
          );
        }
        await waitForNextPoll(this.runtime, this.pollIntervalMs, request.signal);
        body = await this.apiJson(
          `/api/2.0/sql/statements/${encodeURIComponent(statementId)}`,
          { method: 'GET', headers: bearerHeaders(this.token) },
          request.signal,
        );
      }
    } catch (error) {
      const normalized =
        error instanceof WarehouseAdapterError
          ? error
          : new WarehouseAdapterError('Databricks adapter failed.', 'adapter_error');
      if (statementId && !terminal) {
        try {
          await this.cancelToTerminal(statementId);
        } catch (cancelError) {
          throw new WarehouseAdapterError(
            `Databricks statement cancellation could not be confirmed: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`,
            'cancellation_unconfirmed',
          );
        }
      }
      throw normalized;
    }
  }

  private async collectResult(
    body: Record<string, unknown>,
    statementId: string,
    rowLimit: number,
    signal?: AbortSignal,
  ): Promise<DatabricksStatementResult> {
    const manifest = objectValue(body.manifest, 'Databricks manifest');
    if (stringValue(manifest.format, 'Databricks manifest.format') !== 'ARROW_STREAM') {
      throw new WarehouseAdapterError(
        'Databricks result must use ARROW_STREAM.',
        'protocol_mismatch',
      );
    }
    const totalRows = safeInteger(manifest.total_row_count, 'Databricks manifest.total_row_count');
    const totalBytes = safeInteger(
      manifest.total_byte_count,
      'Databricks manifest.total_byte_count',
    );
    const totalChunks = safeInteger(
      manifest.total_chunk_count,
      'Databricks manifest.total_chunk_count',
    );
    if (typeof manifest.truncated !== 'boolean') {
      throw new WarehouseAdapterError(
        'Databricks manifest.truncated must be a boolean.',
        'protocol_mismatch',
      );
    }
    const truncated = manifest.truncated;
    if (totalRows > rowLimit || totalBytes > this.maxResultBytes) {
      throw new WarehouseAdapterError(
        'Databricks result exceeds the requested row or byte boundary.',
        'result_limit',
      );
    }
    const metadata = parseManifestChunks(manifest.chunks);
    if (metadata.length !== totalChunks) {
      throw new WarehouseAdapterError(
        'Databricks manifest chunk count is inconsistent.',
        'protocol_mismatch',
      );
    }
    validateManifestCoverage(metadata, totalRows, totalBytes);

    const chunks: DatabricksArrowChunk[] = [];
    const seen = new Set<number>();
    const visitedControlLinks = new Set<string>();
    let pageCount = 0;
    let envelope = objectValue(body.result, 'Databricks result');
    for (;;) {
      pageCount++;
      if (pageCount > Math.max(totalChunks, 1)) {
        throw new WarehouseAdapterError(
          'Databricks result pagination exceeded its manifest bound.',
          'protocol_mismatch',
        );
      }
      const seenBeforePage = seen.size;
      let nextFromLinks: string | null = null;
      for (const value of arrayValue(envelope.external_links, 'Databricks result.external_links')) {
        const link = objectValue(value, 'Databricks external link');
        const index = safeInteger(link.chunk_index, 'Databricks external link.chunk_index');
        if (seen.has(index)) {
          throw new WarehouseAdapterError(
            'Databricks returned a duplicate result chunk.',
            'protocol_mismatch',
          );
        }
        const expected = metadata[index];
        if (!expected || expected.index !== index) {
          throw new WarehouseAdapterError(
            'Databricks returned an unadvertised result chunk.',
            'protocol_mismatch',
          );
        }
        const rowCount = safeInteger(link.row_count, 'Databricks external link.row_count');
        const rowOffset = safeInteger(link.row_offset, 'Databricks external link.row_offset');
        const byteCount = safeInteger(link.byte_count, 'Databricks external link.byte_count');
        if (
          rowCount !== expected.rowCount ||
          rowOffset !== expected.rowOffset ||
          byteCount !== expected.byteCount
        ) {
          throw new WarehouseAdapterError(
            'Databricks result link disagrees with its manifest.',
            'protocol_mismatch',
          );
        }
        const externalUrl = httpsExternalUrl(
          stringValue(link.external_link, 'Databricks external link.external_link'),
        );
        // Signed result URLs carry their own capability. Do not forward the
        // Databricks bearer header. Workers have no ambient cookie jar.
        // Manual redirects keep 3xx responses observable and rejectable via
        // the non-OK response branch instead of workerd's opaque TypeError.
        const externalRequest: RequestInit = {
          method: 'GET',
          headers: { Accept: 'application/vnd.apache.arrow.stream' },
          redirect: 'manual',
        };
        const response = await fetchWithDeadline(
          this.fetchImpl,
          externalUrl,
          externalRequest,
          this.requestTimeoutMs,
          signal,
        );
        if (!response.ok) {
          throw new WarehouseAdapterError(
            `Databricks result download failed with HTTP ${response.status}.`,
            'result_download_failed',
            response.status,
          );
        }
        const bytes = await boundedArrowBytes(response, byteCount);
        if (bytes.byteLength !== byteCount) {
          throw new WarehouseAdapterError(
            'Databricks result byte count does not match its manifest.',
            'protocol_mismatch',
          );
        }
        seen.add(index);
        chunks.push({ index, rowOffset, rowCount, bytes });
        const linkNext = optionalString(link.next_chunk_internal_link);
        if (linkNext) {
          if (nextFromLinks && nextFromLinks !== linkNext) {
            throw new WarehouseAdapterError(
              'Databricks returned conflicting next-chunk links.',
              'protocol_mismatch',
            );
          }
          nextFromLinks = linkNext;
        }
        if (link.next_chunk_index !== undefined) {
          const nextIndex = safeInteger(
            link.next_chunk_index,
            'Databricks external link.next_chunk_index',
          );
          if (nextIndex !== index + 1) {
            throw new WarehouseAdapterError(
              'Databricks returned an inconsistent next chunk index.',
              'protocol_mismatch',
            );
          }
        }
      }
      const envelopeNext = optionalString(envelope.next_chunk_internal_link);
      if (envelopeNext && nextFromLinks && envelopeNext !== nextFromLinks) {
        throw new WarehouseAdapterError(
          'Databricks returned conflicting next-chunk links.',
          'protocol_mismatch',
        );
      }
      const next = nextFromLinks ?? envelopeNext;
      if (!next) break;
      const nextUrl = sameOriginVendorUrl(this.base, next, 'Databricks next chunk link');
      if (seen.size === seenBeforePage || seen.size >= totalChunks) {
        throw new WarehouseAdapterError(
          'Databricks result pagination made no valid progress.',
          'protocol_mismatch',
        );
      }
      if (visitedControlLinks.has(nextUrl.href)) {
        throw new WarehouseAdapterError(
          'Databricks returned a repeated next-chunk link.',
          'protocol_mismatch',
        );
      }
      visitedControlLinks.add(nextUrl.href);
      envelope = await this.apiJson(
        nextUrl,
        { method: 'GET', headers: bearerHeaders(this.token) },
        signal,
      );
    }
    if (seen.size !== totalChunks) {
      throw new WarehouseAdapterError(
        'Databricks did not return every advertised result chunk.',
        'protocol_mismatch',
      );
    }
    chunks.sort((left, right) => left.index - right.index);
    const arrow = await this.arrowAssembler.assemble(chunks);
    if (!(arrow instanceof Uint8Array) || arrow.byteLength > this.maxResultBytes) {
      throw new WarehouseAdapterError(
        'Databricks Arrow assembler returned an invalid result.',
        'invalid_result',
      );
    }
    return {
      statementId,
      rowCount: totalRows,
      truncated,
      arrow,
    };
  }

  private async cancelToTerminal(statementId: string): Promise<void> {
    // The cancel receipt is not proof of terminal state, and the receipt itself
    // can race with statement completion. Always poll the statement afterward.
    await this.apiJson(`/api/2.0/sql/statements/${encodeURIComponent(statementId)}/cancel`, {
      method: 'POST',
      headers: bearerHeaders(this.token),
    }).catch(() => undefined);
    for (let poll = 0; poll <= this.maxPolls; poll++) {
      const body = await this.apiJson(
        `/api/2.0/sql/statements/${encodeURIComponent(statementId)}`,
        { method: 'GET', headers: bearerHeaders(this.token) },
      );
      const state = databricksState(body);
      if (TERMINAL_STATES.has(state)) return;
      if (!PENDING_STATES.has(state)) {
        throw new WarehouseAdapterError(
          `Unsupported Databricks cancellation state "${state}".`,
          'protocol_mismatch',
        );
      }
      if (poll === this.maxPolls) break;
      await waitForNextPoll(this.runtime, this.pollIntervalMs);
    }
    throw new WarehouseAdapterError(
      'Databricks cancellation did not reach a terminal state.',
      'cancellation_unconfirmed',
    );
  }

  private async apiJson(
    path: string | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const url =
      path instanceof URL
        ? sameOriginVendorUrl(this.base, path.href, 'Databricks API link')
        : sameOriginVendorUrl(this.base, path, 'Databricks API path');
    const response = await fetchWithDeadline(
      this.fetchImpl,
      url,
      init,
      this.requestTimeoutMs,
      signal,
    );
    const body = await boundedJson(response, WAREHOUSE_CONTROL_BYTES_MAX);
    if (!response.ok) {
      const code =
        response.status === 401
          ? 'credential_rejected'
          : response.status === 403
            ? 'authorization_denied'
            : response.status === 429
              ? 'rate_limited'
              : 'vendor_error';
      throw vendorFailure(body, response.status, 'Databricks API request failed.', code, [
        this.token,
      ]);
    }
    return objectValue(body, 'Databricks response');
  }
}

function databricksState(body: Record<string, unknown>): string {
  return stringValue(
    objectValue(body.status, 'Databricks status').state,
    'Databricks status.state',
  ).toUpperCase();
}

function parseManifestChunks(value: unknown): DatabricksManifestChunk[] {
  return arrayValue(value, 'Databricks manifest.chunks')
    .map((entry) => {
      const chunk = objectValue(entry, 'Databricks manifest chunk');
      return {
        index: safeInteger(chunk.chunk_index, 'Databricks manifest chunk.chunk_index'),
        rowOffset: safeInteger(chunk.row_offset, 'Databricks manifest chunk.row_offset'),
        rowCount: safeInteger(chunk.row_count, 'Databricks manifest chunk.row_count'),
        byteCount: safeInteger(chunk.byte_count, 'Databricks manifest chunk.byte_count'),
      };
    })
    .sort((left, right) => left.index - right.index);
}

function validateManifestCoverage(
  chunks: readonly DatabricksManifestChunk[],
  totalRows: number,
  totalBytes: number,
): void {
  let rowOffset = 0;
  let bytes = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (!chunk || chunk.index !== index || chunk.rowOffset !== rowOffset) {
      throw new WarehouseAdapterError(
        'Databricks manifest chunks are not contiguous.',
        'protocol_mismatch',
      );
    }
    rowOffset += chunk.rowCount;
    bytes += chunk.byteCount;
  }
  if (rowOffset !== totalRows || bytes !== totalBytes) {
    throw new WarehouseAdapterError(
      'Databricks manifest totals are inconsistent.',
      'protocol_mismatch',
    );
  }
}

function requiredConfig(value: string, label: string): string {
  if (!value.trim()) throw new WarehouseAdapterError(`${label} is required.`, 'invalid_config');
  return value.trim();
}

function requiredToken(value: string): string {
  if (!value) {
    throw new WarehouseAdapterError('Databricks bearer token is required.', 'invalid_config');
  }
  if (!isSafeBearerToken(value)) {
    throw new WarehouseAdapterError('Databricks bearer token is invalid.', 'invalid_config');
  }
  return value;
}

function optionalConfig(value: string | undefined): string | null {
  return value?.trim() || null;
}

function httpsExternalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WarehouseAdapterError(
      'Databricks external result link is invalid.',
      'protocol_mismatch',
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new WarehouseAdapterError(
      'Databricks external result link must use HTTPS.',
      'protocol_mismatch',
    );
  }
  return url;
}
