export const notebookCss = `
.notebook {
  max-width: 920px;
  margin: 0 auto;
  padding: 24px 32px 64px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.notebook-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.cell {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.cell.running { box-shadow: 0 0 0 1px var(--warning); }
.cell.errored { box-shadow: 0 0 0 1px var(--danger); }
.cell-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--surface-alt);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}
.cell-head .cell-kind {
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text);
  font-size: 10px;
}
.cell-head .cell-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
}
.cell-head .cell-actions { margin-left: auto; display: flex; gap: 4px; }
.cell-head .cell-actions .btn {
  padding: 2px 8px;
  font-size: 11px;
}
.cell-editor {
  font-family: var(--font-mono);
  font-size: 13px;
}
.cell-editor .cm-editor { background: transparent; }
.cell-editor .cm-focused { outline: none; }
.cell-editor .cm-scroller { font-family: var(--font-mono); }
.cell-editor .cm-content { padding: 12px; }
.cell-editor textarea {
  width: 100%;
  border: 0;
  padding: 12px;
  font: 13px/1.5 var(--font-mono);
  background: transparent;
  resize: vertical;
  min-height: 88px;
  outline: none;
}
.cell-output {
  border-top: 1px solid var(--border);
  background: var(--bg);
  max-height: 360px;
  overflow: auto;
}
.cell-output-empty {
  padding: 12px;
  color: var(--text-muted);
  font-size: 12px;
}
.cell-output-error {
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--danger);
  background: #FDECE3;
  white-space: pre-wrap;
}
.result-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}
.result-table th, .result-table td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}
.result-table th {
  background: var(--surface-alt);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  position: sticky;
  top: 0;
}
.result-table td.numeric { text-align: right; }
.cell-result-meta {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  gap: 12px;
}
.cell-add-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  padding: 8px 0 24px;
}
.markdown-preview {
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.55;
}
.markdown-preview h1, .markdown-preview h2, .markdown-preview h3 {
  margin: 12px 0 8px;
  font-weight: 600;
}
.markdown-preview h1 { font-size: 20px; }
.markdown-preview h2 { font-size: 17px; }
.markdown-preview h3 { font-size: 15px; }
.markdown-preview p { margin: 8px 0; }
.markdown-preview code {
  font-family: var(--font-mono);
  background: var(--surface-alt);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.markdown-preview ul, .markdown-preview ol { padding-left: 22px; }
`;
