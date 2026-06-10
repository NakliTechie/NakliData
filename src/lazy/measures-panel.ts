// v1.3 M2 — Lazy chunk for the measures panel.
//
// The pure logic (`src/core/measures.ts`, `src/core/measures-store.ts`)
// stays in the main bundle because Notebook.runCell calls expandMeasures
// on every cell run. The PANEL UI lazy-loads — most sessions never
// open it.

export { openMeasuresPanel, closeMeasuresPanel } from '../ui/measures-panel.ts';
export type { MeasuresPanelDescriptor } from '../ui/measures-panel.ts';
