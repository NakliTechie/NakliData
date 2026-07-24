// Network / force-graph RENDER BODY (Facet track) — the heavy half of the
// Network cell, split out of the shell so it rides a lazy chunk instead of the
// inlined bundle (spec §7.1 / A35). The cell CHROME (pickers, event wiring,
// empty states) stays in `src/ui/cells/network-cell.ts`; this module owns the
// graph build, force-layout orchestration, the node-metric worker round-trip,
// the deck.gl mount, and the edge-type legend — none of which run until a
// Network cell actually renders (mirrors how `facet-charts.ts` hosts the
// Temporal/Distribution render bodies).
//
// deck.gl itself lives in the shared `deckgl` lazy chunk; this chunk loads it on
// demand. The layout + metric caches live HERE (not the shell) because they are
// only ever populated by a render — the shell's `disposeNetworkCell` delegates
// to this module's `disposeNetworkCell`, and is a correct no-op until the first
// graph renders and pulls this chunk in.

import { rgbCss } from '../core/categorical-palette.ts';
import {
  type LayoutPositions,
  NETWORK_LAYOUT_MAX,
  NetworkTooLargeError,
  forceLayout,
} from '../core/force-layout.ts';
import { loadChunk } from '../core/lazy-loader.ts';
import { registerGlSurface } from '../ui/cells/gl-surface.ts';
import { computeNodeMetric } from '../ui/cells/graph-metrics-client.ts';
import type { NetworkCellState, NodeMetric } from '../ui/cells/types.ts';

// Node-count guards for the pricier metrics. These run in the graph-metrics
// WORKER now, so the cost of a big graph is a wait, not a frozen tab — which is
// what let them rise from the synchronous-era caps (3000 / 20000).
//
// Louvain is near-linear, so it now covers everything the force sim can lay out
// (today's NETWORK_LAYOUT_MAX). Kept as its OWN literal rather than aliased to
// NETWORK_LAYOUT_MAX on purpose: the 1M-node GPU-layout track would raise that
// ceiling, and Louvain-in-JS should NOT silently ride along to a million nodes.
// Betweenness stays capped far lower because Brandes is O(n·m) — off-thread
// makes it non-blocking, not fast, and past ~10k the honest answer is "no"
// rather than a spinner that runs for minutes. PageRank is cheap and uncapped.
// Above a cap the cell falls back to degree with a note.
const BETWEENNESS_MAX_NODES = 10000;
const COMMUNITY_MAX_NODES = 30000;

// Display labels for the node metrics. The shell keeps its own copy for the
// picker <option>s (network-cell.ts); this copy drives the tooltip + fallback
// notes. Closed four-metric set — the two copies mirror each other the way the
// chunk-local `escapeHtml` mirrors the shell's.
const METRIC_LABELS: Record<NodeMetric, string> = {
  degree: 'degree',
  pagerank: 'PageRank',
  betweenness: 'betweenness',
  community: 'community',
};

/** Structural subset of the deck.gl network handle the legend needs. */
interface LegendHandle {
  edgeLegend: () => Array<{ value: string; rgb: [number, number, number] }>;
  setEdgeTypeFilter: (type: string | null) => void;
}

/** Neighbours highlighted per node click (immediate adjacency, capped). */
const NEIGHBOUR_CAP = 200;

// Module-level layout cache: cellId → { sig, positions }. `sig` folds the
// inputs that change the layout (input cell, columns, row count); a cache hit
// skips the recompute on an unrelated re-render.
interface CacheEntry {
  sig: string;
  positions: LayoutPositions;
}
const _layoutCache = new Map<string, CacheEntry>();

// Parallel cache for the (pricier) node metrics, so an unrelated re-render
// doesn't recompute betweenness/Louvain — keyed by the layout sig + the chosen
// metric (metrics depend only on the graph, not on positions).
interface MetricCacheEntry {
  key: string;
  values: Map<string, number> | null;
  community: Map<string, number> | null;
}
const _metricCache = new Map<string, MetricCacheEntry>();

/** L27: cheap order-sensitive hash of node ids, folded into the layout cache
 *  signature so a re-run with the same count but different nodes re-lays out. */
