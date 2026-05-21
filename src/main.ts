import { type Engine, getEngine } from './core/engine.ts';
import { ensureReadPermission, getHandle, queryReadPermissionQuiet } from './core/handles.ts';
import {
  MountError,
  type MountedSource,
  mountExampleBundle,
  mountFile,
  mountFolder,
  remountFolderFromHandle,
} from './core/mount.ts';
import { type NakliDataFile, loadFromFile, saveToFile, serialize } from './core/persistence.ts';
import {
  type SessionMeta,
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
import {
  buildShareUrl,
  clearLensFromLocation,
  decodeLensParam,
  readLensFromLocation,
} from './core/url-state.ts';
import { getWorkbook } from './core/workbook.ts';
import { classifyTableColumns, getTaxonomyClient } from './taxonomy/client.ts';
import type { ClassificationResult } from './taxonomy/types.ts';
import { openDefineTypeModal } from './ui/define-type-modal.ts';
import { getNotebook, renderNotebook } from './ui/notebook.ts';
import { openSchemaGraph } from './ui/schema-graph.ts';
import { type ColumnAssignment, assignmentKey, renderSchemaPanel } from './ui/schema-panel.ts';
import { openSettingsModal } from './ui/settings-modal.ts';
import {
  type ShellState,
  mountShell,
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

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Root #app missing');

  const sup = detectSupport();
  if (!sup.supported) {
    bootUnsupported(sup.reason ?? 'unknown');
    return;
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

  const workbook = getWorkbook();
  workbook.subscribe((wb) => {
    renderSourcesList(root, wb.sources);
    setHasMounts(root, wb.sources.length > 0);
    renderSchemaPanelWithCurrentState(root, wb, engine);
    renderTemplatePanel(
      root,
      { sources: wb.sources, assignments: wb.assignments },
      {
        onInstantiate: (cells, templateId) => {
          const nb = getNotebook(engine);
          nb.load([...nb.get().cells, ...cells]);
          toast(`Instantiated "${templateId}" — ${cells.length} cells added.`);
        },
      },
    );
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

  const offline = new URLSearchParams(location.search).has('offline');
  try {
    await engine.boot({ offline });
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
  if (lensParam) {
    try {
      const file = await decodeLensParam(lensParam);
      await applyLoadedFile(engine, file);
      clearLensFromLocation();
      toast(`Loaded shared notebook "${file.name}".`);
    } catch (err) {
      console.warn('[naklidata] lens param decode failed', err);
      toast('Shared link is invalid or corrupted — using saved state instead.', 'error');
      await restoreFromActiveSession(engine);
    }
  } else {
    await restoreFromActiveSession(engine);
  }
  installAutoSave(engine);
  installUserTypesSync();
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
    },
    {
      onAccept: (sId, tId, col) => acceptAssignment(sId, tId, col),
      onOverride: (sId, tId, col, typeId) => overrideAssignment(sId, tId, col, typeId),
      onBulkAccept: (threshold) => bulkAccept(threshold),
      onChangeThreshold: (v) => getWorkbook().setAutoAcceptThreshold(v),
      onReclassify: () => {
        void reclassifyAllSources(engine);
      },
    },
  );
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
    case 'mount-url':
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

async function applyLoadedFile(
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
          workbook.setAssignment(key, resultToAssignment(r));
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
            workbook.setAssignment(key, fresh);
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
function buildSchemaHint(): string {
  const wb = getWorkbook().get();
  const lines: string[] = [];
  let tables = 0;
  outer: for (const src of wb.sources) {
    for (const t of src.tables) {
      const cols = Object.values(wb.assignments)
        .filter((a) => a.columnName && t.name)
        .map((a) => a.columnName)
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
    if (err instanceof SidecarError && err.kind === 'no-key') {
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
function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('naklidata-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'naklidata-toast';
    el.style.cssText =
      'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:#1F1B16;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:9999;max-width:520px;';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.style.background = kind === 'error' ? '#A8453F' : '#1F1B16';
  el.textContent = message;
  el.style.opacity = '1';
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (el) el.style.opacity = '0';
  }, 3200);
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
