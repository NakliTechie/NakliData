import { getAssociationsStore } from './core/associations.ts';
import { setDemoMode } from './core/demo-mode.ts';
import { getDimensionsStore } from './core/dimensions.ts';
import { type Engine, getEngine } from './core/engine.ts';
import {
  deleteHandle,
  ensureReadPermission,
  getHandle,
  queryReadPermissionQuiet,
} from './core/handles.ts';
import { loadChunk } from './core/lazy-loader.ts';
import { getLineageStore } from './core/lineage-store.ts';
import { getMeasuresStore } from './core/measures-store.ts';
import {
  BRIDGE_SECRET_NAMES,
  ICEBERG_SECRET_NAMES,
  MountError,
  type MountedSource,
  S3_SECRET_NAMES,
  mountComputeBridge,
  mountComputeBridgeCatalog,
  mountExampleBundle,
  mountFile,
  mountFolder,
  mountIcebergCatalog,
  mountIcebergTable,
  mountS3Endpoint,
  mountUrl,
  remountFolderFromHandle,
} from './core/mount.ts';
import { type NakliDataFile, loadFromFile, saveToFile, serialize } from './core/persistence.ts';
import type { QueryColumnSpec, QueryColumnType } from './core/query-builder.ts';
import { computeRefreshDiff, persistFingerprints } from './core/refresh-engine.ts';
import { forgetSource, loadSecret, saveSecret } from './core/secrets/source-secrets.ts';
import { getSelectionsStore } from './core/selections.ts';
import {
  type SessionMeta,
  clearSnapshot,
  createSession,
  deleteSession,
  ensureActiveSession,
  loadIndex,
  loadSnapshot,
  renameSession,
  saveSnapshot,
  setActiveSession,
} from './core/sessions.ts';
import { type Settings, loadSettings, saveSettings } from './core/settings.ts';
import { dispatchJob } from './core/sidecar/client.ts';
import { SidecarError } from './core/sidecar/types.ts';
import type { StatsColumnSpec } from './core/stats.ts';
import {
  buildShareUrl,
  clearLensFromLocation,
  decodeLensParam,
  readLensFromLocation,
} from './core/url-state.ts';
import { getWorkbook } from './core/workbook.ts';
import { classifyTableColumns, getTaxonomyClient } from './taxonomy/client.ts';
import type { ClassificationResult } from './taxonomy/types.ts';
import { type AssocColumnOption, openAssociationsModal } from './ui/associations-modal.ts';
import { paintResultSelectionStates } from './ui/cells/sql-cell.ts';
import { computeStats } from './ui/cells/stats-cell.ts';
import type { CellState, SqlCellState } from './ui/cells/types.ts';
import { openCompareTablesModal } from './ui/compare-tables-modal.ts';
import { openDefineTypeModal } from './ui/define-type-modal.ts';
import { buildStandaloneHtml, saveHtmlFile } from './ui/export-html.ts';
import {
  type LensConfirmCell,
  type LensConfirmDescriptor,
  openLensConfirmModal,
} from './ui/lens-confirm-modal.ts';
import { openLineagePanel } from './ui/lineage-panel.ts';
import { openMeasuresPanel } from './ui/measures-panel.ts';
import { openMountComputeBridgeCatalogModal } from './ui/mount-compute-bridge-catalog-modal.ts';
import { openMountComputeBridgeModal } from './ui/mount-compute-bridge-modal.ts';
import { openMountIcebergCatalogModal } from './ui/mount-iceberg-catalog-modal.ts';
import { openMountIcebergModal } from './ui/mount-iceberg-modal.ts';
import { openMountS3Modal } from './ui/mount-s3-modal.ts';
import { openMountUrlModal } from './ui/mount-url-modal.ts';
import { openNlToSqlModal } from './ui/nl-to-sql-modal.ts';
import { getNotebook, renderNotebook } from './ui/notebook.ts';
import { openOverrideRulesModal, refreshOverrideRulesModal } from './ui/override-rules-modal.ts';
import { type QueryBuilderTable, openQueryBuilderModal } from './ui/query-builder-modal.ts';
import { openRefreshModal } from './ui/refresh-modal.ts';
import { openSchemaGraph } from './ui/schema-graph.ts';
import { type ColumnAssignment, assignmentKey, renderSchemaPanel } from './ui/schema-panel.ts';
import { openSettingsModal } from './ui/settings-modal.ts';
import {
  type ShellState,
  mountShell,
  renderSelectionsBar,
  renderSessionSwitcher,
  renderSourcesList,
  setHasMounts,
  updateEngineStatus,
} from './ui/shell.ts';
import { SINKS, SinkError } from './ui/sinks/sinks.ts';
import { renderTemplatePanel } from './ui/templates/templates-panel.ts';

const BUILD_VERSION = '0.1.0';

function detectSupport(): { supported: boolean; reason?: string } {
  // Browser floor per spec §1.3: Chrome/Edge/Opera 122+, Firefox partial, Safari unsupported.
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  if (isSafari) {
    return { supported: false, reason: 'safari' };
  }
  return { supported: true };
}

