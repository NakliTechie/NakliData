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
import { getLineageStore } from '../core/lineage-store.ts';
import { getWorkbook } from '../core/workbook.ts';
import type { AgentSurfaceDeps } from '../lazy/agent-surface.ts';
import { getTaxonomyClient } from '../taxonomy/client.ts';
import type { Notebook } from './notebook.ts';

export interface AgentBridgeDeps {
  engine: Engine;
  notebook: Notebook;
}

let _workspaceEpoch = 0;
let _boundDeps: AgentSurfaceDeps | null = null;
let _agentModule: typeof import('../lazy/agent-surface.ts') | null = null;

function loadAgentModule(): Promise<typeof import('../lazy/agent-surface.ts')> {
  return loadChunk('agent-surface').then((module) => {
    _agentModule = module;
    return module;
  });
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
  v3: {
    invoke(tool: string, input?: unknown): Promise<unknown>;
    listTools(): Promise<unknown>;
    version: '3';
  };
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
  _boundDeps = fullDeps;
  const load = loadAgentModule;
  const verb =
    (name: string) =>
    (input?: unknown): Promise<unknown> =>
      load().then((m) => m.dispatch(fullDeps, name, input ?? {}));
  const invokeV3 = (name: string, input?: unknown): Promise<unknown> =>
    load().then((m) => m.dispatchV3(fullDeps, name, input ?? {}));
  window.naklidata = {
    describe: verb('describe'),
    listTables: verb('listTables'),
    listCells: verb('listCells'),
    query: verb('query'),
    proposeCell: verb('proposeCell'),
    listTools: () => load().then((m) => m.catalogue(fullDeps)),
    v3: {
      invoke: invokeV3,
      listTools: () => load().then((m) => m.catalogueV3(fullDeps)),
      version: '3',
    },
    // v2 removes the latent runCell execution capability. This is intentionally
    // a breaking safety correction rather than pretending the v1 catalogue is
    // unchanged.
    version: '2',
  };

  if (webMcpRequested()) {
    void load()
      .then((module) => module.registerWebMcpForDocument(fullDeps))
      .catch((error) => console.warn('[naklidata] WebMCP registration failed:', error));
  }
}

/** Build the chunk's deps, injecting the SHELL's live store singletons. Single
 *  definition — every entry point into the agent chunk (the window binding, the
 *  data-dictionary export) goes through here, so none of them can accidentally
 *  read a divergent copy. */
function buildAgentDeps(deps: AgentBridgeDeps): AgentSurfaceDeps {
  return {
    engine: deps.engine,
    notebook: deps.notebook,
    getWorkspaceEpoch: () => _workspaceEpoch,
    getWorkbookState: () => getWorkbook().get(),
    getBundle: () => getTaxonomyClient().getBundle(),
    getLineageGraph: () => getLineageStore().toJSON(),
  };
}

/**
 * Render the workbook's data dictionary as Markdown (the schema panel's
 * "Export data dictionary" affordance). Loads the agent chunk and runs the same
 * `describe()` an agent calls — so the human doc and the agent grounding are the
 * same artifact.
 */
export async function exportDataDictionaryMarkdown(deps: AgentBridgeDeps): Promise<string> {
  const m = await loadAgentModule();
  return m.exportDataDictionary(buildAgentDeps(deps));
}

/** Invalidate all non-metadata grants without forcing the lazy agent chunk to
 * load. The chunk observes the epoch on its next snapshot or invocation. */
export function resetAgentAccess(): void {
  _workspaceEpoch++;
  if (_agentModule && _boundDeps) _agentModule.syncAgentAccess(_boundDeps);
}

/** Hydrate Settings → Agent access from the lazy agent chunk. */
export async function renderAgentAccessSettings(root: HTMLElement): Promise<void> {
  if (!_boundDeps) {
    root.textContent = 'Agent access becomes available after the workspace engine starts.';
    return;
  }
  const m = await loadAgentModule();
  m.renderAgentAccessPanel(root, _boundDeps);
}

/** True when the page asked for the WebMCP spike via `?webmcp=1`. */
function webMcpRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('webmcp');
  } catch {
    return false;
  }
}
