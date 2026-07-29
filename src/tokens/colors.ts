// Rangrez palette subset vendored for NakliData.
// Source of truth for ALL color values. Do not hardcode hex outside this file.
//
// Brickwork — categorical (chart series, type pills)
// Monsoon  — sequential (heatmaps, confidence ramps)
// Neutral  — UI chrome
//
// These specific hex values are the vendored subset; the canonical Rangrez
// palette lives in `nakli-creative-primitives`.

export const Brickwork = [
  '#B5371C', // 1 terracotta
  '#D58A3C', // 2 turmeric
  '#5C7A8C', // 3 indigo-stone
  '#2F6E5A', // 4 leaf
  '#8B5A8C', // 5 plum
  '#C9A24A', // 6 brass
  '#3E4C6A', // 7 dusk
  '#A8453F', // 8 rust
] as const;

export const Monsoon = [
  '#EDF2F4', // 1 cloud
  '#B7C7D6', // 2 mist
  '#7E9AB3', // 3 drizzle
  '#436A8A', // 4 storm
  '#1E3A55', // 5 thunder
] as const;

export const Neutral = {
  bg: '#FAF8F3', // paper
  surface: '#FFFFFF',
  surfaceSubtle: '#F9FAFB',
  surfaceCool: '#F3F4F6',
  surfaceMap: '#FAF7F0',
  surfaceAlt: '#F1ECE3',
  border: '#D9D2C4',
  borderStrong: '#A9A091',
  borderCool: '#D1D5DB',
  borderLight: '#E5E7EB',
  borderMuted: '#CCCCCC',
  text: '#1F1B16',
  textStrong: '#111111',
  textCool: '#374151',
  textSecondary: '#666666',
  textMuted: '#6B6358',
  textCoolMuted: '#6B7280',
  textFaint: '#999999',
  placeholder: '#9CA3AF',
  onStrong: '#FFFFFF',
  accent: '#B5371C', // brickwork[0] — primary action
  accentHover: '#963115',
  accentSoft: '#E9C1B5',
  actionWarm: '#FFB066',
  focus: '#436A8A', // monsoon[3] — focus ring
  danger: '#A8453F',
  success: '#2F6E5A',
  warning: '#D58A3C',
} as const;

export const StatusColor = {
  dangerSoft: '#FDECE3',
  dangerBg: '#F6D6D3',
  piiBg: '#FEE2E2',
  piiText: '#991B1B',
  financialBg: '#FEF3C7',
  warningBg: '#FFFBEB',
  warningText: '#92400E',
  warningAccent: '#F59E0B',
  infoBg: '#EFF6FF',
  infoText: '#1E40AF',
  infoAccent: '#3B82F6',
  publicBg: '#E0E7FF',
  successBg: '#F0FDF4',
  successText: '#166534',
  successAccent: '#16A34A',
  secretBg: '#FCE7F3',
  secretText: '#9D174D',
} as const;

export const OverlayColor = {
  scrim: 'rgba(31, 27, 22, 0.42)',
  dim: 'rgba(31, 27, 22, 0.5)',
  shadow: 'rgba(31, 27, 22, 0.32)',
  border12: 'rgba(31, 27, 22, 0.12)',
  border16: 'rgba(31, 27, 22, 0.16)',
  border08: 'rgba(31, 27, 22, 0.08)',
  muted: 'rgba(31, 27, 22, 0.6)',
  hover: 'rgba(31, 27, 22, 0.04)',
  selected: 'rgba(31, 27, 22, 0.06)',
  toastShadow: 'rgba(0, 0, 0, 0.18)',
  reportShadow: 'rgba(0, 0, 0, 0.1)',
} as const;

/** Stable map series used by MapLibre expression arrays. */
export const MapSeries = [
  '#B5371C',
  '#6F7E76',
  '#D6A24E',
  '#3C5A6B',
  '#8C6F4A',
  '#4F7B6E',
  '#A56A8C',
  '#9C5230',
  '#5B7F9B',
  '#7B6FB1',
  '#506650',
  '#A77E5F',
] as const;

export type CategoricalColor = (typeof Brickwork)[number];
export type SequentialColor = (typeof Monsoon)[number];

export function categorical(i: number): string {
  const v = Brickwork[i % Brickwork.length];
  return v as string;
}

export function sequential(stop: number): string {
  const idx = Math.max(0, Math.min(Monsoon.length - 1, Math.floor(stop * (Monsoon.length - 1))));
  return Monsoon[idx] as string;
}
