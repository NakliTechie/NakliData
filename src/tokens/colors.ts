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
  surfaceAlt: '#F1ECE3',
  border: '#D9D2C4',
  borderStrong: '#A9A091',
  text: '#1F1B16',
  textMuted: '#6B6358',
  accent: '#B5371C', // brickwork[0] — primary action
  focus: '#436A8A', // monsoon[3] — focus ring
  danger: '#A8453F',
  success: '#2F6E5A',
  warning: '#D58A3C',
} as const;

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
