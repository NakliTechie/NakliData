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
  /** Facet track — SVG renderers for the Temporal timeline + Distribution bars. */
  'facet-charts': typeof import('../lazy/facet-charts.ts');
  /** Excel mounts — SheetJS parses xlsx → CSV; the CSV mount path takes over. */
  sheetjs: typeof import('../lazy/sheetjs.ts');
  /**
   * Arrow mounts — apache-arrow re-frames an IPC *file* (`.arrow`/`.feather`,
   * `ARROW1` magic + footer) as an IPC *stream* so the engine's
   * `insertArrowFromIPCStream` ingests it. Fixes the silent no-op where a
   * file-format buffer produced no table (DECISIONS BX/F2).
   */
  'arrow-reader': typeof import('../lazy/arrow-reader.ts');
  /**
   * SQLite mounts — sql.js reads the DB file's bytes and extracts each table
   * as NDJSON; the engine loads them via read_json_auto. Bypasses DuckDB-wasm's
   * sqlite_scanner, whose VFS can't open a browser-registered file (any version
   * / protocol). See src/lazy/sqlite-reader.ts + DECISIONS 2026-07-04.
   */
  'sqlite-reader': typeof import('../lazy/sqlite-reader.ts');
  /**
   * Statistical-format mounts — ReadStat compiled to wasm reads SPSS/Stata/SAS
   * files (`.sav/.zsav/.por/.dta/.sas7bdat/.xpt`) and emits NDJSON the engine
   * loads via read_json_auto. Owns the reader because DuckDB's `read_stat`
   * community ext has no wasm build (F3 reopen / Polyglot-Workbench Fork 1).
   * See src/lazy/readstat-reader.ts + src/vendor/readstat/.
   */
  'readstat-reader': typeof import('../lazy/readstat-reader.ts');
  /**
   * Python cell (Polyglot-Workbench Fork 2) — Pyodide 0.27.7 + pandas + pyarrow,
   * loaded same-origin from the vendored public/pyodide/. Arrow-in / Arrow-out;
   * the result re-registers as a DuckDB table. See src/lazy/pyodide-runtime.ts +
   * scripts/fetch-pyodide.mjs + DECISIONS CE.
   */
  'pyodide-runtime': typeof import('../lazy/pyodide-runtime.ts');
  /**
   * R cell (Polyglot-Workbench Fork 2) — WebR loaded same-origin from the
   * vendored public/webr/. CSV interchange over WebR's VFS; needs SharedArray-
   * Buffer (cross-origin isolation, DECISIONS CG). See src/lazy/webr-runtime.ts.
   */
  'webr-runtime': typeof import('../lazy/webr-runtime.ts');
  /** W3.2 slice B — Transformers.js for local-model inference. */
  transformers: typeof import('../lazy/transformers.ts');
  /**
   * Wave 7 (Jobs 9 & 10) — the ontology sidecar jobs (assign-type +
   * nl-to-schema) and the NL→schema modal. Loaded on the schema-panel
   * "Ask AI to classify" / notebook "Infer schema" clicks, so their
   * prompts/parsers + the modal stay off the inlined shell budget
   * (spec §7.1 / A35). Safe to split: no store singletons — the modal
   * returns DDL via an `onInsert` callback the shell handles.
   */
  'sidecar-ontology': typeof import('../lazy/sidecar-ontology.ts');
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
    // M5: don't cache a REJECTED import forever — one transient network failure
    // would otherwise brick this chunk for the whole session (every retry
    // re-awaits the same rejection). Evict on failure so a retry re-imports.
    p.catch(() => {
      if (cache.get(name) === p) cache.delete(name);
    });
    cache.set(name, p);
  }
  return p as Promise<LazyChunkRegistry[K]>;
}

/** For tests — wipe the in-memory cache so each test sees fresh loads. */
export function _resetChunkCacheForTests(): void {
  cache.clear();
}
