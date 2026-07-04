// Lazy chunk loader. Each entry in `src/lazy/<name>.ts` is built by
// esbuild into `dist/chunks/<name>.js` as a standalone ESM module. At
// runtime we dynamically import the chunk URL — esbuild leaves the
// import alone because the URL is constructed from a runtime variable.
//
// This is the v1.1 mechanism for keeping heavy deps (CodeMirror 6,
// Observable Plot, MapLibre GL, etc.) out of the inlined shell while
// still loading them on demand the first time a user opens a SQL cell
// / chart cell / map cell.
//
// Caching is per-chunk: subsequent loads of the same chunk reuse the
// resolved module without re-fetching.

const cache = new Map<string, Promise<unknown>>();

export interface LazyChunkRegistry {
  // Add entries here as chunks ship. The string keys must match the
  // basename of files in `src/lazy/<name>.ts` (without the `.ts`).
  _demo: typeof import('../lazy/_demo.ts');
  codemirror: typeof import('../lazy/codemirror.ts');
  'observable-plot': typeof import('../lazy/observable-plot.ts');
  'cytoscape-graph': typeof import('../lazy/cytoscape-graph.ts');
  'maplibre-map': typeof import('../lazy/maplibre-map.ts');
  /**
   * The single deck.gl chunk — hosts all three Facet renderers behind separate
   * exports (mountEmbeddingScatter / mountNetworkGraph / mountDeckGlPoints) so
   * deck.gl + luma.gl are bundled ONCE across the embedding cell, the network
   * cell, and the map cell's above-threshold scatter overlay (DECISIONS BT
   * follow-up — replaces the earlier deckgl-embedding / -network / -points
   * chunks, which each duplicated deck.gl and double-inited luma).
   */
  deckgl: typeof import('../lazy/deckgl.ts');
  /** Excel mounts — SheetJS parses xlsx → CSV; the CSV mount path takes over. */
  sheetjs: typeof import('../lazy/sheetjs.ts');
  /** W3.2 slice B — Transformers.js for local-model inference. */
  transformers: typeof import('../lazy/transformers.ts');
  // (v1.3 M2's lazy 'measures-panel' entry removed in v1.4 F1 — the panel
  // writes to store singletons, so a self-contained chunk diverged its
  // own copies from the main bundle's. The panel is now imported directly
  // into main, sharing the real stores.)
}

export type LazyChunkName = keyof LazyChunkRegistry;

/**
 * Load a lazy chunk by name. The first call kicks off the fetch+parse;
 * subsequent calls (anywhere in the app) return the same resolved module
 * without a second network hop.
 *
 * The URL is constructed from a runtime variable so esbuild's static
 * analyzer leaves the dynamic import alone and ships the chunk as a
 * separate file rather than inlining it into the main bundle.
 */
export function loadChunk<K extends LazyChunkName>(name: K): Promise<LazyChunkRegistry[K]> {
  let p = cache.get(name);
  if (!p) {
    // Resolve against document.baseURI so deploys under a subpath
    // (e.g., GitHub Pages at `/NakliData/`) work — a leading-slash URL
    // would 404 there.
    const url = new URL(`./chunks/${name}.js`, document.baseURI).href;
    // Forward-pass L9 (2026-06-02): dropped the Vite-specific
    // `/* @vite-ignore */` magic comment — this project uses esbuild,
    // which ignores unknown comments. The dynamic URL itself is what
    // prevents the bundler from trying to resolve the import at build
    // time; no comment annotation is required.
    p = import(url);
    cache.set(name, p);
  }
  return p as Promise<LazyChunkRegistry[K]>;
}

/** For tests — wipe the in-memory cache so each test sees fresh loads. */
export function _resetChunkCacheForTests(): void {
  cache.clear();
}