function bootUnsupported(reason: string): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div style="max-width: 520px; margin: 80px auto; padding: 32px; text-align: center; font-family: system-ui, sans-serif;">
      <h1 style="font-size: 22px;">NakliData isn't supported here yet</h1>
      <p style="color: #6B6358;">
        ${
          reason === 'safari'
            ? 'NakliData uses File System Access and OPFS APIs that Safari does not yet implement. Try Chrome, Edge, or Opera 122+.'
            : 'Your browser is missing required capabilities. Try a recent Chrome, Edge, or Opera build.'
        }
      </p>
      <p style="color: #6B6358; font-size: 13px;">No data is sent anywhere by this page.</p>
    </div>
  `;
}

// --- v1.3 M3 report printing (forward-pass H10 + H11) ---
// Restore thunks for the cell-ref placeholders embedded at print time.
const _reportRefRestore: Array<() => void> = [];

/**
 * H11 — fill a report's `[data-cell-ref]` placeholders with a clone of
 * the referenced cell's rendered output (minus its edit chrome) just
 * before printing. Each embed registers a restore thunk so afterprint
 * puts the placeholder back exactly as it was. A ref to a missing or
 * unnamed cell keeps its "[@name — content embedded at render]"
 * placeholder text.
 */
function embedReportCellRefs(
  reportEl: HTMLElement,
  cells: ReadonlyArray<{ id: string; name: string | null }>,
): void {
  const nameToId = new Map<string, string>();
  for (const c of cells) if (c.name) nameToId.set(c.name, c.id);
  for (const ph of reportEl.querySelectorAll<HTMLElement>('.report-cell-ref[data-cell-ref]')) {
    const targetId = nameToId.get(ph.dataset.cellRef ?? '');
    const targetEl = targetId
      ? document.querySelector<HTMLElement>(`.cell[data-cell-id="${CSS.escape(targetId)}"]`)
      : null;
    if (!targetEl) continue;
    const savedHtml = ph.innerHTML;
    const savedStyle = ph.getAttribute('style');
    _reportRefRestore.push(() => {
      ph.innerHTML = savedHtml;
      if (savedStyle === null) ph.removeAttribute('style');
      else ph.setAttribute('style', savedStyle);
    });
    const clone = targetEl.cloneNode(true) as HTMLElement;
    clone.querySelector('.cell-head')?.remove();
    ph.innerHTML = '';
    ph.style.cssText = 'margin-bottom:10mm;';
    ph.append(clone);
  }
}

function restoreReportCellRefs(): void {
  for (const fn of _reportRefRestore.splice(0)) fn();
}

/**
 * v1.3 M3 — print one report cell (also the agent/automation surface:
 * `window.naklidataRenderReport(reportCellId)`).
 *
 * Sets `[data-printing]` on the target so the scoped @media print CSS
 * (H10) reveals only this report, then opens the browser print dialog.
 * The boot-time beforeprint/afterprint listeners embed + restore the
 * cell-ref placeholders (H11). No scheduling, no queue, no background
 * execution (handoff §M3).
 */
function triggerReportPrint(reportCellId: string): void {
  // CSS.escape the id — a cell id is normally safe, but it crosses the
  // window.naklidataRenderReport boundary where a caller controls it (M8).
  const el = document.querySelector<HTMLElement>(
    `[data-cell-id="${CSS.escape(reportCellId)}"].cell-report`,
  );
  if (!el) {
    console.warn(`[naklidata] report print: cell not found: ${reportCellId}`);
    return;
  }
  el.setAttribute('data-printing', '');
  el.scrollIntoView({ block: 'start' });
  window.print();
}

(window as unknown as { naklidataRenderReport: (id: string) => void }).naklidataRenderReport =
  triggerReportPrint;

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Root #app missing');

  const sup = detectSupport();
  if (!sup.supported) {
    bootUnsupported(sup.reason ?? 'unknown');
    return;
  }

  // W6.2 — Presentation mode. `?present=1` flips the app into a read-
  // only "deck" view: SQL / cohort / assertion cells, sidebars, the
  // notebook toolbar, the cell-add row, and per-cell edit/delete
  // chrome are all hidden via CSS gated on `.app-present-mode`.
  // Markdown + chart + pivot + map cells keep rendering their output.
  // Toggle the class BEFORE the shell mounts so cells render in
  // presentation mode from the first frame (no flash of editor chrome).
  // Hex's app-publish pattern.
  const bootParams = new URLSearchParams(location.search);
  if (bootParams.get('present') === '1') {
    root.classList.add('app-present-mode');
  }

  const state: ShellState = {
    buildVersion: BUILD_VERSION,
    engineStatus: 'booting',
    hasMounts: false,
  };

  mountShell(root, state);
  wireActions(root);

  const engine = getEngine();
  engine.on('status', ({ status, message }) => updateEngineStatus(root, status, message));

  // Cells can't import the main-local `toast`; they raise it via a window
  // event instead (e.g. the chart cell's shelf-compile warnings, M5).
  window.addEventListener('naklidata:toast', (ev) => {
    const detail = (ev as CustomEvent<{ message?: string; kind?: 'info' | 'error' }>).detail;
    if (detail?.message) toast(detail.message, detail.kind ?? 'info');
  });

  // v1.3 M1 — render the selections bar reactively. Subscribe once at
  // boot; the store calls back on every set/toggle/clear.
  getSelectionsStore().subscribe((entries) => {
    renderSelectionsBar(root, entries);
    // Phase 2 — repaint the cross-filter grey-out in place (no full
    // notebook re-render, which would reset scroll + focus).
    repaintSelectionStates(root, engine);
  });
  // Render the initial state (may be empty on first boot; populated by
  // .naklidata-restored selections after applyLoadedFile).
  renderSelectionsBar(root, getSelectionsStore().list());

  // v1.3 M1 Phase 2 — associations changing alters the effective
  // (propagated) selections, so repaint every cell's cross-filter.
  getAssociationsStore().subscribe(() => repaintSelectionStates(root, engine));

  const workbook = getWorkbook();
  workbook.subscribe((wb) => {
    renderSourcesList(root, wb.sources);
    setHasMounts(root, wb.sources.length > 0);
    renderSchemaPanelWithCurrentState(root, wb, engine);
    // Workbook changed → the applicable-template set may have changed, so
    // any prior sidecar ranking is stale. Clear it before re-rendering.
    _reportRanking = null;
    renderTemplatePanelWithCurrentState(root, wb, engine);
    // Mount and re-render the notebook into the center region whenever the
    // mount state changes (so the notebook appears on first mount).
    const notebookMount = root.querySelector<HTMLElement>('[data-region="notebook"]');
    if (notebookMount) {
      const nb = getNotebook(engine);
      if (nb.get().cells.length === 0 && wb.sources.length > 0) {
        nb.addCell('sql'); // seed with one empty SQL cell
      }
      renderNotebook(notebookMount, nb, sqlExtra());
    }
  });

  // Re-render the notebook on its own state changes.
  const nb = getNotebook(engine);
  nb.subscribe(() => {
    const notebookMount = root.querySelector<HTMLElement>('[data-region="notebook"]');
    if (notebookMount) renderNotebook(notebookMount, nb, sqlExtra());
  });

  // Cmd/Ctrl+Shift+Enter → run all cells.
  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key === 'Enter') {
      ev.preventDefault();
      void nb.runAll();
    }
  });

  // Three-tier DuckDB-wasm bundle source (spec amendment A14):
  //
  //   ?cdn=1     → jsDelivr (escape hatch)
  //   ?offline=1 → same-origin vendored
  //   (default)  → probe same-origin; on 404, cross-fetch from the
  //                canonical GitHub Pages mirror.
  //
  // GitHub Pages serves the same vendored bytes with CORS open
  // (access-control-allow-origin: *). Cloudflare Workers Static Assets
  // can't host the bytes locally (25 MiB per-file limit blocks
  // duckdb-eh.wasm at 34 MB) — public/.assetsignore skips
  // duckdb-fallback/ on those deploys, and the probe 404s →
  // cross-origin fallback kicks in.
  //
  // Trust boundary on the cross-origin paths: version pin in the URL
  // + build-time SHA-384 verify against integrity.json when bytes are
  // vendored (scripts/fetch-duckdb-fallback.mjs). Pre-fetch SRI was
  // dropped in W1.8.2 because the blob-pre-wrap it required broke
  // cross-blob worker access in current Chrome.
  const FALLBACK_MIRROR = 'https://naklitechie.github.io/NakliData/duckdb-fallback/';
  const params = new URLSearchParams(location.search);
  let bootOpts: { offline?: boolean; fallbackBase?: string };
  if (params.has('cdn')) {
    bootOpts = { offline: false };
  } else if (params.has('offline')) {
    bootOpts = { offline: true };
  } else {
    let sameOrigin = false;
    try {
      const probe = await fetch('./duckdb-fallback/integrity.json', { method: 'HEAD' });
      sameOrigin = probe.ok;
    } catch {
      sameOrigin = false;
    }
    bootOpts = sameOrigin ? { offline: true } : { offline: true, fallbackBase: FALLBACK_MIRROR };
  }
  try {
    await engine.boot(bootOpts);
  } catch (err) {
    console.error('[naklidata] engine boot failed', err);
    return;
  }

  // Engine is ready. Ensure a session exists (migration from the legacy
  // single-snapshot key happens here on first multi-session boot), then:
  //
  // - If `?lens=<base64>` is present, decode and apply over the active
  //   session (treat the shared state as the new active state). On bad
  //   lens, fall back to the session's IDB snapshot.
  // - Otherwise, restore the active session's snapshot from IDB.
  _activeSession = await ensureActiveSession();
  await refreshSessionSwitcher(root);

  const lensParam = readLensFromLocation();
  let restoredFromSnapshot = false;
  if (lensParam) {
    try {
      const file = await decodeLensParam(lensParam);
      // Forward-pass H1 (2026-06-02): a malicious `?lens=` link can
      // enumerate any remote source kind; auto-mounting would silently
      // SSRF the victim's browser. Gate any remote source behind an
      // explicit "Continue and fetch" confirmation that lists hosts.
      // Local sources (example-bundle, fsa-folder) auto-restore as
      // before — they have no network footprint.
      const remotes = extractLensRemoteHosts(file);
      // Forward-pass H2: surface the executable SQL the link carries. The
      // cells never auto-run, but clicking Run executes the SENDER's SQL
      // against the victim's data — show it for review. Gate the modal on
      // remote sources OR executable cells so a local-only-but-SQL-bearing
      // lens still gets a review step.
      const execCells = extractLensExecutableCells(file);
      let proceed = true;
      if (remotes.length > 0 || execCells.length > 0) {
        proceed = await openLensConfirmModal(remotes, file.name, execCells);
      }
      if (proceed) {
        await applyLoadedFile(engine, file);
        clearLensFromLocation();
        toast(`Loaded shared notebook "${file.name}".`);
      } else {
        clearLensFromLocation();
        toast('Shared link declined — using saved state instead.');
        await restoreFromActiveSession(engine);
        restoredFromSnapshot = getWorkbook().get().sources.length > 0;
      }
    } catch (err) {
      console.warn('[naklidata] lens param decode failed', err);
      toast('Shared link is invalid or corrupted — using saved state instead.', 'error');
      await restoreFromActiveSession(engine);
      restoredFromSnapshot = getWorkbook().get().sources.length > 0;
    }
  } else {
    await restoreFromActiveSession(engine);
    restoredFromSnapshot = getWorkbook().get().sources.length > 0;
  }
  // If auto-restore brought back sources from a previous visit, surface
  // that explicitly. Without this, a first-time user who returns to the
  // page sees the empty state flicker away and the notebook view appear
  // — they have no idea their work was restored or where it came from.
  // The "Start fresh" action clears just the active session's snapshot
  // and reloads, dropping them on the clean empty state.
  if (restoredFromSnapshot) {
    const wb = getWorkbook().get();
    const sourceCount = wb.sources.length;
    const tableCount = wb.sources.reduce((n, s) => n + s.tables.length, 0);
    toast(
      `Restored from your previous session (${sourceCount} source${
        sourceCount === 1 ? '' : 's'
      }, ${tableCount} table${tableCount === 1 ? '' : 's'}).`,
      'info',
      {
        label: 'Start fresh',
        onClick: () => {
          void (async () => {
            try {
              await clearSnapshot(getActiveSessionId());
            } catch (err) {
              console.warn('[naklidata] clearSnapshot failed', err);
            }
            location.reload();
          })();
        },
      },
    );
  }
  installAutoSave(engine);
  installUserTypesSync();
  installDemoModeListener(engine, root);
  installReportPrintListeners(engine);
  // W3.2 slice B chunk 4 — auto-load the local model on boot when:
  //   (a) provider === 'local' is configured AND
  //   (b) a model id is set AND
  //   (c) the model is already cached on this device.
  // If (c) is false we do NOT auto-load — the user should explicitly
  // go to Settings + click "Download & load" to acknowledge the
  // multi-GB download. Matches the BYOK posture: keys auto-load
  // from session/IDB (already-committed state), not from nowhere.
  void autoLoadLocalIfCached(engine);
}

/**
 * Auto-load the local model on boot when its weights are already in
 * OPFS. No-ops otherwise. Surfaces a small toast on success so the
 * user knows the local provider is ready without having to open
 * Settings.
 */
async function autoLoadLocalIfCached(_engine: Engine): Promise<void> {
  try {
    const settings = await loadSettings();
    if (settings.sidecarProvider !== 'local') return;
    const modelId = settings.sidecarModel?.trim();
    if (!modelId) return;
    const { isOpfsAvailable, isModelCacheComplete } = await import('./core/sidecar/local-cache.ts');
    if (!(await isOpfsAvailable())) return;
    // Adversarial-review HIGH (2026-06-03): `cached.files.length > 0`
    // was the prior gate. A partial cache (tokenizer.json + config.json
    // but no weights — e.g. after a cancelled / quota-killed download)
    // passed the gate and triggered a SILENT multi-GB re-download on
    // every boot because Transformers.js re-fetched the missing
    // `model.onnx` without UI feedback. `isModelCacheComplete` checks
    // total bytes > 100 MB — well below every curated model's weight
    // file but far above sidecar files.
    if (!(await isModelCacheComplete(modelId))) return;
    // Model is cached. Pull in the Transformers.js chunk and register
    // the generator. This is async + can take ~5-10s as the pipeline
    // initialises onnxruntime against the cached weights — we don't
    // block other boot tasks on it.
    const mod = await loadChunk('transformers');
    await mod.loadAndRegister(modelId);
    toast(`Local model ${modelId} ready (loaded from cache).`);
  } catch (err) {
    // Boot-path auto-load failures should never tank the rest of the
    // session. Log + carry on — the user can manually load via
    // Settings if the issue is transient.
    console.warn('[naklidata] local model auto-load failed', err);
  }
}

/**
 * Theme 4 wave 2 (B4). The Settings modal dispatches
 * `naklidata-demo-mode-changed` after toggling demoMode. We re-render
 * the surfaces that route through `maskLabel` so the change takes
 * effect immediately without a reload. Also re-renders any open
 * notebook so SQL-result column headers flip.
 */
/**
 * v1.3 M3 — report print lifecycle (forward-pass H10 + H11). `beforeprint`
 * embeds the `[data-printing]` report's cell-ref placeholders with the
 * referenced cells' rendered DOM; `afterprint` restores the placeholders
 * and clears the `[data-printing]` flag. Works for both the "Print to PDF"
 * button and `window.naklidataRenderReport(id)` — both set `[data-printing]`
 * then call `window.print()`.
 */
/**
 * v1.3 M1 Phase 2 — repaint the associative cross-filter grey-out on
 * every SQL result table currently in the DOM, in place. Triggered on a
 * selection-store tick. Surgical (per-td class toggles) rather than a
 * full `renderNotebook`, so clicking a value in a long result doesn't
 * scroll-jump the table or steal editor focus.
 */
function repaintSelectionStates(root: HTMLElement, engine: Engine): void {
  const cellsById = new Map(
    getNotebook(engine)
      .get()
      .cells.map((c) => [c.id, c]),
  );
  for (const tableEl of root.querySelectorAll<HTMLElement>(
    '[data-cell-kind="sql"] table.result-table',
  )) {
    const id = tableEl.closest<HTMLElement>('[data-cell-id]')?.dataset.cellId;
    const cell = id ? cellsById.get(id) : undefined;
    if (cell?.kind === 'sql') paintResultSelectionStates(tableEl, cell);
  }
}

function installReportPrintListeners(engine: Engine): void {
  window.addEventListener('beforeprint', () => {
    const reportEl = document.querySelector<HTMLElement>('.cell-report[data-printing]');
    if (reportEl) embedReportCellRefs(reportEl, getNotebook(engine).get().cells);
  });
  window.addEventListener('afterprint', () => {
    restoreReportCellRefs();
    for (const el of document.querySelectorAll<HTMLElement>('.cell-report[data-printing]')) {
      el.removeAttribute('data-printing');
    }
  });
}

function installDemoModeListener(engine: Engine, root: HTMLElement): void {
  document.addEventListener('naklidata-demo-mode-changed', () => {
    const wb = getWorkbook().get();
    renderSourcesList(root, wb.sources);
    renderSchemaPanelWithCurrentState(root, wb, engine);
    // Re-render the notebook so any visible SQL result headers update.
    const notebookMount = root.querySelector<HTMLElement>('[data-region="notebook"]');
    if (notebookMount) {
      const nb = getNotebook(engine);
      renderNotebook(notebookMount, nb, sqlExtra());
    }
  });
}

/**
 * Keep the taxonomy worker's set of user types in sync with the
 * workbook. Subscribes to workbook changes and pushes whenever the
 * `userTypes` array differs from the last push. Pushes a fresh value
 * immediately on install so the worker picks up types restored from
 * an existing `.naklidata` file at boot.
 */
function installUserTypesSync(): void {
  const workbook = getWorkbook();
  const client = getTaxonomyClient();
  let lastSerialised = '';
  const push = (): void => {
    const next = workbook.get().userTypes;
    const ser = JSON.stringify(next);
    if (ser === lastSerialised) return;
    lastSerialised = ser;
    void client.setUserTypes(next).catch((err) => {
      console.warn('[naklidata] setUserTypes failed', err);
    });
  };
  push(); // initial
  workbook.subscribe(push);
}

let _activeSession: SessionMeta | null = null;

/**
 * Column-profile cache (Theme 4 wave 1). Keyed by assignmentKey.
 * Presence in the map means the profile panel is currently expanded
 * for that column. `runShowProfile` toggles it: missing → fetches +
 * adds; present → deletes. After every mutation, `triggerSchemaRender`
 * forces a schema-panel re-render so the new state lands.
 */
const _columnProfiles = new Map<string, import('./core/engine.ts').ColumnProfile>();

// Job 4 (Wave 3) — sidecar's report-template ranking (templateId → score).
// Null when not yet ranked or stale; cleared on any workbook change.
let _reportRanking: Record<string, number> | null = null;

/**
 * Render the "Suggested reports" panel with the current workbook + any
 * sidecar ranking. Extracted so both the workbook subscriber and the
 * onRank handler (which sets _reportRanking then re-renders) stay in
 * sync. `sidecarEnabled` is read from the app-root class, which main.ts
 * keeps in lockstep with the saved setting.
 */
function renderTemplatePanelWithCurrentState(
  root: HTMLElement,
  wb: ReturnType<ReturnType<typeof getWorkbook>['get']>,
  engine: Engine,
): void {
  const sidecarEnabled =
    document.getElementById('app')?.classList.contains('app-sidecar-enabled') ?? false;
  renderTemplatePanel(
    root,
    {
      sources: wb.sources,
      assignments: wb.assignments,
      sidecarEnabled,
      ...(_reportRanking ? { ranking: _reportRanking } : {}),
    },
    {
      onInstantiate: (cells, templateId) => {
        const nb = getNotebook(engine);
        nb.load([...nb.get().cells, ...cells]);
        toast(`Instantiated "${templateId}" — ${cells.length} cells added.`);
      },
      onRank: (candidates, typeSummary) => {
        void rankReports(root, engine, candidates, typeSummary);
      },
    },
  );
}

/**
 * Job 4 dispatch. Asks the sidecar to rank the applicable templates,
 * stores the result in _reportRanking, and re-renders the panel. The
 * sidecar can only rank ids from `candidates` (the parser drops the
 * rest), so this never surfaces a template that wasn't already
 * applicable — and it never auto-runs anything (Hard NOT #4).
 */
async function rankReports(
  root: HTMLElement,
  engine: Engine,
  candidates: Array<{ templateId: string; name: string; description: string }>,
  typeSummary: string,
): Promise<void> {
  const settings = await loadSettings();
  if (!settings.sidecarEnabled) {
    toast('Enable the sidecar in Settings to rank reports.');
    return;
  }
  toast('Ranking reports…');
  try {
    const response = await dispatchJob(
      { kind: 'recommend-reports', candidates, typeSummary },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (response.kind !== 'recommend-reports') return;
    if (response.recommendations.length === 0) {
      toast('Sidecar returned no usable ranking.');
      return;
    }
    _reportRanking = Object.fromEntries(
      response.recommendations.map((r) => [r.templateId, r.score]),
    );
    renderTemplatePanelWithCurrentState(root, getWorkbook().get(), engine);
    toast(`Ranked ${response.recommendations.length} reports.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`Could not rank reports: ${msg}`, 'error');
  }
}

/**
 * Render the schema panel with the current workbook + cached column
 * profiles. Called both from the workbook subscriber (when workbook
 * state changes) and from the profile-toggle handler (when the
 * profile cache changes but workbook didn't). Extracted so both call
 * sites stay in sync.
 */
