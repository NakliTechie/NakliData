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
} from '../ui/templates/templates.ts';
