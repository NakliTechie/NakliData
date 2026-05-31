// Input cell — Wave 6 W6.1.
//
// An interactive parameter widget (text / number / date / select) whose
// current `value` is substituted into downstream SQL via `@<name>`
// reference resolution (see `Notebook.rewriteReferences` for the
// substitution rules). Observable's `viewof` + Briefer's interactive-
// input pattern, scoped to NakliData's notebook surface.
//
// Renders a small label + widget + (for select inputs) an options-
// editor. Changes are debounced via direct `onChange` calls; the
// notebook re-renders downstream cells automatically when the value
// changes (workbook subscribers fire on any cell patch). Users can
// also click "Run all" to force every downstream SQL cell to pick up
// the new value at once.

import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, InputCellState } from './types.ts';

export function renderInputCell(cell: InputCellState, handlers: CellHandlers): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'input';

  const labelText = (cell.label ?? cell.name ?? '(unnamed input)').trim();
  const nameWarn = !cell.name?.trim()
    ? '<span class="cell-input-warn" title="An input needs a @name so downstream SQL can reference it.">⚠ no name</span>'
    : '';

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">INPUT</span>
      <input class="cell-name" data-region="cell-name" value="${escapeAttr(cell.name ?? '')}"
             placeholder="@name (required)" aria-label="Input name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:12px;" />
      <select data-region="input-type" aria-label="Input type" style="font-size:12px;">
        ${['text', 'number', 'date', 'select']
          .map(
            (k) => `<option value="${k}" ${cell.inputType === k ? 'selected' : ''}>${k}</option>`,
          )
          .join('')}
      </select>
      <div class="cell-actions">
        ${nameWarn}
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-input-body" data-region="input-body" style="padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <label style="font-size:13px;color:var(--text);">${escapeHtml(labelText)}:</label>
      <div data-region="input-widget" style="flex:1 1 auto;min-width:200px;"></div>
    </div>
  `;

  // Bind name input — onBlur updates the cell name (the @ref handle).
  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  // Bind type select — switches the widget kind.
  const typeSel = el.querySelector<HTMLSelectElement>('[data-region="input-type"]');
  typeSel?.addEventListener('change', () => {
    const nextType = typeSel.value as InputCellState['inputType'];
    handlers.onChange(cell.id, { inputType: nextType });
  });

  // Delete.
  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  // Render the widget.
  const widgetMount = el.querySelector<HTMLElement>('[data-region="input-widget"]');
  if (widgetMount) renderWidget(widgetMount, cell, handlers);

  return el;
}

function renderWidget(mount: HTMLElement, cell: InputCellState, handlers: CellHandlers): void {
  mount.innerHTML = '';
  if (cell.inputType === 'select') {
    // Two regions: the value <select> + an inline options-editor.
    const sel = document.createElement('select');
    sel.style.cssText = 'font-size:13px;min-width:160px;padding:4px 8px;';
    sel.setAttribute('aria-label', 'Selected value');
    const options = cell.options.length > 0 ? cell.options : [''];
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt || '(empty)';
      if (opt === cell.value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      handlers.onChange(cell.id, { value: sel.value });
    });
    mount.appendChild(sel);

    const editor = document.createElement('input');
    editor.type = 'text';
    editor.placeholder = 'options: a, b, c';
    editor.value = cell.options.join(', ');
    editor.style.cssText =
      'font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;width:240px;color:var(--text-muted);';
    editor.setAttribute('aria-label', 'Option list (comma-separated)');
    editor.addEventListener('change', () => {
      const opts = editor.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // If the current value is no longer in the new options list,
      // default to the first option (or empty string).
      const value = opts.includes(cell.value) ? cell.value : (opts[0] ?? '');
      handlers.onChange(cell.id, { options: opts, value });
    });
    mount.appendChild(editor);
    return;
  }
  // text / number / date — single input element.
  const input = document.createElement('input');
  input.type = cell.inputType;
  input.value = cell.value;
  input.style.cssText =
    'font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;min-width:200px;font-family:var(--font-mono);';
  input.setAttribute('aria-label', cell.label ?? cell.name ?? 'Input value');
  if (cell.inputType === 'number') input.inputMode = 'decimal';
  input.addEventListener('change', () => {
    handlers.onChange(cell.id, { value: input.value });
  });
  mount.appendChild(input);
}

/**
 * Convert an InputCellState's `value` into a SQL literal suitable for
 * @-ref substitution. Used by `Notebook.rewriteReferences`.
 *
 *   text          → 'value' (single-quoted, internal quotes doubled)
 *   number        → bare numeric literal, or NULL if not a valid number
 *   date          → DATE 'YYYY-MM-DD'
 *   select(text)  → quoted string
 *   select(num)   → bare numeric if the value parses cleanly, else
 *                   quoted (caller's choice)
 *
 * Edge: empty `value` becomes `NULL` for date/number, empty string for
 * text/select. This matches DuckDB's behaviour around CASTs.
 */
export function inputAsSqlLiteral(cell: InputCellState): string {
  const v = cell.value;
  if (cell.inputType === 'number') {
    // Empty string parses as 0 in JS but should mean "unset" — NULL.
    if (!v.trim()) return 'NULL';
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : 'NULL';
  }
  if (cell.inputType === 'date') {
    if (!v.trim()) return 'NULL';
    // DuckDB accepts DATE 'YYYY-MM-DD'; the HTML date input always
    // emits ISO form, so no normalisation needed.
    return `DATE '${v.replace(/'/g, "''")}'`;
  }
  // text or select
  return `'${v.replace(/'/g, "''")}'`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
