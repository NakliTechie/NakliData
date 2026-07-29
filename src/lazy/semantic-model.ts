import type { Association } from '../core/associations.ts';
import type { DimensionDefinition } from '../core/dimensions.ts';
import type { MeasureDefinition } from '../core/measures.ts';
import type { MountedSource } from '../core/mount.ts';
import type { SegmentDefinition } from '../core/segments.ts';
import type {
  AdapterIssue,
  GovernanceMetadata,
  LogicalTable,
  PortableSemanticModel,
  SemanticAdapterResult,
  SemanticDimension,
  SemanticField,
  SemanticMeasure,
  SemanticRelationship,
} from '../core/semantic-model-types.ts';
import type { TaxonomyBundle } from '../taxonomy/types.ts';
import {
  roleFamilyForType,
  sensitivityForType,
  universalTermForType,
} from '../taxonomy/universal.ts';
import type { ColumnAssignment } from '../ui/schema-panel.ts';

const EMPTY_GOVERNANCE: GovernanceMetadata = {
  owner: null,
  certification: null,
  deprecated: false,
  businessTerms: [],
};

export interface BuildSemanticModelInput {
  name: string;
  description?: string;
  sources: ReadonlyArray<MountedSource>;
  assignments: Readonly<Record<string, ColumnAssignment>>;
  measures: ReadonlyArray<MeasureDefinition>;
  dimensions: ReadonlyArray<DimensionDefinition>;
  segments: ReadonlyArray<SegmentDefinition>;
  associations: ReadonlyArray<Association>;
  taxonomyBundle: TaxonomyBundle | null;
}

export interface BuildSemanticModelResult {
  model: PortableSemanticModel;
  issues: AdapterIssue[];
}

export interface SemanticModelExportDialogOptions {
  input: BuildSemanticModelInput;
  saveText: (
    text: string,
    suggestedName: string,
    options: { mime: string; description: string; extensions: string[] },
  ) => Promise<string>;
  notify: (message: string) => void;
}

let exportDialog: HTMLElement | null = null;
let exportDialogKeyHandler: ((event: KeyboardEvent) => void) | null = null;
let exportDialogPreviousFocus: HTMLElement | null = null;

export function openSemanticModelExportDialog(options: SemanticModelExportDialogOptions): void {
  if (exportDialog) return;
  const build = buildPortableSemanticModel(options.input);
  const model = build.model;
  const validationErrors = validatePortableSemanticModel(model);
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'semantic-export-title');
  exportDialogPreviousFocus = document.activeElement as HTMLElement | null;

  const render = (rootTableId: string): void => {
    const databricks =
      model.tables.length && rootTableId ? exportDatabricksMetricView(model, rootTableId) : null;
    const snowflake = exportSnowflakeSemanticView(model);
    overlay.innerHTML = `
      <div class="schema-graph-modal" role="document" style="width:min(880px,100%);max-height:min(90vh,880px);display:flex;flex-direction:column;">
        <header class="schema-graph-header">
          <div>
            <h2 id="semantic-export-title" style="margin:0;font-size:var(--text-md,15px);">Export semantic model</h2>
            <p style="margin:3px 0 0;color:var(--text-muted);font-size:11px;">Portable source of truth with explicit, loss-aware platform adapters.</p>
          </div>
          <button class="btn btn-ghost schema-graph-close" data-action="semantic-export-close" aria-label="Close">×</button>
        </header>
        <div style="padding:var(--space-3) var(--space-4);overflow:auto;display:grid;gap:var(--space-3);">
          ${renderModelSummary(model, build.issues, validationErrors)}
          ${renderExportCard({
            title: 'NakliData portable model',
            description:
              'Versionable JSON with tables, fields, metrics, filters, joins, lineage bindings, grain candidates, sensitivity, and governance metadata.',
            format: 'portable',
            deployable: validationErrors.length === 0,
            issues: validationErrors.map((message) =>
              issue('error', 'invalid_portable_model', message, null),
            ),
          })}
          <section style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3);">
            <div style="display:flex;align-items:flex-start;gap:var(--space-3);flex-wrap:wrap;">
              <div style="flex:1;min-width:220px;">
                <h3 style="margin:0 0 4px;font-size:var(--text-sm,13px);">Databricks Metric View YAML 1.1</h3>
                <p style="margin:0;color:var(--text-muted);font-size:11px;">One selected root table plus adjacent joins, fields, measures, and the combined model filter.</p>
              </div>
              <label style="font-size:11px;color:var(--text-muted);">
                Root table
                <select data-region="databricks-root" style="display:block;margin-top:4px;min-width:180px;">
                  ${model.tables
                    .map(
                      (table) =>
                        `<option value="${escapeAttribute(table.id)}"${table.id === rootTableId ? ' selected' : ''}>${escapeText(table.label)}</option>`,
                    )
                    .join('')}
                </select>
              </label>
              <button class="btn btn-primary" data-action="semantic-export-save" data-format="databricks"${!databricks?.deployable ? ' disabled' : ''}>Save YAML</button>
            </div>
            ${renderIssues([...(databricks?.issues ?? []), ...build.issues], databricks?.deployable ?? false)}
          </section>
          ${renderExportCard({
            title: 'Snowflake Semantic View YAML',
            description:
              'Multi-table semantic view with dimensions, time dimensions, facts, metrics, relationships, and verified queries.',
            format: 'snowflake',
            deployable: snowflake.deployable,
            issues: [...snowflake.issues, ...build.issues],
          })}
          <div data-region="semantic-export-error" role="alert" style="min-height:16px;color:var(--danger);font-size:11px;"></div>
        </div>
        <footer style="display:flex;justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
          <button class="btn btn-ghost" data-action="semantic-export-close">Close</button>
        </footer>
      </div>
    `;

    overlay
      .querySelector<HTMLSelectElement>('[data-region="databricks-root"]')
      ?.addEventListener('change', (event) =>
        render((event.currentTarget as HTMLSelectElement).value),
      );
    for (const button of overlay.querySelectorAll<HTMLElement>(
      '[data-action="semantic-export-close"]',
    )) {
      button.addEventListener('click', closeSemanticModelExportDialog);
    }
    for (const button of overlay.querySelectorAll<HTMLButtonElement>(
      '[data-action="semantic-export-save"]',
    )) {
      button.addEventListener('click', () => {
        const errorRegion = overlay.querySelector<HTMLElement>(
          '[data-region="semantic-export-error"]',
        );
        if (errorRegion) errorRegion.textContent = '';
        button.disabled = true;
        void saveSemanticArtifact(
          button.dataset.format ?? '',
          model,
          databricks,
          snowflake,
          options,
        )
          .catch((error) => {
            if (errorRegion) {
              errorRegion.textContent = error instanceof Error ? error.message : String(error);
            }
          })
          .finally(() => {
            button.disabled = false;
          });
      });
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeSemanticModelExportDialog();
  });
  exportDialogKeyHandler = (event) => {
    if (event.key === 'Escape') closeSemanticModelExportDialog();
  };
  document.addEventListener('keydown', exportDialogKeyHandler);
  document.body.append(overlay);
  exportDialog = overlay;
  render(model.tables[0]?.id ?? '');
  overlay.querySelector<HTMLElement>('[data-action="semantic-export-close"]')?.focus();
}

