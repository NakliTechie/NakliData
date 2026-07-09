// Shared CodeMirror editor host for the Python / R language cells. Mirrors the
// SQL cell's proven editor lifecycle (registry + pending-mount race guard +
// textarea fallback + reuse-across-render + dispose) so the language cells get a
// real editor — line numbers, undo/redo, tab-indent, Mod-Enter run — instead of
// a plain textarea, while INHERITING the C1/L8-class fixes rather than risking
// new ones. CodeMirror lives in a lazy chunk, so this adds nothing to the shell
// bundle. Kept separate from sql-cell.ts (which stays byte-identical) so the
// most-used surface carries zero regression risk from this change.

import { loadChunk } from '../../core/lazy-loader.ts';
import type { MountedSqlEditor } from '../../lazy/codemirror.ts';

/** Live CM6 instances, keyed by cell id — reattached across notebook re-renders. */
const instances = new Map<string, MountedSqlEditor>();
/** Cells whose CM chunk load is in flight; the flag lets dispose cancel it. */
const pending = new Map<string, { cancelled: boolean }>();
let codemirrorReady = false;

export interface EditorHostOptions {
  cellId: string;
  /** The element the editor (or fallback textarea) mounts into. */
  host: HTMLElement;
  initialDoc: string;
  /** Fired on every doc change — the caller persists it (silently). */
  onChange: (doc: string) => void;
  /** Cmd/Ctrl+Enter — the caller triggers the cell's run. */
  onRun: (doc: string) => void;
}

/** Dispose a cell's editor + cancel any in-flight mount. Call on delete + load. */
export function disposeCodeEditorHost(cellId: string): void {
  const inst = instances.get(cellId);
  if (inst) {
    inst.dispose();
    instances.delete(cellId);
  }
  const p = pending.get(cellId);
  if (p) {
    p.cancelled = true;
    pending.delete(cellId);
  }
}

/**
 * Mount (or reattach) the editor into `opts.host`. Reuses an existing CM6
 * instance across re-renders; on first render before the chunk has loaded, shows
 * a textarea immediately and swaps to CM6 when the chunk arrives (staying with
 * the textarea if the load fails — offline / blocked).
 */
export function mountCodeEditorHost(opts: EditorHostOptions): void {
  const { cellId, host, initialDoc } = opts;

  const existing = instances.get(cellId);
  if (existing) {
    host.append(existing.domNode());
    if (existing.getDoc() !== initialDoc) existing.setDoc(initialDoc);
    return;
  }
  if (codemirrorReady) {
    void mountCm(opts);
    return;
  }

  // First render before CM6 is loaded: textarea now, swap when the chunk lands.
  const ta = makeTextarea(opts);
  host.append(ta);
  const prev = pending.get(cellId);
  if (prev) prev.cancelled = true;
  const token = { cancelled: false };
  pending.set(cellId, token);
  void loadChunk('codemirror')
    .then(() => {
      codemirrorReady = true;
      if (pending.get(cellId) === token) pending.delete(cellId);
      if (token.cancelled) return;
      if (host.isConnected && host.contains(ta)) {
        ta.remove();
        void mountCm(opts);
      }
    })
    .catch((err) => {
      if (pending.get(cellId) === token) pending.delete(cellId);
      console.warn('[code-editor-host] CodeMirror chunk load failed; staying with textarea', err);
    });
}

async function mountCm(opts: EditorHostOptions): Promise<void> {
  const chunk = await loadChunk('codemirror');
  // A late dispose (cell removed during this await) must not leave an orphan.
  if (!opts.host.isConnected) return;
  const editor = chunk.mountCodeEditor(opts.host, {
    initialDoc: opts.initialDoc,
    onChange: opts.onChange,
    onRun: opts.onRun,
  });
  instances.set(opts.cellId, editor);
}

/** Fallback plain-textarea editor (offline / pre-chunk). Same UX contract. */
function makeTextarea(opts: EditorHostOptions): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.className = 'python-code';
  ta.spellcheck = false;
  ta.value = opts.initialDoc;
  // Live sync (not blur) so Run always sees the current code even in fallback.
  ta.addEventListener('input', () => opts.onChange(ta.value));
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const s = ta.selectionStart;
      ta.value = `${ta.value.slice(0, s)}  ${ta.value.slice(ta.selectionEnd)}`;
      ta.selectionStart = ta.selectionEnd = s + 2;
      opts.onChange(ta.value);
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      opts.onRun(ta.value);
    }
  });
  return ta;
}
