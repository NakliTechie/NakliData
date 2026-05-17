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
    const url = `/chunks/${name}.js`;
    p = import(/* @vite-ignore */ url);
    cache.set(name, p);
  }
  return p as Promise<LazyChunkRegistry[K]>;
}

/** For tests — wipe the in-memory cache so each test sees fresh loads. */
export function _resetChunkCacheForTests(): void {
  cache.clear();
}