function renderSchemaPanelWithCurrentState(
  root: HTMLElement,
  wb: ReturnType<ReturnType<typeof getWorkbook>['get']>,
  engine: Engine,
): void {
  renderSchemaPanel(
    root,
    {
      sources: wb.sources,
      assignments: wb.assignments,
      bundle: getTaxonomyClient().getBundle(),
      autoAcceptThreshold: wb.autoAcceptThreshold,
      userTypes: wb.userTypes,
      profiles: Object.fromEntries(_columnProfiles),
      overrideRules: wb.overrideRules,
    },
    {
      onAccept: (sId, tId, col) => acceptAssignment(sId, tId, col),
      onOverride: (sId, tId, col, typeId) => overrideAssignment(sId, tId, col, typeId),
      onBulkAccept: (threshold) => bulkAccept(threshold),
      onChangeThreshold: (v) => getWorkbook().setAutoAcceptThreshold(v),
      onReclassify: () => {
        void reclassifyAllSources(engine);
      },
      onManageOverrideRules: () => openManageOverrideRules(),
      onCompareTables: () =>
        openCompareTablesModal({
          sources: wb.sources,
          assignments: wb.assignments,
          engine,
        }),
      // W5.3 — quick-chart actions drop cells into the notebook via
      // the same load() path the templates panel uses.
      onAddCells: (partials, label) => {
        const nb = getNotebook(engine);
        const existing = nb.get().cells;
        const startOrder = existing.length;
        const cells = partials.map((p, i) => ({
          ...p,
          id: `c_${Date.now().toString(36)}_${startOrder + i}`,
          order: startOrder + i,
        })) as CellState[];
        // Resolve any chart-cell `inputCell: null` references to the
        // most-recent named SQL cell within this batch (templates panel
        // does the same dance).
        const idByName = new Map<string, string>();
        for (const c of cells) {
          if ((c.kind === 'sql' || c.kind === 'cohort') && c.name) idByName.set(c.name, c.id);
        }
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          if (c?.kind === 'chart' && c.inputCell === null) {
            for (let j = i - 1; j >= 0; j--) {
              const prev = cells[j];
              if ((prev?.kind === 'sql' || prev?.kind === 'cohort') && prev.name) {
                c.inputCell = prev.id;
                break;
              }
            }
          }
        }
        nb.load([...existing, ...cells]);
        toast(`Added "${label}" — ${cells.length} cell${cells.length === 1 ? '' : 's'}.`);
      },
      // W5.3 — partner-column index for quick-chart's "Sum X by Y"
      // suggestions. Maps table name → list of (column, typeId) in
      // that table, so a per-column action can find sibling columns.
      partnersByTable: (() => {
        const m = new Map<string, Array<{ column: string; typeId: string | null }>>();
        for (const s of wb.sources) {
          for (const t of s.tables) {
            const list: Array<{ column: string; typeId: string | null }> = [];
            for (const [key, a] of Object.entries(wb.assignments)) {
              const [, tId] = key.split('::');
              if (tId === t.id) {
                list.push({ column: a.columnName, typeId: a.assigned.typeId ?? null });
              }
            }
            m.set(t.name, list);
          }
        }
        return m;
      })(),
    },
  );
}

/**
 * Open the Override-rules management modal. The modal lists current
 * rules with a Remove button per row; removal is forward-acting only
 * (it doesn't rewind already-applied assignments — the user can manually
 * Override the affected columns if they want to roll back).
 *
 * Theme 4 wave 2 (B3). Lives in main.ts (not the modal module) so we
 * can mutate workbook state directly without crossing a handler.
 */
function openManageOverrideRules(): void {
  const buildState = () => {
    const wb = getWorkbook().get();
    return {
      rules: wb.overrideRules,
      bundle: getTaxonomyClient().getBundle(),
      userTypes: wb.userTypes,
    };
  };
  const handlers = {
    onRemove: (columnName: string) => {
      getWorkbook().removeOverrideRule(columnName);
      // Re-render the modal with the new list. Workbook subscriber also
      // re-renders the schema panel so the toolbar count updates.
      refreshOverrideRulesModal(buildState(), handlers);
    },
  };
  openOverrideRulesModal(buildState(), handlers);
}

function getActiveSessionId(): string {
  if (!_activeSession) throw new Error('No active session');
  return _activeSession.id;
}

async function refreshSessionSwitcher(root: HTMLElement): Promise<void> {
  const idx = await loadIndex();
  renderSessionSwitcher(root, idx);
}

async function switchToSession(engine: Engine, root: HTMLElement, id: string): Promise<void> {
  // Persist current state to the OUTGOING session before flipping the
  // active pointer — otherwise the in-flight debounced save would land
  // on the wrong session.
  await persistSnapshot(engine);
  try {
    await setActiveSession(id);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error');
    return;
  }
  const idx = await loadIndex();
  const meta = idx.sessions.find((s) => s.id === id) ?? null;
  _activeSession = meta;
  getWorkbook().clear();
  getNotebook(engine).load([]);
  await restoreFromActiveSession(engine);
  await refreshSessionSwitcher(root);
  toast(`Switched to "${meta?.name ?? '…'}".`);
}

/**
 * Boot-time IDB restore. Reads settings + the active session's snapshot;
 * applies them. Failures are logged and otherwise silent — fresh users
 * have nothing to restore and that's normal.
 */
async function restoreFromActiveSession(engine: Engine): Promise<void> {
  // 1. Settings (auto-accept threshold + sidecar provider/model/enabled).
  try {
    const settings = await loadSettings();
    getWorkbook().setAutoAcceptThreshold(settings.autoAcceptThreshold);
    const root = document.getElementById('app');
    root?.classList.toggle('app-sidecar-enabled', settings.sidecarEnabled);
    root?.classList.toggle('app-demo-mode', settings.demoMode);
    // Restore demo-mode flag on the masker before any render runs.
    setDemoMode(settings.demoMode);
  } catch (err) {
    console.warn('[naklidata] settings load failed', err);
  }
  // 2. Active session snapshot.
  try {
    const snapshot = await loadSnapshot(getActiveSessionId());
    if (snapshot) {
      await applyLoadedFile(engine, snapshot, { silent: true });
    }
  } catch (err) {
    console.warn('[naklidata] snapshot restore failed', err);
  }
}

let _autoSaveTimer: number | null = null;
const AUTOSAVE_DEBOUNCE_MS = 300;

/**
 * Install debounced auto-save subscribers on the workbook + notebook.
 * Every state change resets a 300 ms timer; the timer fires
 * persistSnapshot (which writes to the active session's IDB key) +
 * saveSettings against the current state.
 *
 * Must be called AFTER restoreFromActiveSession finishes so we don't
 * race the restore with an empty-state save.
 */
function installAutoSave(engine: Engine): void {
  const workbook = getWorkbook();
  const nb = getNotebook(engine);
  const scheduleSave = () => {
    if (_autoSaveTimer !== null) window.clearTimeout(_autoSaveTimer);
    _autoSaveTimer = window.setTimeout(() => {
      _autoSaveTimer = null;
      void persistSnapshot(engine);
    }, AUTOSAVE_DEBOUNCE_MS);
  };
  workbook.subscribe(scheduleSave);
  nb.subscribe(scheduleSave);
}

/**
 * M3 — handle the "Refresh" header button.
 *
 * Runs the change-detection sweep, opens the result modal, and on
 * confirm:
 *   1. Persists the fresh fingerprints (so the next check has a new
 *      baseline; without this, every check would re-stale forever).
 *   2. Re-runs the cascaded stale cells via the notebook.
 *
 * Best-effort: any error surfaces as a toast and the workbook stays
 * untouched. This is a user-initiated action; per handoff §10 Hard
 * NOT, there is NO timer-driven check anywhere.
 */
async function handleCheckSourceUpdates(engine: Engine): Promise<void> {
  const wb = getWorkbook().get();
  if (wb.sources.length === 0) {
    toast('No sources mounted yet.');
    return;
  }
  toast('Checking sources for updates…');
  try {
    const diff = await computeRefreshDiff({
      sessionId: getActiveSessionId(),
      sources: wb.sources,
      lineage: getLineageStore().toJSON(),
    });
    const sourceLabelFor = (id: string): string => wb.sources.find((s) => s.id === id)?.label ?? id;
    const nb = getNotebook(engine);
    const cellLabelFor = (id: string): string => {
      const cell = nb.get().cells.find((c) => c.id === id);
      return cell?.name?.trim() || `cell ${id.slice(-6)}`;
    };
    openRefreshModal(
      {
        scanned: diff.scanned,
        staleSourceLabels: diff.staleSourceIds.map(sourceLabelFor),
        staleCellLabels: diff.staleCellIds.map(cellLabelFor),
        uncheckableSourceLabels: diff.uncheckableSourceIds.map(sourceLabelFor),
      },
      () => {
        // Persist fingerprints BEFORE re-running so the next check
        // doesn't re-stale immediately.
        void persistFingerprints(getActiveSessionId(), diff.freshFingerprints);
        void runStaleCells(engine, diff.staleCellIds);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`Refresh check failed: ${msg}`, 'error');
  }
}

/**
 * M5 — open the visual query builder. Builds the table descriptor
 * from the workbook's currently-mounted sources, then shows the
 * modal. On Generate, inserts a SQL cell with the emitted body —
 * user clicks Run (Hard NOT #4).
 *
 * Column types are inferred from DuckDB's information_schema; we
 * map the common SQL types onto the builder's 4-bucket type system
 * (numeric / string / date / boolean).
 */
/**
 * v1.3 M2 — open the measures panel.
 *
 * Pulls every cell's SQL into the descriptor so the panel can show
 * "this measure is used by N cells" (handoff §M2 — edit propagation
 * affordance). Re-renders the notebook on close to surface any
 * cells that now reference newly-added measures.
 */
/**
 * v1.3 M4 — Run a stats cell. Looks up the upstream SQL cell's last
 * result, buckets columns into numeric / identifier / other (driven
 * by taxonomy assignments + sample values), then computes
 * descriptives + correlation matrix via the pure SQL emitters in
 * `src/core/stats.ts`.
 *
 * Identifier columns (GSTIN / IFSC / email / phone — flagged by the
 * taxonomy as "identifier-class") are excluded from numeric stats
 * per handoff §M4. They get count + nulls + distinct only.
 */
async function handleRunStats(engine: Engine, cellId: string): Promise<void> {
  const nb = getNotebook(engine);
  const cell = nb.get().cells.find((c) => c.id === cellId);
  if (!cell || cell.kind !== 'stats') return;
  // For v1, the input cell is the FIRST sql/cohort/assertion cell
  // above this one with a successful result. The user can manually
  // set inputCell via the name input; if not set, auto-pick.
  const idx = nb.get().cells.findIndex((c) => c.id === cellId);
  const RESULT_KINDS = new Set(['sql', 'cohort', 'assertion']);
  let upstream: ReturnType<typeof nb.get>['cells'][number] | undefined;
  if (cell.inputCell !== null && cell.inputCell !== '') {
    const ref = nb.get().cells.find((c) => c.id === cell.inputCell);
    // Kind-guard the MANUAL reference (forward-pass M6): the auto-pick
    // branch already filters by kind, but a user-set inputCell could point
    // at a markdown / chart / input cell that has no result — surface a
    // clear error instead of the generic "has no result".
    if (ref && !RESULT_KINDS.has(ref.kind)) {
      nb.patchCell(cellId, {
        status: 'error',
        lastError: `Input cell "${ref.name ?? ref.id}" is a ${ref.kind} cell — stats needs a SQL / cohort / assertion cell.`,
      });
      return;
    }
    upstream = ref;
  } else {
    upstream = nb
      .get()
      .cells.slice(0, idx)
      .reverse()
      .find((c) => RESULT_KINDS.has(c.kind) && (c as { lastResult: unknown }).lastResult !== null);
  }
  if (!upstream) {
    nb.patchCell(cellId, {
      status: 'error',
      lastError: 'No upstream cell with a result found. Run a SQL cell above this one first.',
    });
    return;
  }
  const upstreamResult = (
    upstream as { lastResult: { columns: string[]; rows: Array<Record<string, unknown>> } | null }
  ).lastResult;
  if (!upstreamResult) {
    nb.patchCell(cellId, {
      status: 'error',
      lastError: `Upstream cell "${upstream.name ?? upstream.id}" has no result. Run it first.`,
    });
    return;
  }

  nb.patchCell(cellId, {
    status: 'running',
    lastError: null,
    inputCell: upstream.id,
  });

  // Bucket each column. Look up the column's taxonomy assignment
  // (the workbook stores type-id per column); identifier-typed
  // columns get the 'identifier' bucket; numeric SQL types (DOUBLE,
  // BIGINT, etc.) get 'numeric'; everything else is 'other'.
  const wb = getWorkbook().get();
  const columns: StatsColumnSpec[] = upstreamResult.columns.map((colName) => {
    const isIdentifierTaxonomyType = isIdentifierType(colName, wb);
    if (isIdentifierTaxonomyType) {
      return { name: colName, type: 'identifier' };
    }
    // Sample first non-null value to detect numeric vs other.
    const firstSample = upstreamResult.rows.find(
      (r) => r[colName] !== null && r[colName] !== undefined,
    );
    const val = firstSample?.[colName];
    if (typeof val === 'number') return { name: colName, type: 'numeric' };
    return { name: colName, type: 'other' };
  });

  try {
    const result = await computeStats({
      engine,
      inputCellId: upstream.id,
      columns,
    });
    // Stitch column type back into each descriptive entry.
    const descriptives = result.descriptives.map((d) => ({
      ...d,
      type: columns.find((c) => c.name === d.name)?.type ?? 'other',
    }));
    nb.patchCell(cellId, {
      status: 'success',
      descriptives,
      correlations: result.correlations,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    nb.patchCell(cellId, {
      status: 'error',
      lastError: msg,
    });
  }
}

/** Test whether a column has an identifier-class taxonomy assignment
 *  on ANY mounted source. Cheap O(assignments). */
function isIdentifierType(
  columnName: string,
  wb: { assignments: Record<string, ColumnAssignment> },
): boolean {
  for (const a of Object.values(wb.assignments)) {
    if (a.columnName !== columnName) continue;
    const typeId = a.assigned?.typeId;
    if (!typeId) continue;
    // Heuristic — taxonomy "identifier" typeIds typically end in _id
    // or are well-known (gstin, ifsc, email, phone, pan, ein, etc.).
    // The classifier doesn't expose a `category` field today; this is
    // the same heuristic v1.2 M1 used to pick anonymise default
    // strategies. Future: extend TypeSpec with an `is_identifier`
    // boolean and route through that.
    if (
      typeId === 'gstin' ||
      typeId === 'ifsc' ||
      typeId === 'email' ||
      typeId === 'phone' ||
      typeId === 'pan' ||
      typeId === 'aadhaar' ||
      typeId.endsWith('_id') ||
      typeId === 'user_id' ||
      typeId === 'session_id' ||
      typeId === 'order_id' ||
      typeId === 'sku'
    ) {
      return true;
    }
  }
  return false;
}

function handleOpenMeasures(engine: Engine): void {
  const nb = getNotebook(engine);
  const cellSqls = nb
    .get()
    .cells.filter((c) => c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion')
    .map((c) => ({ id: c.id, name: c.name, sql: (c as { code: string }).code }));
  // Imported directly (NOT lazy). The panel writes to the measures +
  // dimensions store singletons; a self-contained lazy chunk
  // (esbuild splitting:false) bundles its OWN copies of those stores, so
  // panel-defined measures/dimensions never reached the notebook's
  // expander — broken since v1.3 M2, surfaced + fixed in v1.4 F1.
  openMeasuresPanel({ cellSqls }, () => {
    // No-op; the notebook re-reads the stores on each cell run.
  });
}

/**
 * v1.3 M1 Phase 2 — gather linkable columns (every SQL cell result column
 * + its resolved taxonomy type) and open the Associations modal. Type ids
 * come from the workbook assignments keyed by column NAME — the same
 * by-name lookup `sqlExtra` uses; this is what powers the "suggest links
 * between same-type columns across cells" pass.
 */
function handleOpenAssociations(): void {
  const nb = getNotebook(getEngine());
  const wb = getWorkbook().get();
  const typeByName = new Map<string, string | null>();
  for (const a of Object.values(wb.assignments)) {
    typeByName.set(a.columnName, a.assigned?.typeId ?? null);
  }
  const options: AssocColumnOption[] = [];
  for (const cell of nb.get().cells) {
    if (cell.kind !== 'sql' || !cell.lastResult) continue;
    const cellLabel = cell.name?.trim() || `cell_${cell.id}`;
    for (const col of cell.lastResult.columns) {
      options.push({
        table: `cell_${cell.id}`,
        cellLabel,
        column: col,
        typeId: typeByName.get(col) ?? null,
      });
    }
  }
  openAssociationsModal(options);
}

function handleOpenQueryBuilder(engine: Engine): void {
  const wb = getWorkbook().get();
  // Flatten across mounted sources → one big table list. Skip
  // sources with no tables (compute-bridge-catalog placeholders, etc.).
  const tables: QueryBuilderTable[] = [];
  for (const src of wb.sources) {
    for (const tbl of src.tables) {
      // Pull columns from the workbook's assignments — already keyed
      // by `sourceId::tableId::columnName`. Map sqlType → bucket.
      const assignmentKeyPrefix = `${src.id}::${tbl.id}::`;
      const cols: QueryColumnSpec[] = [];
      for (const [key, a] of Object.entries(wb.assignments)) {
        if (!key.startsWith(assignmentKeyPrefix)) continue;
        cols.push({ name: a.columnName, type: bucketize(a.sqlType) });
      }
      if (cols.length > 0) {
        tables.push({ name: tbl.name, columns: cols });
      }
    }
  }
  if (tables.length === 0) {
    toast('Mount a source first — the query builder needs columns to work with.');
    return;
  }
  const nb = getNotebook(engine);
  openQueryBuilderModal({ tables }, (sql) => {
    const newCell = nb.addCell('sql');
    nb.patchCell(newCell.id, { code: sql });
    toast('SQL cell inserted — review then click Run.');
  });
}

function bucketize(sqlType: string): QueryColumnType {
  const t = sqlType.toUpperCase().split('(')[0]?.trim() ?? '';
  if (
    t === 'TINYINT' ||
    t === 'SMALLINT' ||
    t === 'INTEGER' ||
    t === 'BIGINT' ||
    t === 'HUGEINT' ||
    t === 'UTINYINT' ||
    t === 'USMALLINT' ||
    t === 'UINTEGER' ||
    t === 'UBIGINT' ||
    t === 'FLOAT' ||
    t === 'REAL' ||
    t === 'DOUBLE' ||
    t === 'DECIMAL' ||
    t === 'NUMERIC'
  ) {
    return 'numeric';
  }
  if (t === 'BOOLEAN' || t === 'BOOL') return 'boolean';
  if (t.startsWith('DATE') || t.startsWith('TIMESTAMP')) return 'date';
  return 'string';
}

async function runStaleCells(engine: Engine, cellIds: ReadonlyArray<string>): Promise<void> {
  const nb = getNotebook(engine);
  let ok = 0;
  let failed = 0;
  for (const id of cellIds) {
    try {
      await nb.runCell(id);
      ok++;
    } catch {
      failed++;
    }
  }
  if (failed === 0) {
    toast(`Re-ran ${ok} cell${ok === 1 ? '' : 's'}.`);
  } else {
    toast(`Re-ran ${ok} cell${ok === 1 ? '' : 's'}; ${failed} failed.`, 'error');
  }
}

async function persistSnapshot(engine: Engine): Promise<void> {
  const wb = getWorkbook().get();
  const nb = getNotebook(engine);
  // Skip the no-state case — leave the active session's stored snapshot
  // alone so a fresh boot doesn't find a stale "empty" record.
  if (wb.sources.length === 0 && nb.get().cells.length === 0) return;
  try {
    const sessionName = _activeSession?.name ?? 'Untitled';
    const file = serialize({
      notebookName: sessionName,
      sources: wb.sources,
      assignments: wb.assignments,
      cells: nb.get().cells,
      autoAcceptThreshold: wb.autoAcceptThreshold,
      userTypes: wb.userTypes,
      overrideRules: wb.overrideRules,
      lineage: getLineageStore().toJSON(),
      measures: getMeasuresStore().toFile(),
      selections: getSelectionsStore().toFile(),
      associations: getAssociationsStore().toFile(),
      dimensions: getDimensionsStore().toFile(),
    });
    await saveSnapshot(getActiveSessionId(), file);
  } catch (err) {
    console.warn('[naklidata] snapshot save failed', err);
  }
  // Persist settings on the same beat — autoAcceptThreshold is the
  // cross-session default (each session also persists its own value via
  // the snapshot, but a fresh session reads from settings).
  try {
    // Read current settings so sidecar fields (which the modal owns)
    // aren't clobbered by this workbook-driven save. Only update what
    // belongs to the workbook (auto-accept threshold).
    const current = await loadSettings();
    const settings: Settings = {
      ...current,
      autoAcceptThreshold: wb.autoAcceptThreshold,
    };
    await saveSettings(settings);
  } catch (err) {
    console.warn('[naklidata] settings save failed', err);
  }
}

function wireActions(root: HTMLElement): void {
  root.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (!action) return;
    // Some sub-components attach their own click handlers; let those bubble
    // through without our default dispatch.
    if (
      [
        'accept',
        'evidence',
        'threshold-slider',
        'bulk-accept',
        'instantiate',
        'cell-run',
        'cell-delete',
        'cell-toggle',
      ].includes(action)
    ) {
      return;
    }
    void handleAction(action, actionEl);
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'k') {
      ev.preventDefault();
      void handleAction('spotlight', null);
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
      ev.preventDefault();
      void handleAction('save', null);
    }
  });

  // Close the session-switcher dropdown when clicking outside it.
  document.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target || target.closest('.session-switcher')) return;
    const menu = document.querySelector<HTMLElement>('[data-region="session-menu"]');
    if (menu) menu.removeAttribute('data-open');
  });
}

