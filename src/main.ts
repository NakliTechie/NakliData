import { getEngine } from './core/engine.ts';
import { MountError, mountExampleBundle, mountFile } from './core/mount.ts';
import { getWorkbook } from './core/workbook.ts';
import {
  type ShellState,
  mountShell,
  renderSourcesList,
  setHasMounts,
  updateEngineStatus,
} from './ui/shell.ts';

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
      <h1 style="font-size: 22px;">naklios isn't supported here yet</h1>
      <p style="color: #6B6358;">
        ${
          reason === 'safari'
            ? 'naklios uses File System Access and OPFS APIs that Safari does not yet implement. Try Chrome, Edge, or Opera 122+.'
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
  });

  const offline = new URLSearchParams(location.search).has('offline');
  try {
    await engine.boot({ offline });
  } catch (err) {
    console.error('[naklios] engine boot failed', err);
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
    void handleAction(action, actionEl);
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'k') {
      ev.preventDefault();
      void handleAction('spotlight', null);
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
      } catch (err) {
        const msg = err instanceof MountError || err instanceof Error ? err.message : String(err);
        toast(`Mount failed: ${msg}`, 'error');
      }
      return;
    }
    case 'remove-source': {
      const id = el?.dataset.sourceId;
      if (!id) return;
      // Drop the views, then forget the source.
      const src = workbook.get().sources.find((s) => s.id === id);
      if (src) {
        for (const t of src.tables) {
          try {
            await engine.drop(t.name);
          } catch (err) {
            console.warn(`[naklios] drop view failed for ${t.name}`, err);
          }
        }
      }
      workbook.removeSource(id);
      return;
    }
    case 'mount-folder':
    case 'mount-url':
    case 'add-source':
    case 'spotlight':
    case 'save':
      console.info(`[naklios] action requested: ${action} (not yet wired)`);
      toast(`${action} is not wired yet.`);
      return;
    default:
      console.warn(`[naklios] unknown action: ${action}`);
  }
}

async function pickSingleFile(): Promise<File | null> {
  // Prefer FSA showOpenFilePicker for the durable handle path. Fall back to
  // <input type="file"> in browsers without FSA (Firefox).
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
              'application/octet-stream': ['.parquet', '.pq'],
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
    input.accept = '.csv,.tsv,.jsonl,.ndjson,.parquet,.pq';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

let toastTimer: number | null = null;
function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('naklios-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'naklios-toast';
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
  console.error('[naklios] boot failed', err);
});
