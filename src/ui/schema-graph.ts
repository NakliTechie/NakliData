// Schema-graph modal — opens a Cytoscape.js view of the taxonomy's
// type-relationship graph. Nodes are types; edges are
// `taxonomy/v0.1/relationships.json` entries. Cytoscape is a lazy
// chunk; nothing is fetched until the user clicks the "Show graph"
// button.

import { loadChunk } from '../core/lazy-loader.ts';
import { getTaxonomyClient } from '../taxonomy/client.ts';
import { iconSvg } from '../tokens/icons.ts';

let _activeHandle: { destroy: () => void } | null = null;
let _modalEl: HTMLElement | null = null;

export async function openSchemaGraph(): Promise<void> {
  // Singleton modal — clicking the button twice doesn't stack modals.
  if (_modalEl && document.body.contains(_modalEl)) return;

  const overlay = renderModal();
  document.body.append(overlay);
  _modalEl = overlay;

  const canvas = overlay.querySelector<HTMLElement>('[data-region="graph-canvas"]');
  const statusEl = overlay.querySelector<HTMLElement>('[data-region="graph-status"]');
  if (!canvas || !statusEl) return;

  statusEl.textContent = 'Loading taxonomy…';
  try {
    const client = getTaxonomyClient();
    await client.ensureReady();
    const bundle = client.getBundle();
    if (!bundle) {
      statusEl.textContent = 'Taxonomy bundle is unavailable.';
      return;
    }
    const rels = bundle.relationships ?? [];
    if (rels.length === 0) {
      statusEl.textContent = 'No type relationships are defined in this taxonomy.';
      return;
    }

    // Build nodes from the types that appear in any relationship — keeps
    // the graph focused on connected components rather than showing every
    // type the bundle ships.
    const inRels = new Set<string>();
    for (const r of rels) {
      inRels.add(r.from);
      inRels.add(r.to);
    }
    const nodes = bundle.types
      .filter((t) => inRels.has(t.id))
      .map((t) => ({ id: t.id, label: t.display_name, domain: t.domain }));
    const edges = rels.map((r) => ({
      source: r.from,
      target: r.to,
      kind: r.kind,
      ...(r.note ? { note: r.note } : {}),
    }));

    statusEl.textContent = `${nodes.length} types, ${edges.length} relationships`;
    const mod = await loadChunk('cytoscape-graph');
    _activeHandle = mod.mountGraph({
      container: canvas,
      nodes,
      edges,
      onNodeClick: (id) => {
        const t = bundle.types.find((x) => x.id === id);
        if (t) {
          statusEl.textContent = `${t.display_name} — domain: ${t.domain}`;
        }
      },
    });
  } catch (err) {
    statusEl.textContent = `Failed to render graph: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function closeSchemaGraph(): void {
  if (_activeHandle) {
    _activeHandle.destroy();
    _activeHandle = null;
  }
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
}

function renderModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Type relationship graph');
  overlay.innerHTML = `
    <div class="schema-graph-modal" data-region="schema-graph-modal">
      <div class="schema-graph-header">
        <strong>Type relationships</strong>
        <span data-region="graph-status" class="schema-graph-status">Loading…</span>
        <button class="btn btn-ghost schema-graph-close" data-action="close-schema-graph" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="schema-graph-canvas" data-region="graph-canvas"></div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    // Click on backdrop (overlay itself) closes; click inside modal doesn't.
    if (target === overlay) closeSchemaGraph();
    if (target.closest('[data-action="close-schema-graph"]')) closeSchemaGraph();
  });
  // Escape closes.
  document.addEventListener(
    'keydown',
    function onKey(ev) {
      if (ev.key === 'Escape') {
        closeSchemaGraph();
        document.removeEventListener('keydown', onKey);
      }
    },
    { once: false },
  );
  return overlay;
}
