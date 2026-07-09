// CodeMirror 6 SQL editor — lazy chunk. Loaded on demand the first
// time a SQL cell is rendered, then cached. Decisions log 2026-05-15
// 14:10 deferred CM6 from v1.0 with the explicit intent to bring it
// back as a lazy chunk before the v1.0 tag. This is that.
//
// The shell stays under 600 KB; the ~250 KB of CodeMirror only loads
// when a user opens a SQL cell.

import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql } from '@codemirror/lang-sql';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

export interface MountSqlEditorOptions {
  initialDoc: string;
  /** Fired on every doc change. */
  onChange: (doc: string) => void;
  /** Cmd/Ctrl+Enter handler. */
  onRun: (doc: string) => void;
}

export interface MountedSqlEditor {
  getDoc(): string;
  setDoc(doc: string): void;
  focus(): void;
  dispose(): void;
  /** Detach the underlying CM6 DOM from its current parent without
   *  destroying the EditorView — used to preserve editor state across
   *  notebook re-renders. */
  domNode(): HTMLElement;
}

export function mountSqlEditor(host: HTMLElement, opts: MountSqlEditorOptions): MountedSqlEditor {
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        sql(),
        autocompletion(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          {
            key: 'Mod-Enter',
            run: () => {
              opts.onRun(view.state.doc.toString());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
    parent: host,
  });

  return {
    getDoc: () => view.state.doc.toString(),
    setDoc: (doc: string) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    },
    focus: () => view.focus(),
    dispose: () => view.destroy(),
    domNode: () => view.dom,
  };
}

export interface MountCodeEditorOptions {
  initialDoc: string;
  onChange: (doc: string) => void;
  onRun: (doc: string) => void;
  /**
   * Optional language extension (e.g. from a `@codemirror/lang-*` package). Omit
   * for a plain editor — still gets line numbers, undo/redo, tab-indent, and the
   * Mod-Enter run key, just no syntax colouring. The Python/R language cells use
   * this without a language pack (none is bundled); adding one later is a drop-in.
   */
  language?: Extension;
}

/**
 * A language-agnostic CodeMirror editor — the same shell as `mountSqlEditor` but
 * with a caller-supplied (or no) language extension and no SQL autocompletion.
 * Backs the Python/R cells' editor (via `code-editor-host`), replacing the plain
 * textarea. Returns the same handle type so the host machinery is shared.
 */
export function mountCodeEditor(host: HTMLElement, opts: MountCodeEditorOptions): MountedSqlEditor {
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        ...(opts.language ? [opts.language] : []),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          {
            key: 'Mod-Enter',
            run: () => {
              opts.onRun(view.state.doc.toString());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
    parent: host,
  });

  return {
    getDoc: () => view.state.doc.toString(),
    setDoc: (doc: string) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    },
    focus: () => view.focus(),
    dispose: () => view.destroy(),
    domNode: () => view.dom,
  };
}
