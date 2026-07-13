// Shared WebGL-surface disposal registry for Facet cells.
//
// The deck.gl (embedding / network) and MapLibre (map) cells each own a live
// WebGL context. `renderNotebook` rebuilds the whole notebook DOM on every
// `notify()` (`mount.innerHTML = ''`) and re-runs each visual cell's async
// mount, so a context is created on nearly every notify. Nothing tore the old
// ones down: the browser caps live contexts (~16) and does NOT promptly GC
// orphaned ones, so they pile up — the console floods "Too many active WebGL
// contexts. Oldest context will be lost." and the main thread GPU-stalls. In
// the headless smoke this starves the shared GPU until a later leg's trivial
// query render blows its wait budget (the SPSS-date leg's 15s timeout).
//
// Why a cell-id-keyed module registry (not a DOM walk): the Deck is created
// AFTER `await loadChunk('deckgl')`, i.e. a microtask or more after
// `renderNotebook` returned. By then a fast follow-up re-render may already have
// wiped the DOM, so the mount the Deck attaches to is detached and a DOM walk
// from the live notebook root can never find it. Keying disposal by cell id
// sidesteps the attach/register race entirely: the next mount for that cell (or
// its deletion, or a full notebook teardown) disposes the prior context no
// matter where its canvas ended up.
//
// Pair this with an `if (!mount.isConnected) return;` guard in each async mount
// path: a stale render whose mount was already replaced must not build a Deck at
// all (it would be an instant orphan). The two together keep live contexts equal
// to the number of on-screen GL cells.

/** cellId → teardown for that cell's currently-live GL surface. */
const _liveSurfaces = new Map<string, () => void>();

function run(dispose: () => void): void {
  try {
    dispose();
  } catch {
    // Context already lost / finalized — safe to ignore.
  }
}

/**
 * Register `dispose` as the teardown for `cellId`'s GL surface, first tearing
 * down any previous surface registered for the same cell (a re-render that
 * mounted a fresh context). Call right after a cell mounts its Deck / MapLibre
 * map.
 */
export function registerGlSurface(cellId: string, dispose: () => void): void {
  const prior = _liveSurfaces.get(cellId);
  if (prior) run(prior);
  _liveSurfaces.set(cellId, dispose);
}

/** Tear down and forget one cell's GL surface (on cell deletion). */
export function disposeGlSurface(cellId: string): void {
  const dispose = _liveSurfaces.get(cellId);
  if (!dispose) return;
  _liveSurfaces.delete(cellId);
  run(dispose);
}

/**
 * Tear down and forget EVERY live GL surface. Called before the notebook wipes
 * its DOM (a full re-render or a workspace switch) so no context is orphaned;
 * still-present cells recreate theirs as they re-render.
 */
export function disposeAllGlSurfaces(): void {
  for (const dispose of _liveSurfaces.values()) run(dispose);
  _liveSurfaces.clear();
}
