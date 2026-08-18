import {
  type AcceptedSkosProposals,
  type SkosImportResult,
  acceptSkosProposals,
  browseSkosVocabulary,
} from '../core/standards/skos.ts';
import { restoreModalFocus, trapModalTab } from '../ui/modal-focus.ts';

export {
  acceptSkosProposals,
  browseSkosVocabulary,
  buildTaxonomySkosConcepts,
  exportSkosTurtle,
  importSkosTurtle,
  MAX_SKOS_BYTES,
  MAX_SKOS_CONCEPTS,
  MAX_SKOS_LABELS,
  MAX_SKOS_QUADS,
  RDF_IRI,
  SKOS_IRI,
} from '../core/standards/skos.ts';

export type {
  AcceptedSkosProposals,
  SkosConceptProposal,
  SkosExportOptions,
  SkosExportResult,
  SkosImportResult,
  SkosSchemeProposal,
  SkosVocabularyRow,
  TaxonomySkosOptions,
  TaxonomySkosResult,
} from '../core/standards/skos.ts';

export interface SkosVocabularyBrowserOptions {
  onAccept: (accepted: AcceptedSkosProposals) => void;
}

let vocabularyBrowser: HTMLElement | null = null;
let vocabularyBrowserPreviousFocus: HTMLElement | null = null;
let vocabularyBrowserKeyHandler: ((event: KeyboardEvent) => void) | null = null;

/** Review-only vocabulary browser. Acceptance returns records through a callback. */
export function openSkosVocabularyBrowser(
  imported: SkosImportResult,
  options: SkosVocabularyBrowserOptions,
): void {
  if (vocabularyBrowser) return;
  vocabularyBrowserPreviousFocus = document.activeElement as HTMLElement | null;
  const selected = new Set<string>();
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'skos-vocabulary-title');

  const modal = document.createElement('div');
  modal.className = 'schema-graph-modal';
  modal.setAttribute('role', 'document');
  modal.style.cssText =
    'width:min(820px,100%);max-height:min(90vh,820px);display:flex;flex-direction:column;';
  const header = document.createElement('header');
  header.className = 'schema-graph-header';
  const heading = document.createElement('div');
  const title = document.createElement('h2');
  title.id = 'skos-vocabulary-title';
  title.textContent = 'Review business vocabulary';
  title.style.cssText = 'margin:0;font-size:var(--text-md,15px);';
  const summary = document.createElement('p');
  summary.style.cssText = 'margin:3px 0 0;color:var(--text-muted);font-size:11px;';
  summary.textContent = `${imported.concepts.length} concepts · ${imported.schemes.length} schemes · ${imported.losses.length} disclosures`;
  heading.append(title, summary);
  const close = document.createElement('button');
  close.className = 'btn btn-ghost schema-graph-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close vocabulary browser');
  close.textContent = '×';
  header.append(heading, close);

  const body = document.createElement('div');
  body.style.cssText =
    'padding:var(--space-3) var(--space-4);overflow:auto;display:grid;gap:var(--space-3);';
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Search concepts and aliases';
  searchLabel.style.cssText = 'font-size:11px;color:var(--text-muted);';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Vendor, supplier, amount…';
  search.style.cssText = 'display:block;width:100%;margin-top:4px;';
  searchLabel.append(search);
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Vocabulary concepts');
  list.style.cssText = 'display:grid;gap:var(--space-2);';
  body.append(searchLabel, list);

  const footer = document.createElement('footer');
  footer.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);';
  const selectionStatus = document.createElement('span');
  selectionStatus.style.cssText = 'font-size:11px;color:var(--text-muted);';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:var(--space-2);';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const accept = document.createElement('button');
  accept.className = 'btn btn-primary';
  accept.type = 'button';
  accept.textContent = 'Accept selected';
  actions.append(cancel, accept);
  footer.append(selectionStatus, actions);
  modal.append(header, body, footer);
  overlay.append(modal);

  const render = (): void => {
    list.replaceChildren();
    const rows = browseSkosVocabulary(imported, search.value, 100).filter(
      (row) => row.kind === 'concept',
    );
    for (const row of rows) {
      const label = document.createElement('label');
      label.setAttribute('role', 'listitem');
      label.style.cssText =
        'display:grid;grid-template-columns:auto 1fr;gap:var(--space-2);align-items:start;border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-2);';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(row.sourceIri);
      checkbox.setAttribute('aria-label', `Select ${row.label}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(row.sourceIri);
        else selected.delete(row.sourceIri);
        updateSelection();
      });
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = row.label;
      const detail = document.createElement('span');
      detail.style.cssText =
        'display:block;margin-top:2px;color:var(--text-muted);font-size:11px;overflow-wrap:anywhere;';
      detail.textContent = [row.aliases.join(', '), row.sourceIri].filter(Boolean).join(' · ');
      copy.append(name, detail);
      label.append(checkbox, copy);
      list.append(label);
    }
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No matching concepts.';
      empty.style.cssText = 'color:var(--text-muted);font-size:12px;';
      list.append(empty);
    }
  };
  const updateSelection = (): void => {
    selectionStatus.textContent = `${selected.size} selected`;
    accept.disabled = selected.size === 0;
  };
  const closeBrowser = (): void => closeSkosVocabularyBrowser();
  close.addEventListener('click', closeBrowser);
  cancel.addEventListener('click', closeBrowser);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeBrowser();
  });
  search.addEventListener('input', render);
  accept.addEventListener('click', () => {
    options.onAccept(acceptSkosProposals(imported, [...selected]));
    closeBrowser();
  });
  vocabularyBrowserKeyHandler = (event) => {
    if (event.key === 'Escape') closeBrowser();
    else trapModalTab(event, overlay);
  };
  document.addEventListener('keydown', vocabularyBrowserKeyHandler);
  document.body.append(overlay);
  vocabularyBrowser = overlay;
  render();
  updateSelection();
  search.focus();
}

export function closeSkosVocabularyBrowser(): void {
  vocabularyBrowser?.remove();
  vocabularyBrowser = null;
  if (vocabularyBrowserKeyHandler) {
    document.removeEventListener('keydown', vocabularyBrowserKeyHandler);
    vocabularyBrowserKeyHandler = null;
  }
  restoreModalFocus(vocabularyBrowserPreviousFocus);
  vocabularyBrowserPreviousFocus = null;
}
