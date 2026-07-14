// Lazy chunk — the report-template definitions (ALL_TEMPLATES) and the pure
// matching helpers. Only the "Suggested reports" panel consumes them, and only
// when it renders/instantiates, so the whole module (all templates + their SQL
// generators) stays off the inlined shell budget (spec §7.1 / A35). The panel
// (templates-panel.ts) keeps type-only imports from templates.ts — those are
// erased — and loads this chunk for the runtime values.
export {
  ALL_TEMPLATES,
  findApplicableTemplates,
  indexByTypeWithCandidates,
  // A3 — executive report-cell templates (briefing memo / operating review /
  // dataset audit). Bodies stay off-shell; the report cell's picker holds only
  // the id/name.
  buildExecutiveReport,
} from '../ui/templates/templates.ts';
export type { ExecutiveReportScaffold } from '../ui/templates/templates.ts';
// A1/A2 — the "Create report from result" builder + KPI-measure helpers. Only
// the create-report + report-refresh handlers consume them, so they ride this
// lazy chunk too (keeps the shell ≤ 768 KB — A35).
export { buildReportScaffold } from '../core/report-from-result.ts';
export type { ReportScaffold } from '../core/report-from-result.ts';
export {
  buildKpiTiles,
  computeKpiValues,
  deriveResultMeasures,
  recomputeKpiTiles,
  sanitizeMeasureBase,
} from '../core/report-measures.ts';
