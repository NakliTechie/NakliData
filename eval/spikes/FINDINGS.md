# Facet Chunk 2 — Network-view engine spike (2026-07-03)

De-risking the pinned engine (DECISIONS BF: **deck.gl render + `@antv/layout`
force layout**) before building the view-type track on it. Test data: the M0
citation graph — **2,600 papers / 10,638 citations**.

## Result: both halves validated (with one real caveat)

### deck.gl render — ✅ works, no concern
A standalone `Deck` (OrthographicView) with `LineLayer` edges + `ScatterplotLayer`
nodes renders the full 2,600-node / 10,638-edge graph cleanly in the browser:
node size by in-degree, hubs coloured (ResNet & co. as red centres), all edges
drawn, pan/zoom via the controller. This is the low-risk half — deck.gl is built
for this scale — and it's confirmed. (`network-spike.mjs`; screenshot in the
session.) Needs WebGL2 (present in the test Chrome).

### `@antv/layout` force layout — ✅ works, ⚠️ JS path too slow at scale
`@antv/layout` v2 produces valid finite coordinates for all 2,600 nodes
(`ForceAtlas2Layout` / `ForceLayout` / `FruchtermanLayout`). API contract (v2):
`await layout.execute({nodes:[{id,data}], edges:[{id,source,target,data}]})`
mutates an internal model; read positions via `layout.forEachNode(n => n.x/n.y)`.

**But the pure-JS main-thread path is too slow** — at just 2,600 nodes:

| layout | 100–400 iters | verdict |
|--------|---------------|---------|
| ForceAtlas2 | ~26 s | unusable |
| Force | ~9 s | unusable |
| Fruchterman | ~7–15 s | unusable |

At the 100k–1M target (BF) this is categorically out. So **the accel path is
required, not optional** — and it carries real integration constraints:

- **`@antv/layout-wasm`** (the WASM/worker path): **browser-only** (crashes in
  Node reading `document.baseURI`), runs the force in a **Web Worker + WASM that
  needs `SharedArrayBuffer` → cross-origin isolation (COOP + COEP headers)**.
  That collides with NakliData's cross-origin DuckDB CDN load (COEP requires
  CORP/CORS on every cross-origin resource) — a real integration problem to solve
  (same-origin-vendor the layout worker, or proxy/relax). **Removed from deps for
  now — unvalidated in-browser.**
- **`@antv/layout-gpu`** (WebGL): needs WebGL + `OES_texture_float` (the extension
  Facet's own notes flagged). Not yet tested.

## Implication for BF (refinement, not reversal)

BF stands — deck.gl renders at scale, `@antv/layout` gives correct layouts. But
the "routine 1M-node force" claim (DECISIONS BF) **hinges on an accel layout path
that is not yet validated in-browser and has a cross-origin-isolation cost.**
Before committing views to 1M-scale force layout, the next de-risk is:

1. Validate `@antv/layout-wasm` (or `-gpu`) **in-browser** at 50k–1M nodes +
   solve the COOP/COEP-vs-DuckDB-CDN tension.
2. Fallbacks if the accel path disappoints: precompute layout server/worker-side;
   or a bespoke WebGPU compute-shader force sim (NakliData already runs WebGPU).
3. For the **Embedding view** (precomputed x,y), no layout is needed — deck.gl
   renders it directly; that view is unblocked regardless.

## Files
`antv-layout-test.mjs` (JS-layout benchmark) · `compute-layout.mjs` (precompute →
`network-data.json`) · `network-spike.mjs` + `.html` (deck.gl render) ·
`build.mjs`. Build artifacts (`network-spike.js`, `network-data.json`) gitignored.

---

## Embedding view — ✅ works end-to-end (the cleaner first view)

Built the Facet Embedding/semantic-map view on the real corpus: embedded 1,964
citation papers (title+abstract) with all-MiniLM-L6-v2 → UMAP to 2D → deck.gl
`ScatterplotLayer`, coloured by topic.

- **Embeddings work** — `@huggingface/transformers` feature-extraction runs
  cleanly (validated in Node: 1,964 papers in 10 s; cosine sanity holds —
  resnet~retinopathy > resnet~gan). It's the **same model** as the in-browser
  path and a **single encoder forward pass** (not the autoregressive q4f16 decode
  that broke local *generation*, DECISIONS BJ), so the sovereign embedding path is
  sound. (In-browser WebGPU-embed confirmation is low-risk-owed.)
- **The map shows real structure** — each tagged topic (covid, face, brain-tumor,
  skin, super-res, hyperspectral, …) forms a tight, well-separated cluster;
  same-topic papers sit together. Visual proof the pipeline is correct.
- **No force layout needed** — precomputed x,y → deck.gl renders directly. So the
  Embedding view sidesteps the @antv/layout scale/COOP-COEP risk entirely and is
  the **cleanest first real view to integrate into NakliData** (+ it's the
  foundation embedSearch already sits on).

Files: `embed-corpus.mjs` (Node embed), `embedding-spike.mjs/.html` (deck.gl).
2D-reduction (UMAP) is offline python. Artifacts gitignored.
