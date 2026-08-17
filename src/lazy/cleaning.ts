// Cleaning surface — lazy chunk (C3 prerequisite).
//
// The fix registry's detectors + SQL emitters are the bulk of the cleaning code
// and they are only needed at CLASSIFICATION time, which is already async — so
// they ride a lazy chunk instead of the inlined shell. What stays in the shell
// is `core/cleaning/fix-cache.ts` (a Map and three functions), because the
// schema panel renders from it synchronously on every re-render.
//
// Re-exported rather than moved so the registry keeps its own module identity,
// its tests import it directly, and the engine-boundary check still watches it.

export {
  type ColumnFacts,
  type FixPreviewRow,
  type SuggestedFix,
  type SuggestedTableFix,
  type TableFixFacts,
  knownFixIds,
  suggestFixes,
  suggestTableFixes,
} from '../core/cleaning/fix-registry.ts';