async function handleAction(action: string, el: HTMLElement | null): Promise<void> {
  const engine = getEngine();
  const workbook = getWorkbook();
  switch (action) {
    case 'browse-examples': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      try {
        const sources = await mountExampleBundle(engine);
        workbook.addSources(sources);
        toast(`Loaded ${sources.length} example source${sources.length === 1 ? '' : 's'}.`);
        void classifyMountedSources(engine, sources);
      } catch (err) {
        const msg = err instanceof MountError || err instanceof Error ? err.message : String(err);
        toast(`Could not mount examples: ${msg}`, 'error');
      }
      return;
    }
    case 'mount-file': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      try {
        const file = await pickSingleFile();
        if (!file) return;
        const source = await mountFile(engine, file);
        workbook.addSources([source]);
        toast(`Mounted ${file.name}.`);
        void classifyMountedSources(engine, [source]);
      } catch (err) {
        const msg = err instanceof MountError || err instanceof Error ? err.message : String(err);
        toast(`Mount failed: ${msg}`, 'error');
      }
      return;
    }
    case 'remove-source': {
      const id = el?.dataset.sourceId;
      if (!id) return;
      const src = workbook.get().sources.find((s) => s.id === id);
      if (src) {
        for (const t of src.tables) {
          try {
            await engine.drop(t.name);
          } catch (err) {
            console.warn(`[naklidata] drop view failed for ${t.name}`, err);
          }
        }
        // Wave 2 slice 2 + 3a — secrets owned by this source should not
        // outlive it. Quiet on failure (IDB unavailable, etc.).
        if (src.kind === 's3-endpoint') {
          try {
            await forgetSource(id, [...S3_SECRET_NAMES]);
          } catch (err) {
            console.warn(`[naklidata] secret cleanup failed for ${id}`, err);
          }
        }
        if (src.kind === 'iceberg-table' || src.kind === 'iceberg-catalog') {
          try {
            await forgetSource(id, [...ICEBERG_SECRET_NAMES]);
          } catch (err) {
            console.warn(`[naklidata] iceberg secret cleanup failed for ${id}`, err);
          }
        }
        if (src.kind === 'compute-bridge' || src.kind === 'compute-bridge-catalog') {
          try {
            await forgetSource(id, [...BRIDGE_SECRET_NAMES]);
          } catch (err) {
            console.warn(`[naklidata] bridge secret cleanup failed for ${id}`, err);
          }
        }
        // FSA folder/file handles live in IDB keyed by the source ref;
        // free the handle when the source is removed so it doesn't leak
        // past the source that owned it (forward-pass H1). Best-effort.
        if ((src.kind === 'fsa-folder' || src.kind === 'fsa-file') && src.ref) {
          try {
            await deleteHandle(src.ref);
          } catch (err) {
            console.warn(`[naklidata] handle cleanup failed for ${id}`, err);
          }
        }
      }
      workbook.removeSource(id);
      return;
    }
    case 'save': {
      const wb = workbook.get();
      if (wb.sources.length === 0) {
        toast('Nothing to save yet.');
        return;
      }
      const nb = getNotebook(engine);
      const file = serialize({
        notebookName: 'Untitled',
        sources: wb.sources,
        assignments: wb.assignments,
        cells: nb.get().cells,
        autoAcceptThreshold: wb.autoAcceptThreshold,
        userTypes: wb.userTypes,
        overrideRules: wb.overrideRules,
        lineage: getLineageStore().toJSON(),
      });
      try {
        const res = await saveToFile(file);
        toast(`Saved ${res.name}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Save failed: ${msg}`, 'error');
      }
      return;
    }
    case 'load': {
      try {
        const file = await loadFromFile();
        if (!file) return;
        await applyLoadedFile(engine, file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Load failed: ${msg}`, 'error');
      }
      return;
    }
    case 'session-menu': {
      const menu = document.querySelector<HTMLElement>('[data-region="session-menu"]');
      if (menu) {
        const open = menu.hasAttribute('data-open');
        if (open) menu.removeAttribute('data-open');
        else menu.setAttribute('data-open', '');
      }
      return;
    }
    case 'session-new': {
      const root = document.getElementById('app');
      if (!root) return;
      await persistSnapshot(engine); // flush current
      const meta = await createSession();
      _activeSession = meta;
      getWorkbook().clear();
      getNotebook(engine).load([]);
      await refreshSessionSwitcher(root);
      toast(`Started new session "${meta.name}".`);
      return;
    }
    case 'session-switch': {
      const root = document.getElementById('app');
      const id = el?.dataset.sessionId;
      if (!root || !id || id === _activeSession?.id) return;
      await switchToSession(engine, root, id);
      return;
    }
    case 'session-rename': {
      const root = document.getElementById('app');
      const id = el?.dataset.sessionId ?? _activeSession?.id ?? null;
      if (!root || !id) return;
      const current = (await loadIndex()).sessions.find((s) => s.id === id)?.name ?? 'Untitled';
      const next = window.prompt('Rename session:', current);
      if (next === null) return; // cancelled
      try {
        await renameSession(id, next);
        if (_activeSession?.id === id) _activeSession.name = next.trim() || _activeSession.name;
        await refreshSessionSwitcher(root);
        toast(`Renamed to "${next.trim()}".`);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      }
      return;
    }
    case 'session-delete': {
      const root = document.getElementById('app');
      const id = el?.dataset.sessionId;
      if (!root || !id) return;
      const idx = await loadIndex();
      if (idx.sessions.length <= 1) {
        toast('Cannot delete the last session.', 'error');
        return;
      }
      const meta = idx.sessions.find((s) => s.id === id);
      if (!meta) return;
      const ok = window.confirm(`Delete session "${meta.name}"? This can't be undone.`);
      if (!ok) return;
      const wasActive = _activeSession?.id === id;
      try {
        await deleteSession(id);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
        return;
      }
      if (wasActive) {
        const fresh = await loadIndex();
        const nextActive = fresh.sessions.find((s) => s.id === fresh.activeId);
        if (nextActive) {
          _activeSession = nextActive;
          getWorkbook().clear();
          getNotebook(engine).load([]);
          await restoreFromActiveSession(engine);
        }
      }
      await refreshSessionSwitcher(root);
      toast(`Deleted "${meta.name}".`);
      return;
    }
    case 'open-schema-graph': {
      void openSchemaGraph();
      return;
    }
    case 'open-lineage': {
      openLineagePanel();
      return;
    }
    case 'check-source-updates': {
      await handleCheckSourceUpdates(engine);
      return;
    }
    case 'open-query-builder': {
      handleOpenQueryBuilder(engine);
      return;
    }
    case 'open-measures': {
      handleOpenMeasures(engine);
      return;
    }
    case 'open-associations': {
      handleOpenAssociations();
      return;
    }
    case 'selections-clear': {
      getSelectionsStore().clearAll();
      toast('Selections cleared.');
      return;
    }
    case 'toggle-selection': {
      const table = el?.dataset.table;
      const column = el?.dataset.column;
      const value = el?.dataset.value;
      if (!table || !column || value === undefined) return;
      getSelectionsStore().toggle({ table, column }, value);
      return;
    }
    case 'run-stats': {
      const cellId = el?.dataset.cellId;
      if (!cellId) return;
      await handleRunStats(engine, cellId);
      return;
    }
    case 'report-print': {
      // v1.3 M3 — print the report. `triggerReportPrint` sets
      // [data-printing] so the scoped @media print CSS reveals only this
      // report (H10); beforeprint embeds the cell-ref content (H11).
      const cellId = el?.dataset.cellId;
      if (cellId) triggerReportPrint(cellId);
      return;
    }
    case 'open-settings': {
      void openSettingsModal();
      return;
    }
    case 'explain-error': {
      const cellId = el?.dataset.cellId;
      if (!cellId) return;
      await runExplainError(engine, cellId);
      return;
    }
    case 'summarise-result': {
      const cellId = el?.dataset.cellId;
      if (!cellId) return;
      await runSummariseResult(engine, cellId);
      return;
    }
    case 'propose-chart': {
      const cellId = el?.dataset.cellId;
      if (!cellId) return;
      await runProposeChart(engine, cellId);
      return;
    }
    case 'ask-nl-to-sql': {
      openNlToSqlSidecar(engine);
      return;
    }
    case 'export-html': {
      const wb = workbook.get();
      if (wb.sources.length === 0) {
        toast('Nothing to export yet — mount a source first.');
        return;
      }
      const notebookEl = document.querySelector<HTMLElement>('[data-region="notebook"]');
      if (!notebookEl) {
        toast('Notebook not ready yet.');
        return;
      }
      try {
        const title = _activeSession?.name?.trim() || 'NakliData notebook';
        const html = buildStandaloneHtml({ notebookRoot: notebookEl, title });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `${
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'notebook'
        }-${stamp}.html`;
        const written = await saveHtmlFile(html, fileName);
        if (written) toast(`Exported ${written}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Export failed: ${msg}`, 'error');
      }
      return;
    }
    case 'exit-presentation': {
      // W6.2 — strip the ?present=1 query and reload so the app boots
      // fresh in workbench mode. Reload (rather than just toggling the
      // class) ensures the URL state matches the visible state — if the
      // user shares the URL while in presentation, the recipient also
      // lands in presentation; conversely the exit affordance produces
      // a clean workbench URL.
      const url = new URL(location.href);
      url.searchParams.delete('present');
      location.replace(url.toString());
      return;
    }
    case 'ask-sidecar-disambiguate': {
      const sourceId = el?.dataset.sourceId;
      const tableId = el?.dataset.tableId;
      const columnName = el?.dataset.column;
      if (!sourceId || !tableId || !columnName) return;
      await runDisambiguateType(engine, el, sourceId, tableId, columnName);
      return;
    }
    case 'show-profile': {
      const sourceId = el?.dataset.sourceId;
      const tableId = el?.dataset.tableId;
      const columnName = el?.dataset.column;
      if (!sourceId || !tableId || !columnName) return;
      await runShowProfile(engine, sourceId, tableId, columnName);
      return;
    }
    case 'define-new-type': {
      const sourceId = el?.dataset.sourceId;
      const tableId = el?.dataset.tableId;
      const columnName = el?.dataset.column;
      const sqlType = el?.dataset.sqlType ?? 'VARCHAR';
      if (!sourceId || !tableId || !columnName) return;
      const wb = workbook.get();
      const tableName =
        wb.sources.find((s) => s.id === sourceId)?.tables.find((t) => t.id === tableId)?.name ?? '';
      if (!tableName) {
        toast('Table not found for that column.', 'error');
        return;
      }
      await openDefineTypeModal({ sourceId, tableId, tableName, columnName, sqlType });
      return;
    }
    case 'copy-suggested-fix': {
      const cellId = el?.dataset.cellId;
      if (!cellId) return;
      const pre = document.querySelector<HTMLElement>(
        `[data-region="sidecar-result-${cellId}"] [data-suggested-sql]`,
      );
      const sql = pre?.dataset.suggestedSql ?? '';
      if (!sql) return;
      try {
        await navigator.clipboard.writeText(sql);
        toast('Suggested SQL copied. Paste into the cell to try it.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Couldn't copy: ${msg}`, 'error');
      }
      return;
    }
    case 'share-link': {
      const wb = workbook.get();
      if (wb.sources.length === 0) {
        toast('Mount a source first — nothing to share yet.');
        return;
      }
      const nb = getNotebook(engine);
      const file = serialize({
        notebookName: 'Untitled',
        sources: wb.sources,
        assignments: wb.assignments,
        cells: nb.get().cells,
        autoAcceptThreshold: wb.autoAcceptThreshold,
        userTypes: wb.userTypes,
        overrideRules: wb.overrideRules,
      });
      try {
        const { url, tooLong } = await buildShareUrl(file);
        await navigator.clipboard.writeText(url);
        toast(
          tooLong
            ? `Link copied (${url.length.toLocaleString()} chars — some chat tools may truncate).`
            : 'Share link copied to clipboard.',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Could not build share link: ${msg}`, 'error');
      }
      return;
    }
    case 'mount-folder': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      try {
        const dir = await pickDirectory();
        if (!dir) return;
        const src = await mountFolder(engine, dir);
        workbook.addSources([src]);
        toast(
          `Mounted folder ${src.label} (${src.tables.length} table${src.tables.length === 1 ? '' : 's'}).`,
        );
        void classifyMountedSources(engine, [src]);
      } catch (err) {
        const msg = err instanceof MountError || err instanceof Error ? err.message : String(err);
        toast(`Folder mount failed: ${msg}`, 'error');
      }
      return;
    }
    case 'mount-url': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      openMountUrlModal({
        onMount: async ({ label, url }) => {
          // mountUrl throws MountError on bad URL / unsupported format /
          // network failure — let the modal's try/catch surface those
          // inline rather than re-toasting.
          const source = await mountUrl(engine, { url, ...(label ? { label } : {}) });
          workbook.addSources([source]);
          toast(`Mounted "${source.label}".`);
          void classifyMountedSources(engine, [source]);
        },
      });
      return;
    }
    case 'mount-s3': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      openMountS3Modal({
        onMount: async (input) => {
          const source = await mountS3Endpoint(engine, input);
          // Persist secrets under the freshly-minted sourceId. Honour the
          // "Remember on this device" choice; secrets never make it into
          // the .naklidata file regardless.
          await saveSecret(source.id, 'access_key_id', input.accessKeyId, input.remember);
          await saveSecret(source.id, 'secret_access_key', input.secretAccessKey, input.remember);
          workbook.addSources([source]);
          toast(`Mounted "${source.label}".`);
          void classifyMountedSources(engine, [source]);
        },
      });
      return;
    }
    case 'mount-iceberg': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      openMountIcebergModal({
        onMount: async (input) => {
          const source = await mountIcebergTable(engine, {
            label: input.label,
            metadataUrl: input.metadataUrl,
            bearerToken: input.bearerToken.trim() || null,
          });
          // Save the Bearer token if one was provided. Empty token =
          // public table; nothing to persist.
          if (input.bearerToken.trim()) {
            await saveSecret(source.id, 'bearer_token', input.bearerToken, input.remember);
          }
          workbook.addSources([source]);
          toast(`Mounted "${source.label}".`);
          void classifyMountedSources(engine, [source]);
        },
      });
      return;
    }
    case 'mount-iceberg-catalog': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      openMountIcebergCatalogModal({
        onMount: async (input) => {
          const source = await mountIcebergCatalog(engine, {
            label: input.label,
            catalogUrl: input.catalogUrl,
            namespace: input.namespace,
            table: input.table,
            bearerToken: input.bearerToken.trim() || null,
          });
          if (input.bearerToken.trim()) {
            await saveSecret(source.id, 'bearer_token', input.bearerToken, input.remember);
          }
          workbook.addSources([source]);
          toast(`Mounted "${source.label}".`);
          void classifyMountedSources(engine, [source]);
        },
      });
      return;
    }
    case 'mount-compute-bridge': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      openMountComputeBridgeModal({
        onMount: async (input) => {
          const source = await mountComputeBridge(engine, {
            label: input.label,
            bridgeUrl: input.bridgeUrl,
            sql: input.sql,
            tableName: input.tableName,
            bearerToken: input.bearerToken.trim() || null,
          });
          if (input.bearerToken.trim()) {
            await saveSecret(source.id, 'bearer_token', input.bearerToken, input.remember);
          }
          workbook.addSources([source]);
          toast(`Mounted "${source.label}".`);
          void classifyMountedSources(engine, [source]);
        },
      });
      return;
    }
    case 'mount-compute-bridge-catalog': {
      if (engine.getStatus() !== 'ready') {
        toast('Engine still booting — try again in a moment.');
        return;
      }
      openMountComputeBridgeCatalogModal({
        onConnect: async ({ bridgeUrl, bearerToken }) => {
          // Probe + list. Constructed transiently — once the user picks
          // tables and confirms, mountComputeBridgeCatalog builds its own
          // client with the same URL + token for the actual queries.
          const { BridgeClient } = await import('./core/bridge/bridge-client.ts');
          const client = new BridgeClient({
            bridgeUrl: bridgeUrl.trim(),
            bearerToken: bearerToken.trim() || null,
          });
          await client.health();
          return await client.listTables();
        },
        onMount: async (input) => {
          const source = await mountComputeBridgeCatalog(engine, {
            label: input.label,
            bridgeUrl: input.bridgeUrl,
            bearerToken: input.bearerToken.trim() || null,
            tables: input.tables,
          });
          if (input.bearerToken.trim()) {
            await saveSecret(source.id, 'bearer_token', input.bearerToken, input.remember);
          }
          workbook.addSources([source]);
          toast(`Mounted ${source.tables.length} table(s) from "${source.label}".`);
          void classifyMountedSources(engine, [source]);
        },
      });
      return;
    }
    case 'add-source':
    case 'spotlight':
      console.info(`[naklidata] action requested: ${action} (not yet wired)`);
      toast(`${action} is not wired yet.`);
      return;
    default:
      console.warn(`[naklidata] unknown action: ${action}`);
  }
}

