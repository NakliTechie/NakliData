import type { UserType } from '../core/workbook.ts';
import type { TaxonomyBundle, TypeSpec } from '../taxonomy/types.ts';
import type { ColumnAssignment } from '../ui/schema-panel.ts';

const COMMON_TYPE_IDS = [
  'amount',
  'iso_date',
  'email',
  'vendor_name',
  'user_id',
  'country_code',
  'record_id',
] as const;
const recentOverrideTypeIds: string[] = [];

export function renderOverrideMenu(
  bundle: TaxonomyBundle,
  userTypes: UserType[],
  assignment: ColumnAssignment,
  sourceId: string,
  tableId: string,
  onPick: (typeId: string | null) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px;';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Filter types…';
  search.style.cssText =
    'padding:6px;border:1px solid var(--border);border-radius:4px;margin-bottom:4px;';
  search.setAttribute('aria-label', 'Filter types');
  wrap.append(search);

  const list = document.createElement('div');
  list.style.cssText = 'max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:1px;';
  wrap.append(list);

  const rememberAndPick = (typeId: string): void => {
    const prior = recentOverrideTypeIds.indexOf(typeId);
    if (prior >= 0) recentOverrideTypeIds.splice(prior, 1);
    recentOverrideTypeIds.unshift(typeId);
    recentOverrideTypeIds.splice(5);
    onPick(typeId);
  };
  const unknownBtn = document.createElement('button');
  unknownBtn.className = 'btn btn-ghost type-option';
  unknownBtn.style.cssText = 'justify-content:flex-start;padding:4px 8px;font-size:12px;';
  unknownBtn.textContent = 'unknown';
  unknownBtn.dataset.search = 'unknown unclassified';
  unknownBtn.addEventListener('click', () => onPick(null));
  list.append(unknownBtn);

  const seen = new Set<string>();
  const compatible = new Set(
    bundle.types
      .filter((type) =>
        type.sql_compat.some((sqlType) =>
          assignment.sqlType.toUpperCase().includes(sqlType.toUpperCase()),
        ),
      )
      .map((type) => type.id),
  );
  const addGroup = (
    label: string,
    items: Array<{ id: string; label: string; detail: string; keywords: string }>,
  ): void => {
    const fresh = items.filter((item) => !seen.has(item.id));
    if (fresh.length === 0) return;
    const group = document.createElement('div');
    group.className = 'type-option-group';
    const heading = document.createElement('div');
    heading.textContent = label;
    heading.style.cssText =
      'font-size:11px;color:var(--text-muted);padding:6px 8px 3px;text-transform:uppercase;letter-spacing:0.05em;';
    group.append(heading);
    for (const item of fresh) {
      seen.add(item.id);
      const button = document.createElement('button');
      button.className = 'btn btn-ghost type-option';
      button.style.cssText = 'justify-content:flex-start;padding:4px 8px;font-size:12px;';
      button.dataset.typeId = item.id;
      button.dataset.search = `${item.label} ${item.id} ${item.keywords}`.toLowerCase();
      button.innerHTML = `${escapeHtml(item.label)} <span style="color:var(--text-muted);margin-left:auto;font-size:10px;">${escapeHtml(item.detail)}</span>`;
      button.addEventListener('click', () => rememberAndPick(item.id));
      group.append(button);
    }
    list.append(group);
  };
  const byId = new Map(bundle.types.map((type) => [type.id, type]));
  const toItem = (type: TypeSpec, keywords = '') => ({
    id: type.id,
    label: type.display_name,
    detail: compatible.has(type.id) ? `${type.id} · compatible` : type.id,
    keywords: `${keywords} ${type.domain}`,
  });

  const suggestedIds = [
    ...(assignment.assigned.typeId ? [assignment.assigned.typeId] : []),
    ...assignment.candidates.map((candidate) => candidate.typeId),
  ];
  addGroup(
    'Suggested for this column',
    suggestedIds.flatMap((id) => {
      const type = byId.get(id);
      return type ? [toItem(type, 'suggested inferred')] : [];
    }),
  );
  addGroup(
    'Recent',
    recentOverrideTypeIds.flatMap((id) => {
      const type = byId.get(id);
      return type ? [toItem(type, 'recent')] : [];
    }),
  );
  addGroup(
    'Common',
    COMMON_TYPE_IDS.flatMap((id) => {
      const type = byId.get(id);
      return type ? [toItem(type, 'common')] : [];
    }),
  );
  addGroup(
    'Workbook types',
    userTypes.map((type) => ({
      id: type.id,
      label: type.display_name,
      detail: `${type.id} · workbook`,
      keywords: 'custom user workbook',
    })),
  );

  const domainLabels = new Map(bundle.domains.map((domain) => [domain.domain, domain.label]));
  const byDomain = new Map<string, TypeSpec[]>();
  for (const type of bundle.types) {
    const types = byDomain.get(type.domain) ?? [];
    types.push(type);
    byDomain.set(type.domain, types);
  }
  for (const [domainId, types] of Array.from(byDomain).sort(([aId], [bId]) =>
    (domainLabels.get(aId) ?? aId).localeCompare(domainLabels.get(bId) ?? bId),
  )) {
    addGroup(
      domainLabels.get(domainId) ?? domainId,
      types
        .sort((aType, bType) => aType.display_name.localeCompare(bType.display_name))
        .map((type) => toItem(type, domainLabels.get(domainId) ?? domainId)),
    );
  }

  const defineButton = document.createElement('button');
  defineButton.className = 'btn btn-ghost define-new-type-trigger';
  defineButton.dataset.action = 'define-new-type';
  defineButton.dataset.sourceId = sourceId;
  defineButton.dataset.tableId = tableId;
  defineButton.dataset.column = assignment.columnName;
  defineButton.dataset.sqlType = assignment.sqlType;
  defineButton.style.cssText =
    'justify-content:flex-start;padding:6px 8px;font-size:12px;color:var(--accent);margin-top:6px;border-top:1px dashed var(--border);';
  defineButton.innerHTML = '+ Define new type from this column…';
  list.append(defineButton);

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    for (const button of list.querySelectorAll<HTMLElement>('.type-option')) {
      const match = !query || (button.dataset.search ?? '').includes(query);
      button.style.display = match ? '' : 'none';
    }
    for (const group of list.querySelectorAll<HTMLElement>('.type-option-group')) {
      group.hidden = !Array.from(group.querySelectorAll<HTMLElement>('.type-option')).some(
        (button) => button.style.display !== 'none',
      );
    }
  });

  setTimeout(() => search.focus(), 0);
  return wrap;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
