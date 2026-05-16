// "Suggested reports" — type-gated list of templates that surfaces when
// the required types are present in the workbook.

import { iconSvg } from '../../tokens/icons.ts';
import type { CellState } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';
import {
  ALL_TEMPLATES,
  type ColumnRef,
  type Template,
  findApplicableTemplates,
  indexByTypeWithCandidates,
} from './templates.ts';

export interface TemplatePanelState {
  sources: Array<{ tables: Array<{ id: string; name: string }> }>;
  assignments: Record<string, ColumnAssignment>;
}

export interface TemplatePanelHandlers {
  onInstantiate: (cells: CellState[], templateId: string) => void;
}

let _idSeq = 1;
const genCellId = () => `tpl_${Date.now().toString(36)}_${_idSeq++}`;

export function renderTemplatePanel(
  root: HTMLElement,
  state: TemplatePanelState,
  handlers: TemplatePanelHandlers,
): void {
  injectCss();
  const region = root.querySelector<HTMLElement>('[data-region="templates-panel"]');
  if (!region) return;
  region.innerHTML = '';

  const { byType, perType } = indexByTypeWithCandidates(state.assignments, state.sources);
  const applicable = findApplicableTemplates(ALL_TEMPLATES, byType, perType);

  if (applicable.length === 0) {
    region.innerHTML = `<p style="color: var(--text-muted); font-size: 12px; margin: 0;">
      Mount sources with recognized columns (date, amount, vendor, etc.) to see suggested reports.
    </p>`;
    return;
  }

  for (const { template, matched } of applicable) {
    region.append(renderTemplateCard(template, matched, handlers));
  }
}

function renderTemplateCard(
  template: Template,
  matched: Record<string, ColumnRef | undefined>,
  handlers: TemplatePanelHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'template-card';
  const usedCols = Object.entries(matched)
    .filter(([, v]) => v)
    .map(([typeId, ref]) => `${ref!.table}.${ref!.column} → ${typeId}`)
    .join('<br/>');
  el.innerHTML = `
    <div class="template-head">
      <strong>${escapeHtml(template.name)}</strong>
      <button class="btn btn-primary" data-action="instantiate" style="font-size:11px;padding:2px 8px;">${iconSvg('plus', 12)} Add</button>
    </div>
    <p class="template-desc">${escapeHtml(template.description)}</p>
    <details>
      <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Matched columns</summary>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.5;">${usedCols}</div>
    </details>
  `;
  el.querySelector('[data-action="instantiate"]')?.addEventListener('click', () => {
    const cells = instantiateTemplate(template, matched);
    handlers.onInstantiate(cells, template.id);
  });
  return el;
}

function instantiateTemplate(
  template: Template,
  matched: Record<string, ColumnRef | undefined>,
): CellState[] {
  const partials = template.instantiate(matched);
  // Assign IDs and order; rewrite chart inputCell from a names-based reference
  // to the actual generated SQL cell id.
  const cells: CellState[] = partials.map((p, i) => {
    const c = { ...p, id: genCellId(), order: i } as CellState;
    return c;
  });
  const idByName = new Map<string, string>();
  for (const c of cells) {
    if (c.kind === 'sql' && c.name) idByName.set(c.name, c.id);
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c?.kind === 'chart' && c.inputCell === null) {
      // Templates currently bind chart cells to immediately-preceding named
      // SQL cells via the chart's `name` field unset; resolve by looking at
      // the previous SQL cell with a name.
      for (let j = i - 1; j >= 0; j--) {
        const prev = cells[j];
        if (prev?.kind === 'sql' && prev.name) {
          c.inputCell = prev.id;
          break;
        }
      }
    }
  }
  return cells;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectCss(): void {
  if (document.getElementById('naklidata-templates-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklidata-templates-css';
  tag.textContent = `
.templates-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.template-card {
  padding: 8px;
  margin-top: 8px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.template-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
}
.template-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 6px;
  line-height: 1.4;
}
`;
  document.head.appendChild(tag);
}