interface ApplyLoadedOptions {
  /**
   * Silent restore mode — used by boot-time IDB snapshot restore.
   * Suppresses the success toast (the user didn't ask), and uses
   * queryPermission (not requestPermission) for FSA folder handles
   * since no user activation is available at boot.
   */
  silent?: boolean;
}

/**
 * Serialises applyLoadedFile invocations. The function clears the
 * workbook then awaits an async mount-and-restore sequence, so two
 * overlapping calls (e.g. boot-time auto-restore racing an explicit
 * Load click) would each clear the same empty workbook, then both
 * append their sources at the end — producing duplicate cards. Each
 * new call awaits the previous one before doing any work; errors from
 * a prior invocation don't block the next (they're independent work
 * and the original caller has already received the rejection).
 */
let _applyLoadedChain: Promise<unknown> = Promise.resolve();

async function applyLoadedFile(
  engine: Engine,
  file: NakliDataFile,
  opts: ApplyLoadedOptions = {},
): Promise<void> {
  const prev = _applyLoadedChain;
  const next = (async () => {
    try {
      await prev;
    } catch {
      // Prior invocation's rejection is not our concern.
    }
    await doApplyLoadedFile(engine, file, opts);
  })();
  _applyLoadedChain = next;
  return next;
}

async function doApplyLoadedFile(
  engine: Engine,
  file: NakliDataFile,
  opts: ApplyLoadedOptions = {},
): Promise<void> {
  const workbook = getWorkbook();
  const nb = getNotebook(engine);
  workbook.clear();
  // Restore user-defined types from the file before sources mount, so the
  // override menu has them available when the schema panel re-renders.
  workbook.setUserTypes(file.user_types ?? []);
  // Restore override rules (Theme 4 wave 2). Pre-existing v1.0 files
  // round-trip with an empty list — no migration step needed.
  workbook.setOverrideRules(file.override_rules ?? []);
  const reconnectNeeded: Array<{ id: string; label: string }> = [];
  const restoredSources: MountedSource[] = [];
  for (const ps of file.sources) {
    if (ps.kind === 'example-bundle') {
      // Re-mount the bundle and pick the source matching the persisted ref.
      try {
        const allBundle = await mountExampleBundle(engine);
        const match = allBundle.find((s) => s.ref === ps.ref);
        if (match) {
          // Preserve the persisted id so assignment keys still resolve.
          const remapped: MountedSource = { ...match, id: ps.id };
          for (let i = 0; i < remapped.tables.length; i++) {
            const persistedTable = ps.tables[i];
            const t = remapped.tables[i];
            if (persistedTable && t) {
              t.id = persistedTable.id;
              t.sourceId = remapped.id;
            }
          }
          restoredSources.push(remapped);
        }
      } catch (err) {
        console.warn('[naklidata] example-bundle re-mount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 'fsa-folder' && ps.ref) {
      // Try to re-attach the stored folder handle.
      //   - silent mode (boot-time auto-restore): use queryPermission only;
      //     no user activation available so we can't prompt.
      //   - non-silent mode (user clicked Open): ensureReadPermission can
      //     prompt and re-grant.
      try {
        const handle = await getHandle(ps.ref);
        if (!handle || handle.kind !== 'directory') {
          reconnectNeeded.push({ id: ps.id, label: ps.label });
        } else {
          const granted = opts.silent
            ? (await queryReadPermissionQuiet(handle)) === 'granted'
            : await ensureReadPermission(handle);
          if (!granted) {
            reconnectNeeded.push({ id: ps.id, label: ps.label });
          } else {
            const remounted = await remountFolderFromHandle(
              engine,
              handle as FileSystemDirectoryHandle,
              ps.ref,
              ps.label,
              ps.id,
            );
            restoredSources.push(remounted);
          }
        }
      } catch (err) {
        console.warn('[naklidata] folder remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 'http' && ps.ref) {
      // Wave 2 slice 1 — re-mount a public URL. No auth, no permission
      // re-grant; the URL itself is the entire identifier. Failures
      // (network, 404, format mismatch) surface as a reconnect prompt
      // rather than tanking the whole load.
      try {
        const remounted = await mountUrl(engine, { url: ps.ref, label: ps.label });
        // Preserve the persisted ids so assignment keys still resolve.
        remounted.id = ps.id;
        for (let i = 0; i < remounted.tables.length; i++) {
          const persistedTable = ps.tables[i];
          const t = remounted.tables[i];
          if (persistedTable && t) {
            t.id = persistedTable.id;
            t.sourceId = remounted.id;
          }
        }
        restoredSources.push(remounted);
      } catch (err) {
        console.warn('[naklidata] URL remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 'iceberg-catalog' && ps.iceberg_catalog) {
      // Wave 2 slice 3b — re-mount via REST catalog. The catalog
      // re-resolves the current metadata-location, so new snapshots
      // pick up automatically. Bearer token (if required) is looked
      // up via source-secrets.
      try {
        const bearerToken = ps.iceberg_catalog.requires_bearer
          ? await loadSecret(ps.id, 'bearer_token')
          : null;
        if (ps.iceberg_catalog.requires_bearer && !bearerToken) {
          reconnectNeeded.push({ id: ps.id, label: ps.label });
        } else {
          const remounted = await mountIcebergCatalog(engine, {
            label: ps.label,
            catalogUrl: ps.iceberg_catalog.catalog_url,
            namespace: ps.iceberg_catalog.namespace,
            table: ps.iceberg_catalog.table,
            bearerToken,
          });
          remounted.id = ps.id;
          for (let i = 0; i < remounted.tables.length; i++) {
            const persistedTable = ps.tables[i];
            const t = remounted.tables[i];
            if (persistedTable && t) {
              t.id = persistedTable.id;
              t.sourceId = remounted.id;
            }
          }
          restoredSources.push(remounted);
        }
      } catch (err) {
        console.warn('[naklidata] Iceberg catalog remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 'compute-bridge' && ps.bridge) {
      // Wave 3 W3.4a — re-mount via the Compute Bridge. The SQL re-runs
      // against the bridge so fresh data is pulled. Bearer token (if
      // required) is looked up via source-secrets; missing → reconnect.
      // health() probe failures route here too (graceful — the rest of
      // the workbook keeps loading).
      try {
        const bearerToken = ps.bridge.requires_bearer
          ? await loadSecret(ps.id, 'bearer_token')
          : null;
        if (ps.bridge.requires_bearer && !bearerToken) {
          reconnectNeeded.push({ id: ps.id, label: ps.label });
        } else {
          const remounted = await mountComputeBridge(engine, {
            label: ps.label,
            bridgeUrl: ps.bridge.bridge_url,
            sql: ps.bridge.sql,
            tableName: ps.bridge.table_name,
            bearerToken,
          });
          remounted.id = ps.id;
          for (let i = 0; i < remounted.tables.length; i++) {
            const persistedTable = ps.tables[i];
            const t = remounted.tables[i];
            if (persistedTable && t) {
              t.id = persistedTable.id;
              t.sourceId = remounted.id;
            }
          }
          restoredSources.push(remounted);
        }
      } catch (err) {
        console.warn('[naklidata] Compute Bridge remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 'compute-bridge-catalog' && ps.bridge_catalog) {
      // Wave 3 W3.4b — re-mount a Compute Bridge catalog. Each picked
      // table re-runs as SELECT * FROM <name> LIMIT <cap> against the
      // bridge so fresh data is pulled. Bearer token (if required) is
      // looked up via source-secrets; missing or unreachable → reconnect.
      try {
        const bearerToken = ps.bridge_catalog.requires_bearer
          ? await loadSecret(ps.id, 'bearer_token')
          : null;
        if (ps.bridge_catalog.requires_bearer && !bearerToken) {
          reconnectNeeded.push({ id: ps.id, label: ps.label });
        } else {
          const remounted = await mountComputeBridgeCatalog(engine, {
            label: ps.label,
            bridgeUrl: ps.bridge_catalog.bridge_url,
            bearerToken,
            tables: ps.bridge_catalog.tables.map((t) => ({
              name: t.name,
              localName: t.local_name,
              rowCap: t.row_cap,
            })),
          });
          remounted.id = ps.id;
          for (let i = 0; i < remounted.tables.length; i++) {
            const persistedTable = ps.tables[i];
            const t = remounted.tables[i];
            if (persistedTable && t) {
              t.id = persistedTable.id;
              t.sourceId = remounted.id;
            }
          }
          restoredSources.push(remounted);
        }
      } catch (err) {
        console.warn('[naklidata] Compute Bridge catalog remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 'iceberg-table' && ps.iceberg) {
      // Wave 2 slice 3a — re-mount an Iceberg table by URL. Bearer
      // token (if required) is looked up via source-secrets.
      try {
        const bearerToken = ps.iceberg.requires_bearer
          ? await loadSecret(ps.id, 'bearer_token')
          : null;
        if (ps.iceberg.requires_bearer && !bearerToken) {
          reconnectNeeded.push({ id: ps.id, label: ps.label });
        } else {
          const remounted = await mountIcebergTable(engine, {
            label: ps.label,
            metadataUrl: ps.iceberg.metadata_url,
            bearerToken,
          });
          remounted.id = ps.id;
          for (let i = 0; i < remounted.tables.length; i++) {
            const persistedTable = ps.tables[i];
            const t = remounted.tables[i];
            if (persistedTable && t) {
              t.id = persistedTable.id;
              t.sourceId = remounted.id;
            }
          }
          restoredSources.push(remounted);
        }
      } catch (err) {
        console.warn('[naklidata] Iceberg table remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else if (ps.kind === 's3-endpoint' && ps.s3) {
      // Wave 2 slice 2 — re-mount an S3-compatible source. Secrets are
      // never persisted in the file; we look them up via source-secrets
      // (sessionStorage for the current session, IDB if the user opted
      // in to "Remember on this device"). Missing keys → reconnect.
      try {
        const accessKeyId = await loadSecret(ps.id, 'access_key_id');
        const secretAccessKey = await loadSecret(ps.id, 'secret_access_key');
        if (!accessKeyId || !secretAccessKey) {
          reconnectNeeded.push({ id: ps.id, label: ps.label });
        } else {
          const remounted = await mountS3Endpoint(engine, {
            label: ps.label,
            endpoint: ps.s3.endpoint,
            region: ps.s3.region,
            bucket: ps.s3.bucket,
            pathPrefix: ps.s3.path_prefix,
            urlStyle: ps.s3.url_style,
            accessKeyId,
            secretAccessKey,
          });
          remounted.id = ps.id;
          for (let i = 0; i < remounted.tables.length; i++) {
            const persistedTable = ps.tables[i];
            const t = remounted.tables[i];
            if (persistedTable && t) {
              t.id = persistedTable.id;
              t.sourceId = remounted.id;
            }
          }
          restoredSources.push(remounted);
        }
      } catch (err) {
        console.warn('[naklidata] S3 endpoint remount failed', err);
        reconnectNeeded.push({ id: ps.id, label: ps.label });
      }
    } else {
      // Single-file FSA sources require manual re-pick — no handle was stored.
      reconnectNeeded.push({ id: ps.id, label: ps.label });
    }
  }
  if (restoredSources.length > 0) workbook.addSources(restoredSources);
  // Restore assignments
  for (const a of file.assignments) {
    workbook.setAssignment(a.key, {
      columnName: a.columnName,
      sqlType: a.sqlType,
      candidates: a.candidates,
      resolution: { kind: a.resolutionKind },
      assigned: { typeId: a.typeId, origin: a.origin, confidence: a.confidence },
      status: 'classified',
    });
  }
  workbook.setAutoAcceptThreshold(file.settings.auto_accept_threshold ?? 0.9);
  // Restore cells (already stripped of lastResult/lastError).
  nb.load(file.cells);
  // M2 — restore lineage graph snapshot (optional; pre-M2 files have no
  // lineage field, so the store stays empty until a cell runs).
  if (file.lineage) {
    getLineageStore().loadFromJson(file.lineage);
  } else {
    // Reset on load so a session-switch from a lineage-bearing notebook
    // doesn't leak edges into a lineage-less one.
    getLineageStore().loadFromJson({ version: 1, nodes: [], edges: [] });
  }
  // v1.3 M2 — restore measures (optional; pre-v1.3 files have no
  // measures field).
  getMeasuresStore().loadFromFile(file.measures);
  // v1.3 M1 — restore selections (optional).
  getSelectionsStore().loadFromFile(file.selections);
  // v1.3 M1 Phase 2 — restore associations (optional).
  getAssociationsStore().loadFromFile(file.associations);
  // v1.4 F1 — restore dimensions (optional).
  getDimensionsStore().loadFromFile(file.dimensions);
  if (reconnectNeeded.length > 0) {
    toast(`Reconnect needed: ${reconnectNeeded.map((s) => s.label).join(', ')}`, 'error');
  } else if (!opts.silent) {
    toast(`Loaded "${file.name}".`);
  }
}

async function classifyMountedSources(engine: Engine, sources: MountedSource[]): Promise<void> {
  const workbook = getWorkbook();
  const client = getTaxonomyClient();
  try {
    await client.ensureReady();
  } catch (err) {
    console.error('[naklidata] taxonomy boot failed', err);
    toast(`Classifier failed to start: ${err instanceof Error ? err.message : err}`, 'error');
    return;
  }
  for (const src of sources) {
    for (const table of src.tables) {
      try {
        const results = await classifyTableColumns(engine, client, table.name);
        for (const r of results) {
          const key = assignmentKey(src.id, table.id, r.column.columnName);
          // Theme 4 wave 2: an override rule for this column-name (if any)
          // wins over the fresh detector output — user told us "always
          // treat this name as X", so newly-mounted sources should
          // inherit that intent without re-clicking.
          const fresh = resultToAssignment(r);
          const rules = workbook.get().overrideRules;
          workbook.setAssignment(key, applyOverrideRule(fresh, rules));
        }
      } catch (err) {
        console.error(`[naklidata] classify failed for ${table.name}`, err);
      }
    }
  }
}

/**
 * Re-run classification across every mounted source, but preserve any
 * column the user has already accepted or overridden. Used when user
 * types change and the user wants existing mounts to pick up the new
 * detectors. Refreshes the candidate list for accepted/overridden
 * columns so the Override menu sees newly-firing user types.
 */
async function reclassifyAllSources(engine: Engine): Promise<void> {
  const workbook = getWorkbook();
  const sources = workbook.get().sources;
  if (sources.length === 0) {
    toast('No mounted sources to re-classify.');
    return;
  }
  const client = getTaxonomyClient();
  try {
    await client.ensureReady();
  } catch (err) {
    toast(`Classifier failed to start: ${err instanceof Error ? err.message : err}`, 'error');
    return;
  }
  let touched = 0;
  let preserved = 0;
  for (const src of sources) {
    for (const table of src.tables) {
      try {
        const results = await classifyTableColumns(engine, client, table.name);
        for (const r of results) {
          const key = assignmentKey(src.id, table.id, r.column.columnName);
          const existing = workbook.get().assignments[key];
          const fresh = resultToAssignment(r);
          if (
            existing &&
            (existing.assigned.origin === 'user_accept' ||
              existing.assigned.origin === 'user_override')
          ) {
            // Preserve the user's pick; refresh the candidate list so the
            // Override menu sees user types that fire now.
            workbook.setAssignment(key, { ...existing, candidates: fresh.candidates });
            preserved++;
          } else {
            // Theme 4 wave 2: apply override rules to detector-origin
            // assignments. A rule for this column-name (if any) snaps
            // the typeId without disturbing the user's manual choices
            // (those branch above and are preserved).
            const rules = workbook.get().overrideRules;
            workbook.setAssignment(key, applyOverrideRule(fresh, rules));
            touched++;
          }
        }
      } catch (err) {
        console.error(`[naklidata] reclassify failed for ${table.name}`, err);
      }
    }
  }
  toast(`Re-classified: ${touched} updated, ${preserved} preserved (user choices kept).`);
}

/**
 * Theme 4 wave 2 (B3). If an override rule exists for the assignment's
 * column-name, return a copy with `assigned.typeId` snapped to the
 * rule's typeId and `origin: 'user_override'` (same shape the manual
 * Override action produces). The candidate list is preserved so the
 * Evidence panel still shows what the classifier originally found.
 *
 * Caller is responsible for not invoking this on assignments that have
 * already been hand-curated by the user on this specific column —
 * those are preserved by the surrounding classify loops.
 */
function applyOverrideRule(
  fresh: ColumnAssignment,
  rules: ReadonlyArray<{ columnName: string; typeId: string }>,
): ColumnAssignment {
  const rule = rules.find((r) => r.columnName === fresh.columnName);
  if (!rule) return fresh;
  return {
    ...fresh,
    assigned: {
      typeId: rule.typeId,
      origin: 'user_override',
      confidence: 1,
    },
  };
}

function resultToAssignment(r: ClassificationResult): ColumnAssignment {
  const candidates = r.candidates.map((c) => ({
    typeId: c.typeId,
    displayName: c.displayName,
    confidence: c.confidence,
    evidence: c.evidence,
  }));
  let assigned: ColumnAssignment['assigned'];
  if (r.resolution.kind === 'auto_accept') {
    const top = candidates[0];
    assigned = {
      typeId: r.resolution.typeId,
      origin: 'detector',
      confidence: top ? top.confidence : r.resolution.confidence,
    };
  } else if (r.resolution.kind === 'ambiguous') {
    const top = candidates[0];
    assigned = {
      typeId: top ? top.typeId : null,
      origin: 'detector',
      confidence: top ? top.confidence : 0,
    };
  } else {
    assigned = { typeId: null, origin: 'unknown', confidence: 0 };
  }
  return {
    columnName: r.column.columnName,
    sqlType: r.column.sqlType,
    candidates,
    resolution: { kind: r.resolution.kind },
    assigned,
    status: 'classified',
  };
}

function acceptAssignment(sourceId: string, tableId: string, columnName: string): void {
  const workbook = getWorkbook();
  const key = assignmentKey(sourceId, tableId, columnName);
  const a = workbook.get().assignments[key];
  if (!a) return;
  workbook.setAssignment(key, {
    ...a,
    assigned: { ...a.assigned, origin: 'user_accept' },
  });
}

function overrideAssignment(
  sourceId: string,
  tableId: string,
  columnName: string,
  typeId: string | null,
): void {
  const workbook = getWorkbook();
  const key = assignmentKey(sourceId, tableId, columnName);
  const a = workbook.get().assignments[key];
  if (!a) return;
  const candidate = a.candidates.find((c) => c.typeId === typeId);
  workbook.setAssignment(key, {
    ...a,
    assigned: {
      typeId,
      origin: typeId === null ? 'unknown' : 'user_override',
      confidence: candidate ? candidate.confidence : 1, // user choice = full
    },
  });
  // Theme 4 wave 2 (B3). When the override sets a real typeId, offer a
  // "Remember rule" toast so the user can promote this one-off pick to
  // a persistent rule that applies to other current + future columns
  // sharing the same name. Setting to unknown (typeId === null) skips
  // the offer — that's a "this column is special" gesture, not a rule.
  if (typeId !== null) {
    offerRememberRule(columnName, typeId);
  }
}

/**
 * Show a toast offering to promote the just-completed Override into a
 * persistent rule. Skipped silently if a rule for this column-name +
 * typeId already exists (the user already chose to remember it before).
 *
 * Theme 4 wave 2 (B3). See DECISIONS 2026-05-21 for the rationale on
 * opt-in (not automatic) rule learning.
 */
function offerRememberRule(columnName: string, typeId: string): void {
  const workbook = getWorkbook();
  const existing = workbook.get().overrideRules.find((r) => r.columnName === columnName);
  if (existing && existing.typeId === typeId) return; // already remembered
  const friendlyType = friendlyTypeName(typeId);
  toast(`Override applied. Remember "${columnName} → ${friendlyType}" for other columns?`, 'info', {
    label: 'Remember',
    onClick: () => {
      const rule = {
        columnName,
        typeId,
        created: new Date().toISOString(),
      };
      workbook.addOverrideRule(rule);
      const applied = applyRuleToMountedColumns(rule);
      toast(
        applied === 0
          ? `Rule remembered. Future columns named "${columnName}" will use this type.`
          : `Rule remembered. Applied to ${applied} other column${applied === 1 ? '' : 's'} named "${columnName}".`,
      );
    },
  });
}

/** Resolve a typeId to its display name across bundle + user types. */
function friendlyTypeName(typeId: string): string {
  const bundle = getTaxonomyClient().getBundle();
  const fromBundle = bundle?.types.find((t) => t.id === typeId)?.display_name;
  if (fromBundle) return fromBundle;
  const userType = getWorkbook()
    .get()
    .userTypes.find((t) => t.id === typeId);
  return userType?.display_name ?? typeId;
}

/**
 * Apply a single override rule to every mounted column with a matching
 * column-name, except columns the user has already curated themselves
 * (user_accept / user_override on THAT specific column). Returns the
 * count of assignments actually changed.
 */
function applyRuleToMountedColumns(rule: { columnName: string; typeId: string }): number {
  const workbook = getWorkbook();
  const assignments = workbook.get().assignments;
  let touched = 0;
  for (const [key, a] of Object.entries(assignments)) {
    if (a.columnName !== rule.columnName) continue;
    // Already pointed at the rule's typeId via prior user override → no-op.
    if (
      a.assigned.typeId === rule.typeId &&
      (a.assigned.origin === 'user_override' || a.assigned.origin === 'user_accept')
    ) {
      continue;
    }
    // Preserve user_accept on a different typeId — the user explicitly
    // accepted a different choice on this specific column; respect it.
    if (a.assigned.origin === 'user_accept' && a.assigned.typeId !== rule.typeId) continue;
    workbook.setAssignment(key, {
      ...a,
      assigned: {
        typeId: rule.typeId,
        origin: 'user_override',
        confidence: 1,
      },
    });
    touched++;
  }
  return touched;
}

function sqlExtra(): {
  assignmentsFor: (cellId: string) => ColumnAssignment[];
  onSendTo: (cellId: string, sinkId: string) => void;
} {
  return {
    assignmentsFor: (cellId) => {
      // Build a synthetic ColumnAssignment list from the cell's result columns.
      // We map each column to the global assignment if any table has a column
      // with that name; otherwise return a minimal stub.
      const nb = getNotebook(getEngine());
      const cell = nb.get().cells.find((c) => c.id === cellId);
      if (!cell || cell.kind !== 'sql' || !cell.lastResult) return [];
      const all = getWorkbook().get().assignments;
      const byName = new Map<string, ColumnAssignment>();
      for (const a of Object.values(all)) byName.set(a.columnName, a);
      return cell.lastResult.columns.map((c) => {
        const found = byName.get(c);
        if (found) return found;
        return {
          columnName: c,
          sqlType: 'VARCHAR',
          candidates: [],
          resolution: { kind: 'unknown' as const },
          assigned: { typeId: null, origin: 'unknown' as const, confidence: 0 },
          status: 'classified' as const,
        };
      });
    },
    onSendTo: (cellId, sinkId) => {
      void runSink(cellId, sinkId);
    },
  };
}

async function runSink(cellId: string, sinkId: string): Promise<void> {
  const sink = SINKS.find((s) => s.id === sinkId);
  if (!sink) {
    toast(`Unknown sink: ${sinkId}`, 'error');
    return;
  }
  const engine = getEngine();
  const nb = getNotebook(engine);
  const cell = nb.get().cells.find((c) => c.id === cellId);
  if (!cell || cell.kind !== 'sql' || !cell.lastResult) {
    toast('Run the cell first.');
    return;
  }
  const extras = sqlExtra();
  const assignments = extras.assignmentsFor(cellId);
  try {
    const outcome = await sink.execute({
      engine,
      cellId,
      cellName: cell.name,
      result: cell.lastResult,
      columnAssignments: assignments,
    });
    toast(outcome.message);
  } catch (err) {
    const msg = err instanceof SinkError || err instanceof Error ? err.message : String(err);
    toast(msg, 'error');
  }
}

function bulkAccept(threshold: number): void {
  const workbook = getWorkbook();
  const next = { ...workbook.get().assignments };
  let touched = 0;
  for (const [key, a] of Object.entries(next)) {
    if (
      a.assigned.typeId &&
      a.assigned.confidence >= threshold &&
      a.assigned.origin === 'detector'
    ) {
      next[key] = { ...a, assigned: { ...a.assigned, origin: 'user_accept' } };
      touched++;
    }
  }
  for (const [key, a] of Object.entries(next)) {
    workbook.setAssignment(key, a);
  }
  toast(`Accepted ${touched} column${touched === 1 ? '' : 's'} ≥ ${threshold.toFixed(2)}.`);
}

async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  type Picker = (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  if (typeof picker !== 'function') {
    toast('Folder mount needs Chrome / Edge / Opera 122+.', 'error');
    return null;
  }
  try {
    return await picker({ mode: 'read' });
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null;
    throw err;
  }
}

async function pickSingleFile(): Promise<File | null> {
  type WindowWithPicker = Window & {
    showOpenFilePicker?: (opts: {
      multiple: boolean;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle[]>;
  };
  const w = window as WindowWithPicker;
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Tabular data',
            accept: {
              'text/csv': ['.csv'],
              'text/tab-separated-values': ['.tsv'],
              'application/x-ndjson': ['.jsonl', '.ndjson'],
              'application/octet-stream': [
                '.parquet',
                '.pq',
                '.arrow',
                '.feather',
                '.duckdb',
                '.db',
                '.sqlite',
                '.sqlite3',
                '.sav',
                '.zsav',
                '.por',
                '.dta',
                '.sas7bdat',
                '.xpt',
              ],
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/geo+json': ['.geojson'],
              'application/vnd.google-earth.kml+xml': ['.kml'],
            },
          },
        ],
      });
      return handle ? await handle.getFile() : null;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
  }
  return await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      '.csv,.tsv,.jsonl,.ndjson,.parquet,.pq,.arrow,.feather,.duckdb,.db,.sqlite,.sqlite3,.xlsx,.sav,.zsav,.por,.dta,.sas7bdat,.xpt,.geojson,.kml';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

// ---- Sidecar wiring -------------------------------------------------
//
// Visibility of the per-cell "Explain this error" button is gated by
// `.app-sidecar-enabled` on the root element. The class is toggled in
// two places: (1) on boot inside `restoreFromActiveSession` based on
// the saved `sidecarEnabled` setting, and (2) inside the settings
// modal's change handler when the user flips the toggle.

/**
 * Build a compact schema hint string ("table.column[, …]") for the
 * sidecar to disambiguate typos + missing-table errors. Caps at 6
 * tables / 12 columns per table so we don't ship the whole workbook
 * over BYOK on every Explain click.
 */
/**
 * Walk a decoded lens `NakliDataFile` and return every remote-source
 * fetch target the engine will hit on auto-mount.
 *
 * Forward-pass H1 (2026-06-02): the boot path gates auto-mount on
 * confirmation when this returns a non-empty list. Local kinds
 * (example-bundle, fsa-folder) are explicitly omitted — their re-mount
 * is local-only and not part of the SSRF threat model.
 *
 * Hosts are extracted from the persisted URL fields:
 *   - `http`                      → ps.ref
 *   - `s3-endpoint`               → s3.endpoint (over HTTP/S to the S3 host)
 *   - `iceberg-table`             → iceberg.metadata_url
 *   - `iceberg-catalog`           → iceberg_catalog.catalog_url
 *   - `compute-bridge`            → bridge.bridge_url
 *   - `compute-bridge-catalog`    → bridge_catalog.bridge_url
 *
 * Bad URLs are surfaced as `host = '(unparseable URL)'` so the user
 * sees something — a malformed URL is itself a suspicious signal.
 */
function extractLensRemoteHosts(file: NakliDataFile): LensConfirmDescriptor[] {
  const out: LensConfirmDescriptor[] = [];
  const safeHost = (url: string): string => {
    try {
      return new URL(url).host || '(unparseable URL)';
    } catch {
      return '(unparseable URL)';
    }
  };
  for (const ps of file.sources) {
    if (ps.kind === 'http' && ps.ref) {
      out.push({ label: ps.label, host: safeHost(ps.ref), kind: 'Public URL' });
    } else if (ps.kind === 's3-endpoint' && ps.s3) {
      out.push({ label: ps.label, host: safeHost(ps.s3.endpoint), kind: 'S3 bucket' });
    } else if (ps.kind === 'iceberg-table' && ps.iceberg) {
      out.push({
        label: ps.label,
        host: safeHost(ps.iceberg.metadata_url),
        kind: 'Iceberg table',
      });
    } else if (ps.kind === 'iceberg-catalog' && ps.iceberg_catalog) {
      out.push({
        label: ps.label,
        host: safeHost(ps.iceberg_catalog.catalog_url),
        kind: 'Iceberg catalog',
      });
    } else if (ps.kind === 'compute-bridge' && ps.bridge) {
      out.push({
        label: ps.label,
        host: safeHost(ps.bridge.bridge_url),
        kind: 'Compute Bridge',
      });
    } else if (ps.kind === 'compute-bridge-catalog' && ps.bridge_catalog) {
      out.push({
        label: ps.label,
        host: safeHost(ps.bridge_catalog.bridge_url),
        kind: 'Compute Bridge catalog',
      });
    }
    // example-bundle + fsa-folder are local — intentionally not added.
  }
  return out;
}

/**
 * Walk a decoded lens `NakliDataFile` and return every executable
 * (SQL-bearing) cell so the confirm modal can surface the queries the
 * sender embedded (forward-pass H2). Only `sql` / `cohort` / `assertion`
 * cells carry SQL that runs on a Run click; a `markdown` cell's `code`
 * is prose, not a query, so it's excluded. Empty cells are skipped.
 */
function extractLensExecutableCells(file: NakliDataFile): LensConfirmCell[] {
  const out: LensConfirmCell[] = [];
  for (const c of file.cells) {
    if (c.kind === 'sql' || c.kind === 'cohort' || c.kind === 'assertion') {
      if (c.code.trim()) out.push({ name: c.name, kind: c.kind, code: c.code });
    }
  }
  return out;
}

function buildSchemaHint(): string {
  // Per-table column listing. Assignment keys are
  // `${sourceId}::${tableId}::${columnName}` (see schema-panel
  // `assignmentKey`); filter by the source+table prefix so each table's
  // hint only includes ITS columns. (Forward-pass M6, 2026-06-02: the
  // original walker filtered on `a.columnName && t.name`, which is
  // always true for any assigned column, so every table got the WHOLE
  // workbook's column list concatenated — duplicated noise that
  // degraded explain-error suggestions.)
  const wb = getWorkbook().get();
  const lines: string[] = [];
  let tables = 0;
  outer: for (const src of wb.sources) {
    for (const t of src.tables) {
      const prefix = `${src.id}::${t.id}::`;
      const cols = Object.entries(wb.assignments)
        .filter(([key, a]) => key.startsWith(prefix) && a.columnName)
        .map(([, a]) => a.columnName)
        .slice(0, 12);
      const tableLine =
        cols.length > 0 ? `${t.name}: ${cols.join(', ')}` : `${t.name}: (columns unmapped)`;
      lines.push(tableLine);
      tables++;
      if (tables >= 6) break outer;
    }
  }
  return lines.join('\n');
}

async function runExplainError(engine: Engine, cellId: string): Promise<void> {
  const nb = getNotebook(engine);
  const cell = nb.get().cells.find((c) => c.id === cellId);
  if (!cell || cell.kind !== 'sql' || !cell.lastError) {
    toast('Nothing to explain (cell has no error).');
    return;
  }
  const mount = document.querySelector<HTMLElement>(`[data-region="sidecar-result-${cellId}"]`);
  if (!mount) return;
  mount.innerHTML = '<div class="cell-sidecar-loading">Asking the sidecar…</div>';

  const settings = await loadSettings();
  try {
    const result = await dispatchJob(
      {
        kind: 'explain-error',
        sql: cell.code,
        errorMessage: cell.lastError,
        schemaHint: buildSchemaHint(),
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (result.kind !== 'explain-error') {
      throw new Error(`Unexpected sidecar response kind: ${result.kind}`);
    }
    const explanation = escapeText(result.explanation);
    const fix = result.suggestedFix
      ? `<pre class="cell-sidecar-suggested" data-suggested-sql="${escapeText(result.suggestedFix)}"><code>${escapeText(result.suggestedFix)}</code></pre>
         <button class="btn btn-ghost" data-action="copy-suggested-fix" data-cell-id="${cellId}">
           Copy SQL
         </button>`
      : '';
    mount.innerHTML = `
      <div class="cell-sidecar-explanation">${explanation}</div>
      ${fix}
      <div class="cell-sidecar-footnote">via ${escapeText(settings.sidecarProvider)} · ${escapeText(settings.sidecarModel)}</div>
    `;
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    mount.innerHTML = `<div class="cell-sidecar-error">Sidecar: ${escapeText(msg)}</div>`;
    if (err instanceof SidecarError && (err.kind === 'no-key' || err.kind === 'no-provider')) {
      // 'no-provider' covers the 'local' provider with no generator
      // loaded, AND the (defence-in-depth) unknown-provider case from
      // sidecar/client.ts. Forward-pass L3+L4 (2026-06-02).
      mount.innerHTML += `<button class="btn btn-ghost" data-action="open-settings">Open Settings</button>`;
    }
  }
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sidecar wave 5 W5.2 — Job 6: one-line result summary card.
 *
 * Triggered from the "Summarise" button under the result table on a
 * successfully-run SQL cell. Ships the columns + first 5 rows to the
 * sidecar; renders a single sentence (or nothing if the model bailed)
 * underneath the table.
 *
 * Privacy posture: only 5 sample rows are shipped, even if the cell
 * returned millions. Caller (this function) is responsible for the cap.
 */
async function runSummariseResult(engine: Engine, cellId: string): Promise<void> {
  const nb = getNotebook(engine);
  const cell = nb.get().cells.find((c) => c.id === cellId);
  if (!cell || (cell.kind !== 'sql' && cell.kind !== 'cohort' && cell.kind !== 'assertion')) {
    toast('Nothing to summarise (no SQL result on this cell).');
    return;
  }
  if (!cell.lastResult) {
    toast('Run the cell first — there is no result yet.');
    return;
  }
  const mount = document.querySelector<HTMLElement>(`[data-region="sidecar-result-${cellId}"]`);
  if (!mount) return;
  mount.innerHTML = '<div class="cell-sidecar-loading">Asking the sidecar…</div>';

  const settings = await loadSettings();
  const { columns, rows, rowCount } = cell.lastResult;
  const sampleRows = rows.slice(0, 5).map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      const v = row[col];
      out[col] =
        v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return out;
  });

  try {
    const result = await dispatchJob(
      {
        kind: 'summarise-result',
        sql: cell.code,
        columns,
        sampleRows,
        rowCount,
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (result.kind !== 'summarise-result') {
      throw new Error(`Unexpected sidecar response kind: ${result.kind}`);
    }
    if (!result.observation) {
      mount.innerHTML = `<div class="cell-sidecar-explanation" style="font-style:italic;color:var(--text-muted)">The sidecar didn't have anything useful to add about this result.</div>`;
      return;
    }
    mount.innerHTML = `
      <div class="cell-sidecar-explanation">${escapeText(result.observation)}</div>
      <div class="cell-sidecar-footnote">via ${escapeText(settings.sidecarProvider)} · ${escapeText(settings.sidecarModel)}</div>
    `;
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    mount.innerHTML = `<div class="cell-sidecar-error">Sidecar: ${escapeText(msg)}</div>`;
    if (err instanceof SidecarError && (err.kind === 'no-key' || err.kind === 'no-provider')) {
      mount.innerHTML += `<button class="btn btn-ghost" data-action="open-settings">Open Settings</button>`;
    }
  }
}

/**
 * Sidecar v1.2 M4 — Job 7: propose-chart.
 *
 * Triggered from the "Suggest chart" button under the result table on
 * a successfully-run SQL cell. Ships columns + first 10 rows to the
 * sidecar (structured-config-only contract). On a valid proposal,
 * inserts a chart cell wired to this SQL cell's view via the existing
 * `@name` reference plumbing. On a null proposal (the model returned
 * something unparseable or hallucinated), toasts a fallback message
 * suggesting manual chart-cell-add.
 *
 * Per handoff §10 Hard NOT #6: the sidecar response is **structured
 * config only — no prose narration**. The parser enforces this; the
 * user never sees model-authored prose about their data.
 */
async function runProposeChart(engine: Engine, cellId: string): Promise<void> {
  const nb = getNotebook(engine);
  const cell = nb.get().cells.find((c) => c.id === cellId);
  if (!cell || (cell.kind !== 'sql' && cell.kind !== 'cohort' && cell.kind !== 'assertion')) {
    toast('Nothing to chart (no SQL result on this cell).');
    return;
  }
  if (!cell.lastResult) {
    toast('Run the cell first — there is no result yet.');
    return;
  }
  toast('Asking the sidecar to propose a chart…');
  const settings = await loadSettings();
  const { columns, rows, rowCount } = cell.lastResult;
  // Pull column types from the result rows. Without a schema query
  // we infer from the first non-null sample.
  const columnSpecs = columns.map((c) => ({
    name: c,
    sqlType: inferTypeFromRows(rows, c),
  }));
  const sampleRows = rows.slice(0, 10).map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      const v = row[col];
      out[col] =
        v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return out;
  });

  try {
    const result = await dispatchJob(
      {
        kind: 'propose-chart',
        sql: cell.code,
        columns: columnSpecs,
        sampleRows,
        rowCount,
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (result.kind !== 'propose-chart') {
      throw new Error(`Unexpected sidecar response kind: ${result.kind}`);
    }
    if (!result.proposal) {
      toast("Couldn't propose a chart — try inserting one manually via the cell-add row.", 'error');
      return;
    }
    // Materialise the proposal as a new chart cell wired to this SQL
    // cell's view. The Notebook.addCell helper creates an empty cell
    // at the end; patch its fields after.
    const newCell = nb.addCell('chart');
    nb.patchCell(newCell.id, {
      inputCell: cellId,
      chartType: result.proposal.chartType,
      x: result.proposal.xColumn,
      y: result.proposal.yColumn,
      facet: result.proposal.groupColumn,
      name: result.proposal.title.slice(0, 40),
    });
    toast(`Chart cell added: ${result.proposal.title}`);
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    toast(`Sidecar: ${msg}`, 'error');
  }
}

/** Cheap type inference from the first non-null sample. Best-effort. */
function inferTypeFromRows(rows: Array<Record<string, unknown>>, col: string): string {
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') return Number.isInteger(v) ? 'BIGINT' : 'DOUBLE';
    if (typeof v === 'boolean') return 'BOOLEAN';
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'DATE';
      return 'VARCHAR';
    }
    return 'VARCHAR';
  }
  return 'VARCHAR';
}

/**
 * Sidecar wave 5 W5.1 — Job 5: NL → SQL.
 *
 * Opens the nl-to-sql modal pre-populated with the workbook's table +
 * column names (no row data — privacy posture). On accept, inserts a
 * new SQL cell with the generated body at the end of the notebook;
 * the user clicks Run themselves (Hard NOT #4 — never auto-execute).
 */
function openNlToSqlSidecar(engine: Engine): void {
  const wb = getWorkbook().get();
  const tables: Array<{ name: string; columns: string[] }> = [];
  for (const s of wb.sources) {
    for (const t of s.tables) {
      // Collect column names by walking assignments — the engine schema
      // is authoritative but assignments map covers every mounted col.
      const columns: string[] = [];
      for (const [key, a] of Object.entries(wb.assignments)) {
        const [, tId] = key.split('::');
        if (tId === t.id) columns.push(a.columnName);
      }
      tables.push({ name: t.name, columns });
    }
  }
  openNlToSqlModal({
    tables,
    onInsert: (sql) => {
      const nb = getNotebook(engine);
      const existing = nb.get().cells;
      const newCell: SqlCellState = {
        id: `c_${Date.now().toString(36)}_${existing.length}`,
        kind: 'sql',
        order: existing.length,
        name: null,
        code: sql,
        status: 'idle',
        lastError: null,
        lastResult: null,
        pinned: false,
      };
      nb.load([...existing, newCell]);
      toast('SQL cell inserted — review then click Run.');
    },
  });
}

/**
 * Sidecar wave 2 — Job 1: type disambiguation.
 *
 * Triggered by the schema-panel "Ask sidecar" button on ambiguous
 * columns (confidence ∈ [0.5, 0.9), ≥2 candidates, origin='detector').
 * Re-samples the column from the engine, dispatches, applies the
 * chosen typeId as a user_override. `null` response → toast and
 * leave the assignment as-is.
 */
/**
 * Toggle the column-profile panel for one column. Presence in the
 * `_columnProfiles` map === expanded; absence === collapsed. Re-renders
 * the schema panel so the inline panel HTML reflects the new state.
 *
 * If we're expanding for the first time, fetches the profile via
 * `engine.profileColumn`. Fetched profiles stay cached for the
 * session — subsequent collapse/expand cycles don't re-fetch (the
 * cache is invalidated when the user toggles off + on again only if
 * we explicitly clear; current behavior is to keep the cache for the
 * tab's lifetime since stats are stable per mount).
 */
async function runShowProfile(
  engine: Engine,
  sourceId: string,
  tableId: string,
  columnName: string,
): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  const key = assignmentKey(sourceId, tableId, columnName);
  // Collapsing: remove from cache + re-render.
  if (_columnProfiles.has(key)) {
    _columnProfiles.delete(key);
    renderSchemaPanelWithCurrentState(root, getWorkbook().get(), engine);
    return;
  }
  // Expanding: find the table, fetch the profile, cache, re-render.
  // Toast confirms the click while the engine works — keeps the cache
  // truthful (present === ready data) without a sentinel "loading"
  // value and the conditional-render that would need on the panel side.
  const wb = getWorkbook().get();
  const table = wb.sources.find((s) => s.id === sourceId)?.tables.find((t) => t.id === tableId);
  if (!table) {
    toast('Table not found for that column.', 'error');
    return;
  }
  toast(`Profiling ${columnName}…`);
  try {
    const profile = await engine.profileColumn(table.name, columnName);
    _columnProfiles.set(key, profile);
    renderSchemaPanelWithCurrentState(root, getWorkbook().get(), engine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`Profile failed for ${columnName}: ${msg}`, 'error');
  }
}

async function runDisambiguateType(
  engine: Engine,
  buttonEl: HTMLElement | null,
  sourceId: string,
  tableId: string,
  columnName: string,
): Promise<void> {
  const wb = getWorkbook().get();
  const source = wb.sources.find((s) => s.id === sourceId);
  const table = source?.tables.find((t) => t.id === tableId);
  if (!source || !table) {
    toast('Source/table not found.', 'error');
    return;
  }
  const key = assignmentKey(sourceId, tableId, columnName);
  const a = wb.assignments[key];
  if (!a) {
    toast('Column not found.', 'error');
    return;
  }
  if (buttonEl instanceof HTMLButtonElement) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Asking…';
  }
  try {
    const stats = await engine.sampleColumn(table.name, columnName);
    const settings = await loadSettings();
    const response = await dispatchJob(
      {
        kind: 'disambiguate-type',
        columnName,
        sqlType: a.sqlType,
        samples: stats.values.slice(0, 20),
        candidates: a.candidates.map((c) => ({
          typeId: c.typeId,
          displayName: c.displayName,
        })),
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (response.kind !== 'disambiguate-type') return;
    if (response.typeId === null) {
      toast(`Sidecar wasn't confident on ${columnName} — leave as-is or override manually.`);
    } else {
      overrideAssignment(sourceId, tableId, columnName, response.typeId);
      const candidate = a.candidates.find((c) => c.typeId === response.typeId);
      toast(`Sidecar picked ${candidate?.displayName ?? response.typeId} for ${columnName}.`);
    }
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    toast(`Sidecar: ${msg}`, 'error');
    // Restore the button state on error since no workbook update will
    // re-render this row.
    if (buttonEl instanceof HTMLButtonElement) {
      buttonEl.disabled = false;
      buttonEl.textContent = 'Ask sidecar';
    }
  }
}

// ---- Toast ----------------------------------------------------------

let toastTimer: number | null = null;
/**
 * Render a transient toast. With `action`, the toast grows a button + the
 * dismiss timeout extends so users have time to read and click. Action
 * clicks dismiss the toast eagerly. Theme 4 wave 2 added the action
 * parameter for the "Remember rule" affordance after Override.
 */
function toast(
  message: string,
  kind: 'info' | 'error' = 'info',
  action?: { label: string; onClick: () => void },
): void {
  let el = document.getElementById('naklidata-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'naklidata-toast';
    el.style.cssText =
      'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:#1F1B16;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:9999;max-width:520px;display:flex;gap:12px;align-items:center;';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.style.background = kind === 'error' ? '#A8453F' : '#1F1B16';
  // Rebuild children so a previous action button doesn't leak.
  el.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.dataset.action = 'toast-action';
    btn.style.cssText =
      'background:transparent;color:#FFB066;border:1px solid #FFB066;border-radius:4px;padding:4px 10px;font:inherit;cursor:pointer;';
    btn.addEventListener('click', () => {
      // Dismiss eagerly so the user gets immediate feedback before the
      // follow-up toast (if any) replaces the content.
      if (el) el.style.opacity = '0';
      action.onClick();
    });
    el.appendChild(btn);
  }
  el.style.opacity = '1';
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => {
      if (el) el.style.opacity = '0';
    },
    action ? 8000 : 3200,
  );
}

// Register the service worker (PWA + offline shell). Skipped in DEV
// because esbuild watch mode + SW caching is a recipe for stale assets.
// process.env.NODE_ENV is replaced at build time by esbuild.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[naklidata] SW registration failed', err);
    });
  });
}

boot().catch((err) => {
  console.error('[naklidata] boot failed', err);
});
