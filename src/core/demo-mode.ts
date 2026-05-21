// Demo / censor mode helper. Theme 4 wave 2 (B4). When enabled
// (settings.demoMode === true), user-data labels routed through
// `maskLabel(kind, original)` are replaced with stable, prefixed tokens
// (`src_1`, `tbl_2`, `col_3`, …). The same original always maps to the
// same token within a session so screenshots are coherent across
// renders. Disable to revert to literal labels.
//
// The masker is intentionally CHEAP and IDEMPOTENT:
// - Stable per-session mapping (Map<string, string> per kind)
// - No persistence — refreshing the tab gives fresh tokens
// - Off by default — no behaviour change unless settings.demoMode flips
//
// Surfaces that route through `maskLabel`:
//   - Source labels + origin paths (sources panel, schema-panel headers)
//   - Table names (schema-panel + sources panel)
//   - Column names (schema-panel rows, SQL result-table headers)
// SQL cell editor contents are NOT masked — that would break running
// cells. Demo-mode users are expected to clear or simplify cells
// before screenshotting.

export type MaskKind = 'source' | 'origin' | 'table' | 'column';

const PREFIX: Record<MaskKind, string> = {
  source: 'src',
  origin: 'path',
  table: 'tbl',
  column: 'col',
};

interface MaskState {
  enabled: boolean;
  // One counter + map per kind so `tbl_1` and `col_1` are independent.
  maps: Record<MaskKind, Map<string, string>>;
  counters: Record<MaskKind, number>;
}

const _state: MaskState = {
  enabled: false,
  maps: {
    source: new Map(),
    origin: new Map(),
    table: new Map(),
    column: new Map(),
  },
  counters: { source: 0, origin: 0, table: 0, column: 0 },
};

/** Update the enabled flag. Caller is responsible for re-rendering. */
export function setDemoMode(enabled: boolean): void {
  _state.enabled = enabled;
}

export function getDemoMode(): boolean {
  return _state.enabled;
}

/**
 * Reset all mask state. Useful after switching workbooks (different
 * source set) so token numbering restarts at 1 in screenshots. Caller
 * is responsible for triggering re-renders.
 */
export function resetDemoMaskState(): void {
  for (const k of ['source', 'origin', 'table', 'column'] as MaskKind[]) {
    _state.maps[k] = new Map();
    _state.counters[k] = 0;
  }
}

/**
 * Mask a user-data label according to the current mode. When demo
 * mode is OFF, returns `original` unchanged. When ON, returns a stable
 * `<prefix>_<n>` token, allocating a new number on first sight.
 *
 * Empty / undefined / null inputs are returned as-is to avoid token
 * pollution from missing labels.
 */
export function maskLabel(kind: MaskKind, original: string | null | undefined): string {
  if (!original) return original ?? '';
  if (!_state.enabled) return original;
  const map = _state.maps[kind];
  const cached = map.get(original);
  if (cached) return cached;
  const next = ++_state.counters[kind];
  const token = `${PREFIX[kind]}_${next}`;
  map.set(original, token);
  return token;
}
