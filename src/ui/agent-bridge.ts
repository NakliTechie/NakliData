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
  /** Live read of the `agentWritesEnabled` setting (the 0b gate). */
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
  runCell(input?: unknown): Promise<unknown>;
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
  const fullDeps: AgentSurfaceDeps = {
    engine: deps.engine,
    notebook: deps.notebook,
    isWritesEnabled: deps.isWritesEnabled,
    getWorkbookState: () => getWorkbook().get(),
    getBundle: () => getTaxonomyClient().getBundle(),
  };
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
    runCell: verb('runCell'),
    listTools: () => load().then((m) => m.catalogue(fullDeps)),
    version: '1',
  };
}
