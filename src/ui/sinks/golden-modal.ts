// Resolve track M3 — Golden-table export dialog.
//
// Promise-based config modal for the golden-table sink: pick the canonical
// entity column, a survivorship rule per other column, an order column (for
// 'latest'), and CSV/Parquet. Returns the GoldenSpec, or null on cancel. The
// SQL build + injection-safety live in core/golden.ts; this file is DOM only.

import {
  type GoldenFormat,
  type GoldenSpec,
  SURVIVORSHIP_RULES,
  type SurvivorshipRule,
  buildGoldenSql,
  needsOrderColumn,
} from '../../core/golden.ts';
import { iconSvg } from '../../tokens/icons.ts';
import { restoreModalFocus } from '../modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

/** Default the entity to a `__merged` column (M1's output) when present. */
function defaultEntity(columns: ReadonlyArray<string>): string {
  return columns.find((c) => c.endsWith('__merged')) ?? columns[0] ?? '';
}

export function openGoldenModal(opts: {
  columns: ReadonlyArray<string>;
  sourceLabel: string;
}): Promise<GoldenSpec | null> {
  return new Promise((resolve) => {
    if (_modalEl) {
      resolve(null);
      return;
    }
    const previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    const columns = [...opts.columns];
    let entity = defaultEntity(columns);
    const rules = new Map<string, SurvivorshipRule>(columns.map((c) => [c, 'first']));
    let orderColumn: string | null = columns.find((c) => c !== entity) ?? null;
    let format: GoldenFormat = 'csv';

    const buildSpec = (): GoldenSpec => ({
      entityColumn: entity,
      columns: columns.map((c) => ({ columnName: c, rule: rules.get(c) ?? 'first' })),
      orderColumn,
      format,
    });

    const close = (result: GoldenSpec | null): void => {
      if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
      _modalEl = null;
      if (_onKey) {
        document.removeEventListener('keydown', _onKey);
        _onKey = null;
      }
      restoreModalFocus(previouslyFocused);
      resolve(result);
    };

    const rebuild = (): void => {
      if (!_modalEl) return;
      const fresh = render();
      _modalEl.replaceWith(fresh);
      _modalEl = fresh;
    };

    const render = (): HTMLElement => {
      const overlay = document.createElement('div');
      overlay.className = 'schema-graph-overlay golden-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'golden-title');

      const entityOptions = columns
        .map(
          (c) =>
            `<option value="${escapeAttr(c)}" ${c === entity ? 'selected' : ''}>${escapeHtml(c)}</option>`,
        )
        .join('');

      const ruleRows = columns
        .filter((c) => c !== entity)
        .map((c) => {
          const r = rules.get(c) ?? 'first';
          const ruleOptions = SURVIVORSHIP_RULES.map(
            (o) =>
              `<option value="${o.value}" ${o.value === r ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
          ).join('');
          return `
            <li style="display:flex;align-items:center;gap:8px;padding:4px 0;">
              <span style="flex:1;font-size:12px;font-family:var(--font-mono);">${escapeHtml(c)}</span>
              <select data-region="g-rule" data-column="${escapeAttr(c)}" aria-label="Survivorship rule for ${escapeAttr(c)}" style="font-size:11px;">${ruleOptions}</select>
            </li>`;
        })
        .join('');

      const showOrder = needsOrderColumn(buildSpec().columns);
      const orderOptions = columns
        .map(
          (c) =>
            `<option value="${escapeAttr(c)}" ${c === orderColumn ? 'selected' : ''}>${escapeHtml(c)}</option>`,
        )
        .join('');
      const orderRow = showOrder
        ? `<label style="font-size:12px;display:block;margin-top:var(--space-2);">Order column — "latest" keeps the row with the MAX of this column
             <select data-region="g-order" style="display:block;margin-top:2px;">${orderOptions}</select></label>`
        : '';

      let preview: string;
      try {
        preview = buildGoldenSql(buildSpec(), opts.sourceLabel);
      } catch (e) {
        preview = `⚠ ${e instanceof Error ? e.message : String(e)}`;
      }

      overlay.innerHTML = `
        <div class="schema-graph-modal golden-modal" role="document" style="width:min(680px,100%);height:auto;max-height:min(88vh,760px);display:flex;flex-direction:column;">
          <header class="schema-graph-header">
            <h2 id="golden-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">${iconSvg('database', 14)} Export golden table</h2>
          </header>
          <div style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
            <p style="font-size:12px;color:var(--text-muted);margin:0 0 var(--space-2) 0;">One row per canonical entity, each other column collapsed by a survivorship rule. Most useful on a clustered <code>__merged</code> column. A file you keep — nothing leaves the tab.</p>
            <label style="font-size:12px;">Entity column (group by — one row per distinct value)
              <select data-region="g-entity" style="display:block;margin-top:2px;min-width:200px;">${entityOptions}</select></label>
            <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Survivorship per column</h3>
            <ul style="list-style:none;padding:0;margin:0;">${ruleRows || '<li style="font-size:12px;color:var(--text-muted);">No other columns — emits the distinct entities.</li>'}</ul>
            ${orderRow}
            <div role="group" aria-label="Output format" style="display:flex;gap:14px;margin-top:var(--space-3);font-size:12px;align-items:center;">
              <span style="color:var(--text-muted);">Format</span>
              <label><input type="radio" name="g-format" data-region="g-format" value="csv" ${format === 'csv' ? 'checked' : ''} /> CSV</label>
              <label><input type="radio" name="g-format" data-region="g-format" value="parquet" ${format === 'parquet' ? 'checked' : ''} /> Parquet</label>
            </div>
            <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Preview</h3>
            <pre data-region="g-preview" style="white-space:pre-wrap;font-family:var(--font-mono);background:var(--surface-alt);border-left:3px solid var(--accent);padding:8px 12px;border-radius:4px;font-size:11px;margin:0;max-height:160px;overflow:auto;">${escapeHtml(preview)}</pre>
          </div>
          <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
            <button class="btn btn-ghost" data-action="g-cancel">Cancel</button>
            <button class="btn btn-primary" data-action="g-export">Export golden table</button>
          </footer>
        </div>
      `;

      overlay.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (target === overlay || target.closest('[data-action="g-cancel"]')) return close(null);
        if (target.closest('[data-action="g-export"]')) return close(buildSpec());
      });
      overlay.addEventListener('change', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (target.matches('[data-region="g-entity"]')) {
          entity = (target as HTMLSelectElement).value;
          if (orderColumn === entity) orderColumn = columns.find((c) => c !== entity) ?? null;
          return rebuild();
        }
        if (target.matches('[data-region="g-rule"]')) {
          const col = (target as HTMLElement).dataset.column ?? '';
          rules.set(col, (target as HTMLSelectElement).value as SurvivorshipRule);
          return rebuild();
        }
        if (target.matches('[data-region="g-order"]')) {
          orderColumn = (target as HTMLSelectElement).value;
          return rebuild();
        }
        if (target.matches('[data-region="g-format"]')) {
          // Format doesn't change the SQL preview — update state without a rebuild.
          format = (target as HTMLInputElement).value as GoldenFormat;
        }
      });

      return overlay;
    };

    const overlay = render();
    document.body.append(overlay);
    _modalEl = overlay;
    _onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', _onKey);
    overlay.querySelector<HTMLElement>('[data-action="g-cancel"]')?.focus();
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
