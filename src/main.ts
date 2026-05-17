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
import {
  type NakliDataFile,
  loadFromFile,
  loadWorkbookSnapshot,
  saveToFile,
  saveWorkbookSnapshot,
  serialize,
} from './core/persistence.ts';
import { type Settings, loadSettings, saveSettings } from './core/settings.ts';
import { getWorkbook } from './core/workbook.ts';
import { classifyTableColumns, getTaxonomyClient } from './taxonomy/client.ts';
import type { ClassificationResult } from './taxonomy/types.ts';
import { getNotebook, renderNotebook } from './ui/notebook.ts';
import { type ColumnAssignment, assignmentKey, renderSchemaPanel } from './ui/schema-panel.ts';
import {
  type ShellState,
  mountShell,
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
    renderSchemaPanel(
      root,
      {
        sources: wb.sources,
        assignments: wb.assignments,
        bundle: getTaxonomyClient().getBundle(),
        autoAcceptThreshold: wb.autoAcceptThreshold,
      },
      {
        onAccept: (sId, tId, col) => acceptAssignment(sId, tId, col),
        onOverride: (sId, tId, col, typeId) => overrideAssignment(sId, tId, col, typeId),
        onBulkAccept: (threshold) => bulkAccept(threshold),
        onChangeThreshold: (v) => workbook.setAutoAcceptThreshold(v),
      },
    );
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

  // Engine is ready. Restore prior session from IDB (settings + workbook
  // snapshot) before installing auto-save subscribers — otherwise the
  // restore would race against an empty-state save.
  await restoreFromIdb(engine);
  installAutoSave(engine);
}

/**
 * Boot-time IDB restore. Reads settings + the last workbook snapshot;
 * applies them. Failures are logged and otherwise silent — fresh users
 * have nothing to restore and that's normal.
 */
async function restoreFromIdb(engine: Engine): Promise<void> {
  // 1. Settings (small; just the threshold for now).
  try {
    const settings = await loadSettings();
    getWorkbook().setAutoAcceptThreshold(settings.autoAcceptThreshold);
  } catch (err) {
    console.warn('[naklidata] settings load failed', err);
  }
  // 2. Workbook snapshot.
  try {
    const snapshot = await loadWorkbookSnapshot();
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
 * Every state change resets a 300ms timer; the timer fires
 * saveWorkbookSnapshot + saveSettings against the current state.
 *
 * Must be called AFTER restoreFromIdb finishes so we don't race the
 * restore with an empty-state save.
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
  // Skip the no-state case — clear the snapshot instead so a fresh boot
  // doesn't find a stale "empty" record.
  if (wb.sources.length === 0 && nb.get().cells.length === 0) return;
  try {
    await saveWorkbookSnapshot({
      notebookName: 'Untitled',
      sources: wb.sources,
      assignments: wb.assignments,
      cells: nb.get().cells,
      autoAcceptThreshold: wb.autoAcceptThreshold,
    });
  } catch (err) {
    console.warn('[naklidata] snapshot save failed', err);
  }
  // Persist settings on the same beat — autoAcceptThreshold lives in
  // both the workbook (in-memory + snapshot) and Settings (cross-session
  // default for fresh sessions).
  try {
    const settings: Settings = {
      autoAcceptThreshold: wb.autoAcceptThreshold,
      sidecarEnabled: false, // v1.1 placeholder; settings UI lands later
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
      '.csv,.tsv,.jsonl,.ndjson,.parquet,.pq,.duckdb,.db,.sqlite,.sqlite3,.xlsx,.sav,.zsav,.por,.dta,.sas7bdat,.xpt';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

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

boot().catch((err) => {
  console.error('[naklidata] boot failed', err);
});