function hashNodeIds(nodes: ReadonlyArray<{ id: string }>): string {
  let h = 2166136261;
  for (const n of nodes) {
    const s = n.id;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x2c; // ',' separator so ['ab','c'] ≠ ['a','bc']
  }
  return (h >>> 0).toString(36);
}

/** L27: drop a deleted cell's cached layout so positions don't leak for the
 *  tab's lifetime. Called (via the shell's delegate) from Notebook.deleteCell. */
export function disposeNetworkCell(id: string): void {
  _layoutCache.delete(id);
  _metricCache.delete(id);
}

interface GraphNode {
  id: string;
  degree: number;
}
interface GraphEdge {
  source: string;
  target: string;
  /** Categorical edge type (from edgeColorCol), or null. */
  colorValue: string | null;
  /** Numeric edge weight (from edgeWidthCol), or null. */
  weight: number | null;
}

/** Build the node set (distinct ids + degree) and edge list from result rows. */
function buildGraph(
  rows: Array<Record<string, unknown>>,
  sourceCol: string,
  targetCol: string,
  edgeColorCol: string | null,
  edgeWidthCol: string | null,
): { nodes: GraphNode[]; edges: GraphEdge[]; adjacency: Map<string, Set<string>> } {
  const degree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const edges: GraphEdge[] = [];
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  const link = (a: string, b: string) => {
    let set = adjacency.get(a);
    if (!set) {
      set = new Set();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const row of rows) {
    const s = row[sourceCol];
    const t = row[targetCol];
    if (s == null || t == null) continue;
    const source = String(s);
    const target = String(t);
    if (source === target) continue; // skip self-loops
    const colorValue = edgeColorCol
      ? row[edgeColorCol] == null
        ? null
        : String(row[edgeColorCol])
      : null;
    const rawW = edgeWidthCol ? Number(row[edgeWidthCol]) : Number.NaN;
    const weight = Number.isFinite(rawW) ? rawW : null;
    edges.push({ source, target, colorValue, weight });
    bump(source);
    bump(target);
    link(source, target);
    link(target, source);
  }
  const nodes: GraphNode[] = Array.from(degree, ([id, d]) => ({ id, degree: d }));
  return { nodes, edges, adjacency };
}

export async function renderGraph(
  mount: HTMLElement,
  tip: HTMLElement | null,
  cell: NetworkCellState,
  result: { rows: Array<Record<string, unknown>>; columns: string[] } | null,
): Promise<void> {
  if (!result || !cell.sourceCol || !cell.targetCol) return;
  mount.innerHTML = '<div class="cell-output-empty">Building graph…</div>';

  const edgeColorCol = cell.edgeColorCol ?? null;
  const edgeWidthCol = cell.edgeWidthCol ?? null;
  const { nodes, edges, adjacency } = buildGraph(
    result.rows,
    cell.sourceCol,
    cell.targetCol,
    edgeColorCol,
    edgeWidthCol,
  );
  if (nodes.length === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No edges in "${escapeHtml(cell.sourceCol)}" → "${escapeHtml(cell.targetCol)}" (both columns non-null?).</div>`;
    return;
  }
  if (nodes.length > NETWORK_LAYOUT_MAX) {
    // Honest ceiling — don't freeze the tab (or load the heavy chunk) on a
    // graph the in-browser force sim can't lay out interactively.
    mount.innerHTML = `<div class="cell-output-empty">Graph has ${nodes.length.toLocaleString()} nodes — in-browser force layout is limited to ${NETWORK_LAYOUT_MAX.toLocaleString()}. Filter the edge list down, or precompute x / y and use an Embedding cell to scatter them.</div>`;
    return;
  }

  // Layout FIRST (core module, no chunk needed), then the render chunk — so a
  // too-large or failed layout never fetches the heavy deck.gl bundle. Edge
  // colour/width don't affect POSITIONS, so they're absent from the layout sig.
  // L27: fold a hash of the node ids into the sig — counts alone let a re-run
  // with the SAME row/node count but DIFFERENT ids reuse a stale layout, dumping
  // the unknown nodes at [0,0].
  const sig = `${cell.inputCell}|${cell.sourceCol}|${cell.targetCol}|${result.rows.length}|${nodes.length}|${hashNodeIds(nodes)}`;
  let positions =
    _layoutCache.get(cell.id)?.sig === sig ? _layoutCache.get(cell.id)?.positions : null;
  if (!positions) {
    mount.innerHTML = `<div class="cell-output-empty">Laying out ${nodes.length.toLocaleString()} nodes / ${edges.length.toLocaleString()} edges…</div>`;
    try {
      // Yield to the event loop as the sim runs so the tab stays responsive
      // (the sim itself paces the callback to ~every 30 ms of compute).
      positions = await forceLayout(nodes, edges, {
        onIteration: () => new Promise((r) => setTimeout(r, 0)),
      });
    } catch (err) {
      const msg = err instanceof NetworkTooLargeError ? err.message : errMsg(err);
      mount.innerHTML = `<div class="cell-output-empty">Force layout failed: ${escapeHtml(msg)}</div>`;
      return;
    }
    _layoutCache.set(cell.id, { sig, positions });
  }

  mount.innerHTML = '';
  mount.style.height = '440px';

  let mod: Awaited<ReturnType<typeof loadChunk<'deckgl'>>>;
  try {
    mod = await loadChunk('deckgl');
  } catch (err) {
    mount.innerHTML = `<div class="cell-output-empty">Couldn't load the graph renderer: ${escapeHtml(errMsg(err))}</div>`;
    return;
  }
  // A fast follow-up re-render may already have replaced the notebook DOM while
  // we awaited layout + the chunk; building a Deck on the now-detached mount
  // would leak an unreachable WebGL context. Bail — the live render mounts it.
  if (!mount.isConnected) return;

  // Selected node metric → per-node colour/size. Degree is free (already on the
  // node); the others go to the graph-metrics worker (core/graph-metrics.ts runs
  // THERE, not here — that's what keeps it off the shell budget), guarded by
  // node-count caps so a huge graph falls back to degree instead of grinding.
  const metric = cell.nodeMetric ?? 'degree';
  let metricValues: Map<string, number> | null = null;
  let communityOf: Map<string, number> | null = null;
  let metricNote: string | null = null;
  const metricKey = `${sig}|${metric}`;
  const cachedMetric = _metricCache.get(cell.id);
  if (cachedMetric?.key === metricKey) {
    metricValues = cachedMetric.values;
    communityOf = cachedMetric.community;
  } else if (metric !== 'degree') {
    const cap = metric === 'betweenness' ? BETWEENNESS_MAX_NODES : COMMUNITY_MAX_NODES;
    if (metric !== 'pagerank' && nodes.length > cap) {
      metricNote = `${METRIC_LABELS[metric]} is limited to ${cap.toLocaleString()} nodes — showing degree`;
    } else {
      mount.innerHTML = `<div class="cell-output-empty">Computing ${METRIC_LABELS[metric]} over ${nodes.length.toLocaleString()} nodes…</div>`;
      try {
        const computed = await computeNodeMetric(metric, nodes, edges);
        metricValues = computed.values;
        communityOf = computed.community;
      } catch (err) {
        // A metric is a colour choice, not the graph — degrade to degree with a
        // visible note rather than fail the render.
        metricNote = `couldn't compute ${METRIC_LABELS[metric]} (${errMsg(err)}) — showing degree`;
      }
      mount.innerHTML = '';
    }
    // Cache the fallback too (null values + the note's cap/error) so flipping
    // back to this metric doesn't re-await a worker round-trip to learn the
    // same thing.
    _metricCache.set(cell.id, { key: metricKey, values: metricValues, community: communityOf });
  }
  // Same detachment guard as after the chunk load — the metric await is another
  // window in which a re-render can replace the notebook DOM under us.
  if (!mount.isConnected) return;

  // Render lists. `renderNodes` index === node index (used for highlight +
  // neighbour lookup); `idIndex` maps id → that index.
  const renderNodes = nodes.map((n) => {
    const p = positions.get(n.id) ?? [0, 0];
    const base = { id: n.id, position: p as [number, number], degree: n.degree };
    if (communityOf) {
      // Categorical colour by community; size stays degree-driven.
      return { ...base, community: communityOf.get(n.id) ?? 0, metricValue: n.degree };
    }
    if (metricValues) {
      const v = metricValues.get(n.id) ?? 0;
      const digits = metric === 'degree' ? 0 : 3;
      return {
        ...base,
        metricValue: v,
        metricLabel: `${METRIC_LABELS[metric]} ${v.toFixed(digits)}`,
      };
    }
    return base;
  });
  if (tip && metricNote) tip.textContent = metricNote;
  const idIndex = new Map<string, number>();
  renderNodes.forEach((n, i) => idIndex.set(n.id, i));
  const renderEdges = edges.flatMap((e) => {
    const s = positions.get(e.source);
    const t = positions.get(e.target);
    return s && t
      ? [{ sourcePosition: s, targetPosition: t, colorValue: e.colorValue, weight: e.weight }]
      : [];
  });

  try {
    const handle = mod.mountNetworkGraph({
      container: mount,
      nodes: renderNodes,
      edges: renderEdges,
      onHover: (label) => {
        if (tip && !tip.dataset.pinned) tip.textContent = label ?? '';
      },
      onClick: (index) => {
        if (index === null) {
          handle.setHighlight(null, []);
          if (tip) {
            delete tip.dataset.pinned;
            tip.textContent = '';
          }
          return;
        }
        const node = renderNodes[index];
        if (!node) return;
        const nbrIds = adjacency.get(node.id) ?? new Set<string>();
        const neighbors: number[] = [];
        for (const nid of nbrIds) {
          const i = idIndex.get(nid);
          if (i !== undefined) neighbors.push(i);
          if (neighbors.length >= NEIGHBOUR_CAP) break;
        }
        handle.setHighlight(index, neighbors);
        if (tip) {
          tip.dataset.pinned = '1';
          const shown = nbrIds.size > NEIGHBOUR_CAP ? `${NEIGHBOUR_CAP}+` : String(nbrIds.size);
          tip.textContent = `${node.id} — degree ${node.degree}, ${shown} neighbours highlighted — click background to clear`;
        }
      },
    });
    (mount as HTMLElement & { __networkGraph?: unknown }).__networkGraph = handle;
    // A11y (Chunk 6): the graph is WebGL — invisible to the accessibility tree,
    // so a DOM/ARIA-driving agent sees nothing here. Give the canvas mount a
    // text description of what it renders. (The __networkGraph seam remains the
    // interactive hook; this is the read-only legibility.)
    mount.setAttribute('role', 'img');
    mount.setAttribute(
      'aria-label',
      `Network graph: ${renderNodes.length.toLocaleString()} nodes, ${renderEdges.length.toLocaleString()} edges, coloured by ${METRIC_LABELS[metric]}.`,
    );
    // Release the deck.gl WebGL context on re-render / delete (gl-surface.ts).
    registerGlSurface(cell.id, () => handle.destroy());
    // Legend for the categorical edge-type colouring (Knowledge-graph view).
    // Lives in the cell's [data-region="net-legend"] sibling of the canvas.
    const legendEl = mount.parentElement?.querySelector<HTMLElement>('[data-region="net-legend"]');
    if (legendEl) renderLegend(legendEl, handle);
  } catch (err) {
    mount.innerHTML = `<div class="cell-output-empty">Couldn't render the graph: ${escapeHtml(errMsg(err))}</div>`;
  }
}

/**
 * Render the edge-type legend + wire click-to-filter. Swatch colours come from
 * `handle.edgeLegend()`, so they match the drawn edges exactly. Clicking a
 * swatch filters the graph to that type (others dim); clicking the active
 * swatch again clears. Empty when no edge-type column is set.
 */
function renderLegend(legendEl: HTMLElement, handle: LegendHandle): void {
  const legend = handle.edgeLegend();
  legendEl.innerHTML = '';
  if (legend.length === 0) return;
  let active: string | null = null;
  for (const { value, rgb } of legend) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.legendValue = value;
    btn.style.cssText =
      'display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;cursor:pointer;font-size:11px;color:var(--text-muted);padding:1px 2px;opacity:1;';
    btn.innerHTML = `<span style="width:10px;height:10px;border-radius:2px;background:${rgbCss(rgb)};display:inline-block;"></span>${escapeHtml(value)}`;
    btn.addEventListener('click', () => {
      active = active === value ? null : value;
      handle.setEdgeTypeFilter(active);
      for (const other of legendEl.querySelectorAll<HTMLElement>('[data-legend-value]')) {
        other.style.opacity = active === null || other.dataset.legendValue === active ? '1' : '0.4';
      }
    });
    legendEl.appendChild(btn);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
