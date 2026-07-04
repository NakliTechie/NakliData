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

---

# Chunk 2 de-risk round 2 — GPU force layout resolves the COOP/COEP tension (2026-07-04)

The round-1 caveat (JS layout too slow; `-wasm` needs SharedArrayBuffer →
cross-origin isolation → collides with the DuckDB CDN) had a third door we
hadn't tested: **`@antv/layout-gpu`** (WebGL/GPGPU, float textures). It needs
**no SharedArrayBuffer, no COOP/COEP, no header changes** — so the whole
cross-origin-isolation problem is **resolved by avoidance**, not by solving it.

## Capability probe (live, in the running app)
- `crossOriginIsolated: false` · `SharedArrayBuffer: absent` → **`-wasm` is
  dead on arrival today** (no SAB without isolating the page, which fights the
  cross-origin DuckDB load + OSM tiles + HF model fetches).
- `WebGL2: true` · `EXT_color_buffer_float: true` · `OES_texture_float_linear:
  true` → **`-gpu`'s prerequisites are already met.** (Renderer: Apple M4 Pro
  via ANGLE/Metal.)

## GPU layout ladder (clustered synthetic graphs, avgDeg 4, 200 iters)

Both GPU layouts run in-browser and return finite coordinates. Two algorithms:

| layout | 500 | 10k | 50k | 100k | scaling | resolves? |
|--------|-----|-----|-----|------|---------|-----------|
| **Fruchterman GPU** | 0.13 s | 1.16 s | 7.55 s | **26.1 s** | O(n²) all-pairs repulsion | ✅ spread grows, clusters form |
| **GForce GPU** (seeded) | 0.71 s | 0.54 s | 2.02 s | **4.95 s** | sub-quadratic | ⚠️ resolves *non-degenerate* but layout **quality unverified** |

(Edge counts: 1k / 20k / 100k / 200k respectively — real densities after the
PRNG fix; round-1's ~11k-edge numbers were a short-cycle-LCG artifact.)

**Two real caveats on GForce:** (1) it collapses everything to the origin
unless **initial node positions are seeded** (Fruchterman randomizes
internally; GForce reads `node.data.{x,y}` and defaults to center → symmetric
forces → no spread). (2) Even seeded, its output spread stayed pinned at
exactly the seed range at every size, where Fruchterman's grew — so GForce is
*running* but whether it produces a **structured** layout (clusters visually
separated) is not yet confirmed. Needs a deck.gl render check before it's
trusted as the default.

## Verdict (feeds DECISIONS BS)
- **The GPU path is the answer** — force layout in-browser with **zero header
  changes**, sidestepping the COOP/COEP-vs-DuckDB-CDN tension entirely.
- **Fruchterman GPU is the validated default**: interactive to **~10k (≤1.2 s)**,
  compute-once-and-cache to **~50k (7.5 s)**, background/precompute at **100k
  (26 s)**. This refines DECISIONS BF's "routine 1M force" — honest in-browser
  ceiling for all-pairs GPU force is ~50k interactive-ish; 1M needs precompute
  or a Barnes-Hut/GForce path.
- **GForce GPU is the promising fast path** (100k in 5 s, sub-quadratic) —
  pending a seed step + a layout-quality (cluster-separation) confirmation.
- `-wasm` is shelved: it buys nothing the GPU path doesn't, at the cost of the
  cross-origin-isolation blast radius. Only revisit if GPU layout quality proves
  inadequate AND a precompute path is unacceptable.

Files: `gpu-layout-spike.mjs` + `.html` (needs `npm i --no-save
@antv/layout-gpu@1.1.7`; build artifact `.js` gitignored). Bench on Apple M4 Pro
— re-measure on target hardware before pinning scale claims.
