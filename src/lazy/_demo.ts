// Tiny demo chunk. Verifies the lazy-loading pipeline end-to-end
// (esbuild → dist/chunks/_demo.js → runtime import via loadChunk).
//
// Real chunks land here as they're built:
//   - codemirror.ts (pre-v1.0-tag gate)
//   - observable-plot.ts (Theme 2)
//   - maplibre.ts (Theme 2)

export function greet(name: string): string {
  return `hello from lazy chunk, ${name}!`;
}

/** Identity-checkable marker so tests can assert this module was loaded. */
export const LAZY_DEMO_MARKER = Symbol('LAZY_DEMO_MARKER');
