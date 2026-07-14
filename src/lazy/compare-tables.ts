// Lazy chunk — the "Compare tables" modal. It's opened on demand from the
// schema panel's compare action and is otherwise idle, so its ~10 KB (the
// modal render + join-key inference) ships off the inlined shell budget
// (spec §7.1 / A35). Self-contained: it takes sources/assignments/engine as
// input and writes to no store singleton, so it's safe to split (unlike the
// measures panel — see lazy-loader.ts).
export { closeCompareTablesModal, openCompareTablesModal } from '../ui/compare-tables-modal.ts';
