// v1.4 F9 — Embeddable read-only widget.
//
// Wrap the self-contained Export-HTML document (markdown + chart SVGs +
// result tables; NO JS, NO engine — see `ui/export-html.ts`) in a
// **sandboxed `<iframe srcdoc>`** snippet the user pastes into any wiki /
// intranet / CMS page. Server-free, read-only, and — because the export
// carries no scripts — the iframe needs an EMPTY `sandbox` (no
// `allow-scripts`, no `allow-same-origin`): maximally locked down.
//
// Why srcdoc over a `?lens=`-pointed iframe (the original sketch): a lens
// carries the workbook DESCRIPTION but no data, so a lens iframe would
// render empty charts for any local-file notebook. srcdoc embeds the
// already-RENDERED export, so the content actually shows + needs no
// reachable server (DECISIONS AO).
//
// **Engine-boundary contract (v1.3 M0):** pure string transform. No DOM,
// no FSA, no globals.

export interface EmbedOptions {
  /** Iframe pixel height. Clamped to [120, 4000]. Default 600. */
  height?: number;
}

/**
 * Build the `<iframe srcdoc="…" sandbox …>` snippet for a standalone
 * Export-HTML document. The doc is HTML-attribute-escaped (`&` then `"`)
 * so the browser un-escapes it back to the original on parse.
 */
export function buildEmbedSnippet(standaloneHtml: string, opts: EmbedOptions = {}): string {
  const height = Math.max(120, Math.min(4000, Math.floor(opts.height ?? 600)));
  // Escape `&` first (so we don't re-hit the `&` we introduce for `"`),
  // then `"`. `<`/`>` are legal inside a double-quoted attribute value.
  const srcdoc = standaloneHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<iframe title="NakliData notebook" sandbox style="width:100%;height:${height}px;border:1px solid #d9d2c4;border-radius:8px;" srcdoc="${srcdoc}"></iframe>`;
}
