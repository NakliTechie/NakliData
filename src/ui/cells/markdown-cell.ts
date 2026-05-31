// Markdown cell. Minimal renderer — headings, paragraphs, bold/italic,
// inline code, lists. No third-party markdown lib.

import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, MarkdownCellState } from './types.ts';

export function renderMarkdownCell(cell: MarkdownCellState, handlers: CellHandlers): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'markdown';

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">MD</span>
      <input class="cell-name" data-region="cell-name" value="${escapeAttr(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Markdown cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-toggle" title="Edit / preview">
          ${iconSvg('pencil', 12)}
        </button>
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div data-region="markdown-body"></div>
  `;

  // Bind the name input (W6.4 — dashboards reference cells by name).
  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  const body = el.querySelector<HTMLElement>('[data-region="markdown-body"]');
  let editing = cell.code.trim().length === 0;

  function render(): void {
    if (!body) return;
    body.innerHTML = '';
    if (editing) {
      const ta = document.createElement('textarea');
      ta.placeholder = '# Heading\n\nWrite notes here.';
      ta.value = cell.code;
      ta.style.cssText =
        'width:100%;min-height:120px;padding:12px;border:0;font:13px/1.5 var(--font-mono);background:transparent;outline:none;resize:vertical;';
      ta.addEventListener('input', () => {
        handlers.onChange(cell.id, { code: ta.value });
      });
      ta.addEventListener('blur', () => {
        if (ta.value.trim().length > 0) {
          editing = false;
          render();
        }
      });
      body.append(ta);
      setTimeout(() => ta.focus(), 0);
    } else {
      const preview = document.createElement('div');
      preview.className = 'markdown-preview';
      preview.innerHTML = renderMarkdown(cell.code);
      preview.addEventListener('dblclick', () => {
        editing = true;
        render();
      });
      body.append(preview);
    }
  }

  el.querySelector('[data-action="cell-toggle"]')?.addEventListener('click', () => {
    editing = !editing;
    render();
  });
  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  render();
  return el;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderMarkdown(src: string): string {
  // Minimal markdown subset: headings, paragraphs, bold/italic, inline code,
  // unordered/ordered lists. Sufficient for v1.0 notebook annotations.
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = h[1]?.length ?? 1;
      out.push(`<h${level}>${inline(h[2] ?? '')}</h${level}>`);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (listKind !== 'ul') {
        closeList();
        out.push('<ul>');
        listKind = 'ul';
      }
      out.push(`<li>${inline(ul[1] ?? '')}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (listKind !== 'ol') {
        closeList();
        out.push('<ol>');
        listKind = 'ol';
      }
      out.push(`<li>${inline(ol[1] ?? '')}</li>`);
      continue;
    }
    if (line === '') {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join('\n');
}
