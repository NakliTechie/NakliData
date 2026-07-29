// Agent surfaces — the shell-side bridge (thin). Binds `window.naklidata` to
// proxies that lazy-load the `agent-surface` chunk on the first verb call, so
// the host + registry + validator stay off the inlined bundle (they only load
// when an agent actually reaches for the app). This file is what keeps the
// agent surface's ~10 KB out of the shell.
//
// It imports the workbook / taxonomy STORE SINGLETONS here — correct, because
// this is a shell module sharing the shell's live instances — and passes them to
// the chunk as accessor functions. The chunk must never import those singletons
// itself (it would get divergent copies); see the header of
// `src/lazy/agent-surface.ts`.

import type { Engine } from '../core/engine.ts';
import { loadChunk } from '../core/lazy-loader.ts';
import { getWorkbook } from '../core/workbook.ts';
import type { AgentSurfaceDeps } from '../lazy/agent-surface.ts';
import { getTaxonomyClient } from '../taxonomy/client.ts';
import type { Notebook } from './notebook.ts';

export interface AgentBridgeDeps {
  engine: Engine;
  notebook: Notebook;
  /** Live read of the legacy `agentWritesEnabled` proposal-only gate. */
  isWritesEnabled: () => boolean;
}

/** The public shape bound to `window.naklidata`. Every verb is async (it loads
 *  the chunk on first call); `listTools` returns the catalogue; `version` marks
 *  the contract. */
export interface NakliDataAgentApi {
  describe(input?: unknown): Promise<unknown>;
  listTables(input?: unknown): Promise<unknown>;
  listCells(input?: unknown): Promise<unknown>;
  query(input?: unknown): Promise<unknown>;
  proposeCell(input?: unknown): Promise<unknown>;
  listTools(): Promise<unknown>;
  version: string;
}

declare global {
  interface Window {
    naklidata?: NakliDataAgentApi;
  }
}

/**
 * Bind `window.naklidata`. Idempotent. The verbs are lazy proxies: the first
 * call to any of them loads the `agent-surface` chunk (which builds the host +
 * tools once) and dispatches; subsequent calls reuse the resolved chunk.
 */
export function bindAgentSurface(deps: AgentBridgeDeps): void {
  const fullDeps = buildAgentDeps(deps);
  const load = () => loadChunk('agent-surface');
  const verb =
    (name: string) =>
    (input?: unknown): Promise<unknown> =>
      load().then((m) => m.dispatch(fullDeps, name, input ?? {}));
  window.naklidata = {
    describe: verb('describe'),
    listTables: verb('listTables'),
    listCells: verb('listCells'),
    query: verb('query'),
    proposeCell: verb('proposeCell'),
    listTools: () => load().then((m) => m.catalogue(fullDeps)),
    // v2 removes the latent runCell execution capability. This is intentionally
    // a breaking safety correction rather than pretending the v1 catalogue is
    // unchanged.
    version: '2',
  };

  // WebMCP spike (Chunk 7, DECISIONS EE-0d) — flag-gated, ships nothing
  // load-bearing. Only when `?webmcp=1` AND the browser exposes
  // `document.modelContext` (Chrome-149 origin trial) do we register the same
  // verbs as WebMCP tools. Fire-and-forget; degrades to a console note.
  maybeRegisterWebMcp(load, fullDeps);
}

/** Build the chunk's deps, injecting the SHELL's live store singletons. Single
 *  definition — every entry point into the agent chunk (the window binding, the
 *  data-dictionary export) goes through here, so none of them can accidentally
 *  read a divergent copy. */
function buildAgentDeps(deps: AgentBridgeDeps): AgentSurfaceDeps {
  return {
    engine: deps.engine,
    notebook: deps.notebook,
    isWritesEnabled: deps.isWritesEnabled,
    getWorkbookState: () => getWorkbook().get(),
    getBundle: () => getTaxonomyClient().getBundle(),
  };
}

/**
 * Render the workbook's data dictionary as Markdown (the schema panel's
 * "Export data dictionary" affordance). Loads the agent chunk and runs the same
 * `describe()` an agent calls — so the human doc and the agent grounding are the
 * same artifact.
 */
export async function exportDataDictionaryMarkdown(deps: AgentBridgeDeps): Promise<string> {
  const m = await loadChunk('agent-surface');
  return m.exportDataDictionary(buildAgentDeps(deps));
}

/** True when the page asked for the WebMCP spike via `?webmcp=1`. */
function webMcpRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('webmcp');
  } catch {
    return false;
  }
}

function maybeRegisterWebMcp(
  load: () => Promise<typeof import('../lazy/agent-surface.ts')>,
  fullDeps: AgentSurfaceDeps,
): void {
  if (!webMcpRequested()) return;
  const root = (document as unknown as { modelContext?: unknown }).modelContext;
  if (!root) {
    console.info(
      '[naklidata] WebMCP requested (?webmcp=1) but document.modelContext is unavailable in this browser.',
    );
    return;
  }
  void load()
    .then((m) => {
      const reg = m.registerWithWebMcp(
        root as Parameters<typeof m.registerWithWebMcp>[0],
        fullDeps,
      );
      console.info(`[naklidata] WebMCP: registered ${reg.registered.length} tools.`);
    })
    .catch((e) => console.warn('[naklidata] WebMCP registration failed:', e));
}
