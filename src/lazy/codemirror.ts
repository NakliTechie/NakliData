// CodeMirror 6 SQL editor — lazy chunk. Loaded on demand the first
// time a SQL cell is rendered, then cached. Decisions log 2026-05-15
// 14:10 deferred CM6 from v1.0 with the explicit intent to bring it
// back as a lazy chunk before the v1.0 tag. This is that.
//
// The shell stays under 600 KB; the ~250 KB of CodeMirror only loads
// when a user opens a SQL cell.

import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { r as rMode } from '@codemirror/legacy-modes/mode/r';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

/** Language modes the plain code editor can highlight. */
export type CodeLanguage = 'python' | 'r';

// R has no official CM6 Lezer package; the legacy CM5 mode (via StreamLanguage)
// is the standard route and gives solid token highlighting. Defined once.
const rLanguage = StreamLanguage.define(rMode);

function languageExtension(lang: CodeLanguage | undefined): Extension | null {
  if (lang === 'python') return python();
  if (lang === 'r') return rLanguage;
  return null;
}

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
        syntaxHighlighting(defaultHighlightStyle),
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
   * Syntax-highlighting language. Resolved to a CM extension inside this lazy
   * chunk so the `lang-*` packages never touch the shell bundle. Omit for a plain
   * editor — still gets line numbers, undo/redo, tab-indent, and Mod-Enter run.
   */
  language?: CodeLanguage;
}

/**
 * A language-aware CodeMirror editor — the same shell as `mountSqlEditor` but
 * with a caller-named (or no) language and no SQL autocompletion. Backs the
 * Python/R cells' editor (via `code-editor-host`), replacing the plain textarea.
 * Returns the same handle type so the host machinery is shared.
 */
export function mountCodeEditor(host: HTMLElement, opts: MountCodeEditorOptions): MountedSqlEditor {
  const langExt = languageExtension(opts.language);
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        ...(langExt ? [langExt] : []),
        syntaxHighlighting(defaultHighlightStyle),
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