export function closeSemanticModelExportDialog(): void {
  exportDialog?.remove();
  exportDialog = null;
  if (exportDialogKeyHandler) {
    document.removeEventListener('keydown', exportDialogKeyHandler);
    exportDialogKeyHandler = null;
  }
  exportDialogPreviousFocus?.focus();
  exportDialogPreviousFocus = null;
}

export function buildPortableSemanticModel(
  input: BuildSemanticModelInput,
): BuildSemanticModelResult {
  const issues: AdapterIssue[] = [];
  const tables: LogicalTable[] = [];
  const relationToIds = new Map<string, string[]>();
  const nameCounts = new Map<string, number>();

  for (const source of input.sources) {
    for (const mounted of source.tables) {
      const baseName = portableName(mounted.name) || 'table';
      const count = (nameCounts.get(baseName) ?? 0) + 1;
      nameCounts.set(baseName, count);
      const name = count === 1 ? baseName : `${baseName}_${count}`;
      const id = mounted.id;
      const fields = fieldsForTable(source.id, mounted.id, input.assignments, input.taxonomyBundle);
      const grainColumns = candidateGrainColumns(name, fields);
      const remoteQualifiedName = bridgeQualifiedName(source, mounted.name);
      const physical = splitPhysicalName(remoteQualifiedName);
      tables.push({
        id,
        name,
        label: mounted.name,
        description: `${source.label} · ${mounted.origin}`,
        synonyms: [],
        binding: {
          sourceId: source.id,
          sourceKind: source.kind,
          mountedTableId: mounted.id,
          relation: mounted.name,
          catalog: physical.catalog,
          database: physical.database,
          schema: physical.schema,
          table: physical.table || mounted.name,
          qualifiedName: remoteQualifiedName,
        },
        fields,
        grain: { columns: grainColumns, verified: false },
        governance: freshGovernance(),
      });
      const ids = relationToIds.get(mounted.name) ?? [];
      ids.push(id);
      relationToIds.set(mounted.name, ids);
    }
  }

  const relationships = relationshipsFromAssociations(input.associations, relationToIds, issues);
  const measures: SemanticMeasure[] = input.measures.map((measure) => ({
    name: measure.name,
    tableId: null,
    expression: measure.expression,
    format: measure.format,
    description: measure.description,
    synonyms: [],
    governance: freshGovernance(),
  }));
  const dimensions: SemanticDimension[] = input.dimensions.map((dimension) => ({
    name: dimension.name,
    tableId: null,
    expression: dimension.expression,
    kind: /\b(?:date|time|timestamp)_trunc\s*\(|\bextract\s*\(|\bstrftime\s*\(/i.test(
      dimension.expression,
    )
      ? 'time_dimension'
      : 'dimension',
    description: dimension.description,
    synonyms: [],
    governance: freshGovernance(),
  }));

  // Existing DIM()/SEGMENT() macros are workbook-global and therefore remain
  // explicitly unbound. Vendor adapters report that ambiguity instead of
  // silently attaching them to a convenient table.
  for (const dimension of dimensions) {
    issues.push({
      severity: 'warning',
      code: 'unbound_dimension',
      message: `Dimension "${dimension.name}" is workbook-global; bind it to a logical table before a vendor export.`,
      path: `dimensions.${dimension.name}`,
    });
  }
  for (const measure of measures) {
    issues.push({
      severity: 'warning',
      code: 'unbound_measure',
      message: `Measure "${measure.name}" is workbook-global; a vendor adapter needs an explicit root/table binding.`,
      path: `measures.${measure.name}`,
    });
  }

  return {
    model: {
      format: 'naklidata-semantic-model',
      version: 1,
      name: portableName(input.name) || 'semantic_model',
      description: input.description?.trim() ?? '',
      tables,
      dimensions,
      measures,
      filters: input.segments.map((segment) => ({
        name: segment.name,
        tableId: null,
        expression: segment.expression,
        description: segment.description,
        synonyms: [],
        governance: freshGovernance(),
      })),
      relationships,
      verifiedQueries: [],
      governance: freshGovernance(),
    },
    issues,
  };
}

export function validatePortableSemanticModel(model: PortableSemanticModel): string[] {
  const errors: string[] = [];
  if (model.format !== 'naklidata-semantic-model' || model.version !== 1) {
    errors.push('Unsupported semantic model format/version.');
  }
  const tableIds = new Set<string>();
  const tableNames = new Set<string>();
  for (const table of model.tables) {
    if (!table.id.trim()) errors.push('Logical table id is required.');
    if (tableIds.has(table.id)) errors.push(`Duplicate logical table id: ${table.id}.`);
    tableIds.add(table.id);
    if (!isPortableName(table.name)) errors.push(`Invalid logical table name: ${table.name}.`);
    if (tableNames.has(table.name)) errors.push(`Duplicate logical table name: ${table.name}.`);
    tableNames.add(table.name);
    const fieldNames = new Set<string>();
    for (const field of table.fields) {
      if (!isPortableName(field.name)) {
        errors.push(`${table.name}: invalid field name ${field.name}.`);
      }
      if (fieldNames.has(field.name)) {
        errors.push(`${table.name}: duplicate field ${field.name}.`);
      }
      fieldNames.add(field.name);
      if (!field.expression.trim())
        errors.push(`${table.name}.${field.name}: expression required.`);
    }
    for (const grainColumn of table.grain.columns) {
      if (!fieldNames.has(portableName(grainColumn))) {
        errors.push(`${table.name}: grain references unknown field ${grainColumn}.`);
      }
    }
  }
  const relationshipIds = new Set<string>();
  const relationshipNames = new Set<string>();
  for (const relationship of model.relationships) {
    if (relationshipIds.has(relationship.id)) {
      errors.push(`Duplicate relationship id: ${relationship.id}.`);
    }
    relationshipIds.add(relationship.id);
    if (!isPortableName(relationship.name)) {
      errors.push(`Invalid relationship name: ${relationship.name}.`);
    }
    if (relationshipNames.has(relationship.name)) {
      errors.push(`Duplicate relationship name: ${relationship.name}.`);
    }
    relationshipNames.add(relationship.name);
    if (!tableIds.has(relationship.fromTableId) || !tableIds.has(relationship.toTableId)) {
      errors.push(`${relationship.name}: relationship references an unknown table.`);
    }
    if (!relationship.columnPairs.length) {
      errors.push(`${relationship.name}: at least one join-key pair is required.`);
    }
    const from = model.tables.find((table) => table.id === relationship.fromTableId);
    const to = model.tables.find((table) => table.id === relationship.toTableId);
    for (const pair of relationship.columnPairs) {
      if (from && !from.fields.some((field) => field.name === portableName(pair.from))) {
        errors.push(`${relationship.name}: unknown source join field ${pair.from}.`);
      }
      if (to && !to.fields.some((field) => field.name === portableName(pair.to))) {
        errors.push(`${relationship.name}: unknown target join field ${pair.to}.`);
      }
    }
  }
  for (const [label, items] of [
    ['dimension', model.dimensions],
    ['measure', model.measures],
    ['filter', model.filters],
  ] as const) {
    const names = new Set<string>();
    for (const item of items) {
      if (!isPortableName(item.name)) errors.push(`Invalid semantic object name: ${item.name}.`);
      if (names.has(item.name)) errors.push(`Duplicate ${label} name: ${item.name}.`);
      names.add(item.name);
      if (!item.expression.trim()) errors.push(`${item.name}: expression required.`);
      if (item.tableId !== null && !tableIds.has(item.tableId)) {
        errors.push(`${item.name}: unknown table binding ${item.tableId}.`);
      }
    }
  }
  return errors;
}

export function exportPortableSemanticModelJson(model: PortableSemanticModel): string {
  const errors = validatePortableSemanticModel(model);
  if (errors.length) throw new Error(`Invalid semantic model:\n${errors.join('\n')}`);
  return `${JSON.stringify(model, null, 2)}\n`;
}

export function exportDatabricksMetricView(
  model: PortableSemanticModel,
  rootTableId: string,
): SemanticAdapterResult {
  const issues = modelValidationIssues(model);
  const root = model.tables.find((table) => table.id === rootTableId);
  if (!root) {
    throw new Error(`Databricks export root table not found: ${rootTableId}.`);
  }
  const tableById = new Map(model.tables.map((table) => [table.id, table]));
  const source = databricksSource(root, issues);
  const fields: Array<Record<string, unknown>> = root.fields
    .filter((field) => field.kind !== 'fact')
    .map(databricksField);
  for (const dimension of model.dimensions) {
    if (dimension.tableId === null || dimension.tableId === root.id) {
      fields.push(databricksDimension(dimension));
      if (dimension.tableId === null) {
        issues.push(
          issue(
            'warning',
            'dimension_bound_to_root',
            `Global dimension "${dimension.name}" was bound to the selected Databricks root "${root.name}".`,
            `dimensions.${dimension.name}`,
          ),
        );
      }
    } else {
      issues.push(
        issue(
          'warning',
          'non_root_dimension',
          `Dimension "${dimension.name}" is bound to a non-root logical table and was omitted.`,
          `dimensions.${dimension.name}`,
        ),
      );
    }
  }
  const joins: Array<Record<string, unknown>> = [];

  for (const relationship of model.relationships) {
    const direction =
      relationship.fromTableId === root.id
        ? { otherId: relationship.toTableId, reverse: false }
        : relationship.toTableId === root.id
          ? { otherId: relationship.fromTableId, reverse: true }
          : null;
    if (!direction) {
      issues.push(
        issue(
          'warning',
          'non_root_join',
          `${relationship.name} is not adjacent to the selected Databricks root and was omitted.`,
          `relationships.${relationship.name}`,
        ),
      );
      continue;
    }
    if (relationship.cardinality === 'many_to_many') {
      issues.push(
        issue(
          'error',
          'many_to_many_join',
          `${relationship.name} cannot be represented as one Databricks metric-view join.`,
          `relationships.${relationship.name}`,
        ),
      );
      continue;
    }
    const other = tableById.get(direction.otherId);
    if (!other) continue;
    const alias = other.name;
    const predicates = relationship.columnPairs.map((pair) => {
      const rootColumn = direction.reverse ? pair.to : pair.from;
      const otherColumn = direction.reverse ? pair.from : pair.to;
      return `source.${databricksIdent(rootColumn)} = ${alias}.${databricksIdent(otherColumn)}`;
    });
    const join: Record<string, unknown> = {
      name: alias,
      source: databricksSource(other, issues),
      on: predicates.join(' AND '),
    };
    const cardinality = direction.reverse
      ? reverseCardinality(relationship.cardinality)
      : relationship.cardinality;
    if (cardinality === 'one_to_many' || cardinality === 'many_to_one') {
      if (cardinality === 'one_to_many') join.cardinality = 'one_to_many';
    } else if (cardinality === 'unknown') {
      issues.push(
        issue(
          'warning',
          'unknown_cardinality',
          `${relationship.name} cardinality is unknown; Databricks will default to many_to_one.`,
          `relationships.${relationship.name}`,
        ),
      );
    } else {
      issues.push(
        issue(
          'warning',
          'one_to_one_default',
          `${relationship.name} is one-to-one; Databricks has no one_to_one cardinality value, so the join uses its many_to_one default.`,
          `relationships.${relationship.name}`,
        ),
      );
    }
    joins.push(join);
    const joinedFields =
      cardinality === 'one_to_many'
        ? []
        : other.fields.filter((candidate) => candidate.kind !== 'fact');
    if (cardinality === 'one_to_many') {
      issues.push(
        issue(
          'warning',
          'one_to_many_fields_omitted',
          `${relationship.name} is one-to-many, so joined fields were omitted because Databricks requires fields to resolve to one value per source row.`,
          `relationships.${relationship.name}`,
        ),
      );
    }
    for (const field of joinedFields) {
      fields.push({
        ...databricksField(field),
        name: `${alias}_${field.name}`,
        expr: `${alias}.${databricksIdent(field.expression)}`,
      });
    }
  }

  const measures = model.measures.flatMap((measure) => {
    if (measure.tableId !== null && measure.tableId !== root.id) {
      issues.push(
        issue(
          'warning',
          'non_root_measure',
          `Measure "${measure.name}" is bound to a non-root logical table and was omitted.`,
          `measures.${measure.name}`,
        ),
      );
      return [];
    }
    if (measure.tableId === null) {
      issues.push(
        issue(
          'warning',
          'measure_bound_to_root',
          `Global measure "${measure.name}" was bound to the selected Databricks root "${root.name}".`,
          `measures.${measure.name}`,
        ),
      );
    }
    return [databricksMeasure(measure)];
  });
  const document: Record<string, unknown> = {
    version: '1.1',
    ...(model.description ? { comment: model.description } : {}),
    source,
    ...(joins.length ? { joins } : {}),
    fields,
    measures,
  };
  const rootFilters = model.filters.filter((filter) => {
    if (filter.tableId === null || filter.tableId === root.id) return true;
    issues.push(
      issue(
        'warning',
        'non_root_filter',
        `Filter "${filter.name}" is bound to a non-root logical table and was omitted.`,
        `filters.${filter.name}`,
      ),
    );
    return false;
  });
  if (rootFilters.length) {
    document.filter = rootFilters.map((filter) => `(${filter.expression})`).join(' AND ');
    if (rootFilters.length > 1) {
      issues.push(
        issue(
          'warning',
          'filters_combined',
          'Multiple portable filters were combined into the single Databricks metric-view filter.',
          'filters',
        ),
      );
    }
  }
  governanceIssues(model, issues, 'Databricks Metric View YAML');
  return adapterResult('databricks-metric-view', '1.1', document, issues);
}

export function exportSnowflakeSemanticView(model: PortableSemanticModel): SemanticAdapterResult {
  const issues = modelValidationIssues(model);
  if (!model.tables.length) {
    issues.push(
      issue(
        'error',
        'no_tables',
        'Snowflake Semantic View YAML requires at least one logical table.',
        'tables',
      ),
    );
  }
  const tables = model.tables.map((table) => {
    const baseTable = snowflakeBaseTable(table, issues);
    const dimensions = table.fields
      .filter((field) => field.kind === 'dimension')
      .map(snowflakeField);
    const timeDimensions = table.fields
      .filter((field) => field.kind === 'time_dimension')
      .map(snowflakeField);
    dimensions.push(
      ...model.dimensions
        .filter((dimension) => dimension.tableId === table.id && dimension.kind === 'dimension')
        .map(snowflakeDimension),
    );
    timeDimensions.push(
      ...model.dimensions
        .filter(
          (dimension) => dimension.tableId === table.id && dimension.kind === 'time_dimension',
        )
        .map(snowflakeDimension),
    );
    const facts = table.fields.filter((field) => field.kind === 'fact').map(snowflakeField);
    const tableMeasures = model.measures
      .filter((measure) => measure.tableId === table.id)
      .map(snowflakeMeasure);
    const filters = model.filters
      .filter((filter) => filter.tableId === table.id)
      .map((filter) => ({
        name: filter.name,
        expr: filter.expression,
        ...(filter.description ? { description: filter.description } : {}),
        ...(filter.synonyms.length ? { synonyms: filter.synonyms } : {}),
      }));
    return {
      name: table.name,
      ...(table.description ? { description: table.description } : {}),
      ...(table.synonyms.length ? { synonyms: table.synonyms } : {}),
      base_table: baseTable,
      ...(table.grain.verified && table.grain.columns.length
        ? { primary_key: { columns: table.grain.columns } }
        : {}),
      ...(dimensions.length ? { dimensions } : {}),
      ...(timeDimensions.length ? { time_dimensions: timeDimensions } : {}),
      ...(facts.length ? { facts } : {}),
      ...(tableMeasures.length ? { metrics: tableMeasures } : {}),
      ...(filters.length ? { filters } : {}),
    };
  });

  for (const table of model.tables) {
    if (table.grain.columns.length && !table.grain.verified) {
      issues.push(
        issue(
          'warning',
          'unverified_grain',
          `${table.name} has candidate grain columns that were not exported as a Snowflake primary key because uniqueness is unverified.`,
          `tables.${table.name}.grain`,
        ),
      );
    }
  }
  const document: Record<string, unknown> = {
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
    tables,
    ...(model.relationships.length
      ? {
          relationships: model.relationships.map((relationship) => ({
            name: relationship.name,
            left_table: tableByIdRequired(model, relationship.fromTableId).name,
            right_table: tableByIdRequired(model, relationship.toTableId).name,
            relationship_columns: relationship.columnPairs.map((pair) => ({
              left_column: pair.from,
              right_column: pair.to,
            })),
          })),
        }
      : {}),
    ...(model.measures.some((measure) => measure.tableId === null)
      ? {
          metrics: model.measures
            .filter((measure) => measure.tableId === null)
            .map(snowflakeMeasure),
        }
      : {}),
    ...(model.verifiedQueries.length
      ? {
          verified_queries: model.verifiedQueries.map((query) => ({
            name: query.name,
            question: query.question,
            sql: query.sql,
            ...(query.verifiedBy ? { verified_by: query.verifiedBy } : {}),
            ...(query.verifiedAt
              ? { verified_at: Math.floor(Date.parse(query.verifiedAt) / 1000) }
              : {}),
          })),
        }
      : {}),
  };
  for (const filter of model.filters.filter((candidate) => candidate.tableId === null)) {
    issues.push(
      issue(
        'warning',
        'unbound_filter',
        `Global filter "${filter.name}" has no Snowflake logical-table binding and was omitted.`,
        `filters.${filter.name}`,
      ),
    );
  }
  for (const dimension of model.dimensions.filter((candidate) => candidate.tableId === null)) {
    issues.push(
      issue(
        'warning',
        'unbound_dimension',
        `Global dimension "${dimension.name}" has no Snowflake logical-table binding and was omitted.`,
        `dimensions.${dimension.name}`,
      ),
    );
  }
  for (const measure of model.measures.filter(
    (candidate) => candidate.format !== 'number' && candidate.format !== 'count',
  )) {
    issues.push(
      issue(
        'warning',
        'measure_format_not_mapped',
        `Display format "${measure.format}" for measure "${measure.name}" has no lossless Snowflake Semantic View YAML field and remains only in the portable model.`,
        `measures.${measure.name}.format`,
      ),
    );
  }
  governanceIssues(model, issues, 'Snowflake Semantic View YAML');
  return adapterResult('snowflake-semantic-view', 'current', document, issues);
}

export function importDatabricksMetricView(
  document: unknown,
  modelName = 'databricks_metric_view',
): BuildSemanticModelResult {
  const source = objectValue(document, 'Databricks metric view');
  const issues: AdapterIssue[] = [];
  const root = vendorTable('root', 'source', stringValue(source.source, 'source'));
  const tables = [root];
  const relationships: SemanticRelationship[] = [];
  for (const [index, value] of arrayValue(source.joins ?? []).entries()) {
    const join = objectValue(value, `joins[${index}]`);
    const table = vendorTable(
      `join_${index + 1}`,
      stringValue(join.name, `joins[${index}].name`),
      stringValue(join.source, `joins[${index}].source`),
    );
    tables.push(table);
    issues.push(
      issue(
        'warning',
        'join_expression_unparsed',
        `Join "${table.name}" was imported without join-key columns; review its on/using expression.`,
        `joins[${index}]`,
      ),
    );
  }
  root.fields = arrayValue(source.fields ?? source.dimensions ?? []).map((value, index) =>
    vendorField(value, `fields[${index}]`),
  );
  const measures = arrayValue(source.measures ?? []).map((value, index) =>
    vendorMeasure(value, `measures[${index}]`),
  );
  if ('materialization' in source || 'parameters' in source) {
    issues.push(
      issue(
        'warning',
        'vendor_feature_omitted',
        'Databricks parameters/materialization are vendor-specific and were not imported into the portable v1 model.',
        null,
      ),
    );
  }
  return {
    model: {
      format: 'naklidata-semantic-model',
      version: 1,
      name: portableName(modelName) || 'databricks_metric_view',
      description: optionalString(source.comment),
      tables,
      dimensions: [],
      measures,
      filters:
        typeof source.filter === 'string'
          ? [
              {
                name: 'metric_view_filter',
                tableId: root.id,
                expression: source.filter,
                description: '',
                synonyms: [],
                governance: freshGovernance(),
              },
            ]
          : [],
      relationships,
      verifiedQueries: [],
      governance: freshGovernance(),
    },
    issues,
  };
}

export function importSnowflakeSemanticView(document: unknown): BuildSemanticModelResult {
  const source = objectValue(document, 'Snowflake semantic view');
  const issues: AdapterIssue[] = [];
  const tables = arrayValue(source.tables ?? []).map((value, index) => {
    const table = objectValue(value, `tables[${index}]`);
    const name = stringValue(table.name, `tables[${index}].name`);
    const base = objectValue(table.base_table ?? {}, `tables[${index}].base_table`);
    const qualified = [base.database, base.schema, base.table]
      .filter((part): part is string => typeof part === 'string' && !!part)
      .join('.');
    const logical = vendorTable(`table_${index + 1}`, name, qualified || name);
    logical.description = optionalString(table.description);
    logical.fields = [
      ...arrayValue(table.dimensions ?? []).map((field, fieldIndex) =>
        vendorField(field, `tables[${index}].dimensions[${fieldIndex}]`, 'dimension'),
      ),
      ...arrayValue(table.time_dimensions ?? []).map((field, fieldIndex) =>
        vendorField(field, `tables[${index}].time_dimensions[${fieldIndex}]`, 'time_dimension'),
      ),
      ...arrayValue(table.facts ?? []).map((field, fieldIndex) =>
        vendorField(field, `tables[${index}].facts[${fieldIndex}]`, 'fact'),
      ),
    ];
    return logical;
  });
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const relationships = arrayValue(source.relationships ?? []).flatMap((value, index) => {
    const relationship = objectValue(value, `relationships[${index}]`);
    const from = tableByName.get(
      stringValue(relationship.left_table, `relationships[${index}].left_table`),
    );
    const to = tableByName.get(
      stringValue(relationship.right_table, `relationships[${index}].right_table`),
    );
    if (!from || !to) {
      issues.push(
        issue(
          'error',
          'unknown_relationship_table',
          `relationships[${index}] references an unknown logical table.`,
          `relationships[${index}]`,
        ),
      );
      return [];
    }
    return [
      {
        id: `relationship_${index + 1}`,
        name: stringValue(relationship.name, `relationships[${index}].name`),
        fromTableId: from.id,
        toTableId: to.id,
        columnPairs: arrayValue(relationship.relationship_columns ?? []).map(
          (pairValue, pairIndex) => {
            const pair = objectValue(
              pairValue,
              `relationships[${index}].relationship_columns[${pairIndex}]`,
            );
            return {
              from: stringValue(
                pair.left_column,
                `relationships[${index}].relationship_columns[${pairIndex}].left_column`,
              ),
              to: stringValue(
                pair.right_column,
                `relationships[${index}].relationship_columns[${pairIndex}].right_column`,
              ),
            };
          },
        ),
        cardinality: 'unknown' as const,
        joinPath: [from.id, to.id],
        description: '',
        governance: freshGovernance(),
      },
    ];
  });
  if (
    'module_custom_instructions' in source ||
    'custom_instructions' in source ||
    'max_staleness' in source
  ) {
    issues.push(
      issue(
        'warning',
        'vendor_feature_omitted',
        'Snowflake custom instructions/materialization staleness are vendor-specific and were not imported into portable v1.',
        null,
      ),
    );
  }
  return {
    model: {
      format: 'naklidata-semantic-model',
      version: 1,
      name: portableName(optionalString(source.name)) || 'snowflake_semantic_view',
      description: optionalString(source.description),
      tables,
      dimensions: [],
      measures: arrayValue(source.metrics ?? []).map((value, index) =>
        vendorMeasure(value, `metrics[${index}]`),
      ),
      filters: [],
      relationships,
      verifiedQueries: [],
      governance: freshGovernance(),
    },
    issues,
  };
}

export function toYaml(value: unknown): string {
  return `${yamlNode(value, 0)}\n`;
}

function renderModelSummary(
  model: PortableSemanticModel,
  buildIssues: AdapterIssue[],
  validationErrors: string[],
): string {
  return `
    <section style="display:flex;gap:var(--space-3);flex-wrap:wrap;font-size:11px;color:var(--text-muted);">
      <strong style="color:var(--text);">${escapeText(model.name)}</strong>
      <span>${model.tables.length} table${model.tables.length === 1 ? '' : 's'}</span>
      <span>${model.tables.reduce((sum, table) => sum + table.fields.length, 0)} physical fields</span>
      <span>${model.dimensions.length} calculated dimensions</span>
      <span>${model.measures.length} measures</span>
      <span>${model.relationships.length} relationships</span>
      <span>${buildIssues.length} modeling note${buildIssues.length === 1 ? '' : 's'}</span>
      <span>${validationErrors.length} validation error${validationErrors.length === 1 ? '' : 's'}</span>
    </section>
  `;
}

function renderExportCard(options: {
  title: string;
  description: string;
  format: 'portable' | 'snowflake';
  deployable: boolean;
  issues: AdapterIssue[];
}): string {
  const label = options.format === 'portable' ? 'Save JSON' : 'Save YAML';
  return `
    <section style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3);">
      <div style="display:flex;align-items:flex-start;gap:var(--space-3);">
        <div style="flex:1;">
          <h3 style="margin:0 0 4px;font-size:var(--text-sm,13px);">${escapeText(options.title)}</h3>
          <p style="margin:0;color:var(--text-muted);font-size:11px;">${escapeText(options.description)}</p>
        </div>
        <button class="btn btn-primary" data-action="semantic-export-save" data-format="${options.format}"${!options.deployable ? ' disabled' : ''}>${label}</button>
      </div>
      ${renderIssues(options.issues, options.deployable)}
    </section>
  `;
}

function renderIssues(issues: AdapterIssue[], deployable: boolean): string {
  if (!issues.length) {
    return `<p style="margin:var(--space-2) 0 0;color:var(--success);font-size:11px;">${deployable ? 'Ready to export.' : 'No adapter diagnostics.'}</p>`;
  }
  const unique = [
    ...new Map(
      issues.map((item) => [`${item.severity}:${item.code}:${item.message}`, item]),
    ).values(),
  ];
  return `
    <details style="margin-top:var(--space-2);"${deployable ? '' : ' open'}>
      <summary style="cursor:pointer;font-size:11px;color:${deployable ? 'var(--text-muted)' : 'var(--danger)'};">
        ${deployable ? `${unique.length} mapping note${unique.length === 1 ? '' : 's'}` : 'Export blocked — review diagnostics'}
      </summary>
      <ul style="margin:6px 0 0;padding-left:18px;font-size:11px;">
        ${unique
          .map(
            (item) =>
              `<li style="margin-bottom:4px;color:${item.severity === 'error' ? 'var(--danger)' : 'var(--text-muted)'};"><code>${escapeText(item.code)}</code> — ${escapeText(item.message)}</li>`,
          )
          .join('')}
      </ul>
    </details>
  `;
}

async function saveSemanticArtifact(
  format: string,
  model: PortableSemanticModel,
  databricks: SemanticAdapterResult | null,
  snowflake: SemanticAdapterResult,
  options: SemanticModelExportDialogOptions,
): Promise<void> {
  let text: string;
  let filename: string;
  let description: string;
  if (format === 'portable') {
    text = exportPortableSemanticModelJson(model);
    filename = `${model.name}.semantic-model.json`;
    description = 'NakliData semantic model';
  } else if (format === 'databricks' && databricks?.deployable) {
    text = databricks.yaml;
    filename = `${model.name}.databricks-metric-view.yaml`;
    description = 'Databricks Metric View YAML';
  } else if (format === 'snowflake' && snowflake.deployable) {
    text = snowflake.yaml;
    filename = `${model.name}.snowflake-semantic-view.yaml`;
    description = 'Snowflake Semantic View YAML';
  } else {
    throw new Error('This vendor artifact is not deployable. Resolve the listed errors first.');
  }
  const written = await options.saveText(text, filename, {
    mime: format === 'portable' ? 'application/json' : 'application/yaml',
    description,
    extensions: format === 'portable' ? ['.json'] : ['.yaml', '.yml'],
  });
  if (written) options.notify(`Saved ${written}.`);
}

function fieldsForTable(
  sourceId: string,
  tableId: string,
  assignments: Readonly<Record<string, ColumnAssignment>>,
  bundle: TaxonomyBundle | null,
): SemanticField[] {
  const prefix = `${sourceId}::${tableId}::`;
  return Object.entries(assignments)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, assignment]) => {
      const typeId = assignment.assigned.typeId;
      const typeSpec = typeId ? bundle?.types.find((type) => type.id === typeId) : null;
      const roleFamily = typeId && bundle ? roleFamilyForType(bundle, typeId) : null;
      const term = typeId && bundle ? universalTermForType(bundle, typeId) : null;
      const isTime = /^(DATE|TIME|TIMESTAMP)/i.test(assignment.sqlType);
      return {
        name: portableName(assignment.columnName) || 'column',
        expression: assignment.columnName,
        dataType: assignment.sqlType,
        kind: isTime
          ? 'time_dimension'
          : roleFamily === 'measure' || roleFamily === 'metric'
            ? 'fact'
            : 'dimension',
        roleFamily,
        semanticTypeId: typeId,
        semanticTypeName: typeSpec?.display_name ?? null,
        sensitivity: typeId && bundle ? sensitivityForType(bundle, typeId) : null,
        synonyms: [],
        description: term?.prefLabel ?? '',
        governance: freshGovernance(),
      } satisfies SemanticField;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function relationshipsFromAssociations(
  associations: ReadonlyArray<Association>,
  relationToIds: ReadonlyMap<string, string[]>,
  issues: AdapterIssue[],
): SemanticRelationship[] {
  const grouped = new Map<string, SemanticRelationship>();
  for (const association of associations) {
    const fromIds = relationToIds.get(association.a.table) ?? [];
    const toIds = relationToIds.get(association.b.table) ?? [];
    if (fromIds.length !== 1 || toIds.length !== 1) {
      issues.push(
        issue(
          'warning',
          'ambiguous_relationship_owner',
          `Association ${association.a.table}.${association.a.column} ↔ ${association.b.table}.${association.b.column} could not resolve to one table on each side.`,
          'relationships',
        ),
      );
      continue;
    }
    const from = fromIds[0] as string;
    const to = toIds[0] as string;
    const key = `${from}→${to}`;
    let relationship = grouped.get(key);
    if (!relationship) {
      const name = `${portableName(association.a.table)}_to_${portableName(association.b.table)}`;
      relationship = {
        id: `rel_${grouped.size + 1}`,
        name,
        fromTableId: from,
        toTableId: to,
        columnPairs: [],
        cardinality: 'unknown',
        joinPath: [from, to],
        description: '',
        governance: freshGovernance(),
      };
      grouped.set(key, relationship);
    }
    relationship.columnPairs.push({ from: association.a.column, to: association.b.column });
  }
  return [...grouped.values()];
}

function candidateGrainColumns(tableName: string, fields: ReadonlyArray<SemanticField>): string[] {
  const entities = fields
    .filter((field) => field.roleFamily === 'entity')
    .map((field) => field.name);
  const singular = tableName.endsWith('ies')
    ? `${tableName.slice(0, -3)}y`
    : tableName.endsWith('s')
      ? tableName.slice(0, -1)
      : tableName;
  const named = entities.filter(
    (field) => field === 'id' || field === `${singular}_id` || field === `${singular}id`,
  );
  if (named.length) return named;
  return entities.length === 1 ? entities : [];
}

function bridgeQualifiedName(source: MountedSource, localName: string): string | null {
  const bridge = source.bridgeCatalog?.tables.find((table) => table.localName === localName);
  return bridge?.name ?? null;
}

function splitPhysicalName(qualified: string | null): {
  catalog: string | null;
  database: string | null;
  schema: string | null;
  table: string;
} {
  if (!qualified) return { catalog: null, database: null, schema: null, table: '' };
  const parts = qualified
    .split('.')
    .map((part) => part.replace(/^["`]|["`]$/g, '').trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return {
      catalog: parts.at(-3) ?? null,
      database: parts.at(-3) ?? null,
      schema: parts.at(-2) ?? null,
      table: parts.at(-1) ?? '',
    };
  }
  return {
    catalog: null,
    database: null,
    schema: parts.length === 2 ? (parts[0] ?? null) : null,
    table: parts.at(-1) ?? '',
  };
}

function databricksSource(table: LogicalTable, issues: AdapterIssue[]): string {
  const binding = table.binding;
  if (binding.catalog && binding.schema && binding.table) {
    return `${binding.catalog}.${binding.schema}.${binding.table}`;
  }
  issues.push(
    issue(
      'error',
      'missing_databricks_binding',
      `${table.name} lacks a verified catalog.schema.table binding; local relation "${binding.relation}" is emitted as a placeholder.`,
      `tables.${table.name}.binding`,
    ),
  );
  return binding.qualifiedName ?? binding.relation;
}

function databricksField(field: SemanticField): Record<string, unknown> {
  return {
    name: field.name,
    expr: databricksIdent(field.expression),
    ...(field.description ? { comment: field.description } : {}),
    ...(field.synonyms.length ? { synonyms: field.synonyms } : {}),
  };
}

function databricksDimension(dimension: SemanticDimension): Record<string, unknown> {
  return {
    name: dimension.name,
    expr: dimension.expression,
    ...(dimension.description ? { comment: dimension.description } : {}),
    ...(dimension.synonyms.length ? { synonyms: dimension.synonyms } : {}),
  };
}

function databricksMeasure(measure: SemanticMeasure): Record<string, unknown> {
  return {
    name: measure.name,
    expr: measure.expression,
    ...(measure.description ? { comment: measure.description } : {}),
    ...(measure.synonyms.length ? { synonyms: measure.synonyms } : {}),
    format: databricksMeasureFormat(measure.format),
  };
}

function databricksMeasureFormat(format: SemanticMeasure['format']): Record<string, unknown> {
  if (format === 'percent') return { type: 'percentage' };
  if (format.startsWith('currency_')) {
    return {
      type: 'currency',
      currency_code: format.slice('currency_'.length).toUpperCase(),
      decimal_places: { type: 'exact', places: 2 },
    };
  }
  return { type: 'number' };
}

function snowflakeBaseTable(table: LogicalTable, issues: AdapterIssue[]): Record<string, unknown> {
  const binding = table.binding;
  if (binding.database && binding.schema && binding.table) {
    return { database: binding.database, schema: binding.schema, table: binding.table };
  }
  issues.push(
    issue(
      'error',
      'missing_snowflake_binding',
      `${table.name} lacks a verified database.schema.table binding; a local SQL placeholder was emitted.`,
      `tables.${table.name}.binding`,
    ),
  );
  return { definition: `SELECT * FROM ${snowflakeIdent(binding.relation)}` };
}

function snowflakeField(field: SemanticField): Record<string, unknown> {
  return {
    name: field.name,
    expr: field.expression,
    data_type: field.dataType,
    ...(field.description ? { description: field.description } : {}),
    ...(field.synonyms.length ? { synonyms: field.synonyms } : {}),
  };
}

function snowflakeDimension(dimension: SemanticDimension): Record<string, unknown> {
  return {
    name: dimension.name,
    expr: dimension.expression,
    ...(dimension.description ? { description: dimension.description } : {}),
    ...(dimension.synonyms.length ? { synonyms: dimension.synonyms } : {}),
  };
}

function snowflakeMeasure(measure: SemanticMeasure): Record<string, unknown> {
  return {
    name: measure.name,
    expr: measure.expression,
    access_modifier: measure.governance.deprecated ? 'private_access' : 'public_access',
    ...(measure.description ? { description: measure.description } : {}),
    ...(measure.synonyms.length ? { synonyms: measure.synonyms } : {}),
  };
}

function governanceIssues(
  model: PortableSemanticModel,
  issues: AdapterIssue[],
  label: string,
): void {
  const governed = [
    model.governance,
    ...model.tables.flatMap((table) => [
      table.governance,
      ...table.fields.map((field) => field.governance),
    ]),
    ...model.dimensions.map((dimension) => dimension.governance),
    ...model.measures.map((measure) => measure.governance),
    ...model.filters.map((filter) => filter.governance),
    ...model.relationships.map((relationship) => relationship.governance),
  ].some(
    (governance) =>
      governance.owner ||
      governance.certification ||
      governance.deprecated ||
      governance.businessTerms.length,
  );
  if (governed) {
    issues.push(
      issue(
        'warning',
        'governance_not_mapped',
        `Owner, certification, deprecation, and business-term metadata do not map losslessly to ${label}; the portable model retains them.`,
        'governance',
      ),
    );
  }
}

function modelValidationIssues(model: PortableSemanticModel): AdapterIssue[] {
  return validatePortableSemanticModel(model).map((message) =>
    issue('error', 'invalid_portable_model', message, null),
  );
}

function adapterResult(
  platform: SemanticAdapterResult['platform'],
  formatVersion: string,
  document: Record<string, unknown>,
  issues: AdapterIssue[],
): SemanticAdapterResult {
  return {
    platform,
    formatVersion,
    deployable: !issues.some((item) => item.severity === 'error'),
    document,
    yaml: toYaml(document),
    issues,
  };
}

function vendorTable(id: string, name: string, qualifiedName: string): LogicalTable {
  const physical = splitPhysicalName(qualifiedName);
  return {
    id,
    name: portableName(name) || id,
    label: name,
    description: '',
    synonyms: [],
    binding: {
      sourceId: 'vendor_import',
      sourceKind: 'compute-bridge-catalog',
      mountedTableId: id,
      relation: qualifiedName,
      catalog: physical.catalog,
      database: physical.database,
      schema: physical.schema,
      table: physical.table || name,
      qualifiedName,
    },
    fields: [],
    grain: { columns: [], verified: false },
    governance: freshGovernance(),
  };
}

function vendorField(
  value: unknown,
  path: string,
  kind: SemanticField['kind'] = 'dimension',
): SemanticField {
  const field = objectValue(value, path);
  const name = stringValue(field.name, `${path}.name`);
  return {
    name: portableName(name) || 'field',
    expression: stringValue(field.expr, `${path}.expr`),
    dataType: optionalString(field.data_type) || 'UNKNOWN',
    kind,
    roleFamily: kind === 'fact' ? 'measure' : 'dimension',
    semanticTypeId: null,
    semanticTypeName: null,
    sensitivity: null,
    synonyms: stringList(field.synonyms),
    description: optionalString(field.description ?? field.comment),
    governance: freshGovernance(),
  };
}

function vendorMeasure(value: unknown, path: string): SemanticMeasure {
  const measure = objectValue(value, path);
  return {
    name: portableName(stringValue(measure.name, `${path}.name`)) || 'measure',
    tableId: null,
    expression: stringValue(measure.expr, `${path}.expr`),
    format: 'number',
    description: optionalString(measure.description ?? measure.comment),
    synonyms: stringList(measure.synonyms),
    governance: freshGovernance(),
  };
}

function tableByIdRequired(model: PortableSemanticModel, id: string): LogicalTable {
  const table = model.tables.find((candidate) => candidate.id === id);
  if (!table) throw new Error(`Semantic relationship references unknown table ${id}.`);
  return table;
}

function reverseCardinality(
  value: SemanticRelationship['cardinality'],
): SemanticRelationship['cardinality'] {
  if (value === 'one_to_many') return 'many_to_one';
  if (value === 'many_to_one') return 'one_to_many';
  return value;
}

function issue(
  severity: AdapterIssue['severity'],
  code: string,
  message: string,
  path: string | null,
): AdapterIssue {
  return { severity, code, message, path };
}

function freshGovernance(): GovernanceMetadata {
  return { ...EMPTY_GOVERNANCE, businessTerms: [] };
}

function portableName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '_$&')
    .slice(0, 64);
}

function isPortableName(value: string): boolean {
  return /^[a-z_][a-z0-9_]{0,63}$/.test(value);
}

function databricksIdent(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : `\`${value.replace(/`/g, '``')}\``;
}

function snowflakeIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Expected an array.');
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a string.`);
  return value.trim();
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
    : [];
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/'/g, '&#39;');
}

function yamlNode(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value
      .map((item) => {
        if (isScalar(item)) return `${pad}- ${yamlScalar(item)}`;
        if (isRecord(item)) {
          const entries = Object.entries(item);
          if (!entries.length) return `${pad}- {}`;
          const [firstKey, firstValue] = entries[0] as [string, unknown];
          const first = isScalar(firstValue)
            ? `${pad}- ${yamlKey(firstKey)}: ${yamlScalar(firstValue)}`
            : `${pad}- ${yamlKey(firstKey)}:\n${yamlNode(firstValue, indent + 4)}`;
          const rest = entries
            .slice(1)
            .map(([key, child]) =>
              isScalar(child)
                ? `${' '.repeat(indent + 2)}${yamlKey(key)}: ${yamlScalar(child)}`
                : `${' '.repeat(indent + 2)}${yamlKey(key)}:\n${yamlNode(child, indent + 4)}`,
            );
          return [first, ...rest].join('\n');
        }
        return `${pad}- ${yamlScalar(String(item))}`;
      })
      .join('\n');
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return `${pad}{}`;
    return entries
      .map(([key, child]) =>
        isScalar(child)
          ? `${pad}${yamlKey(key)}: ${yamlScalar(child)}`
          : `${pad}${yamlKey(key)}:\n${yamlNode(child, indent + 2)}`,
      )
      .join('\n');
  }
  return `${pad}${yamlScalar(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function yamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : JSON.stringify(value);
}

function yamlScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}
