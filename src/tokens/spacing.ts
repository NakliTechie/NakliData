// Spacing/type scale tokens. Standard NakliTechie set.

export const Space = {
  '0': '0',
  '1': '2px',
  '2': '4px',
  '3': '8px',
  '4': '12px',
  '5': '16px',
  '6': '24px',
  '7': '32px',
  '8': '48px',
  '9': '64px',
} as const;

export const Radius = {
  sm: '3px',
  md: '6px',
  lg: '10px',
  pill: '999px',
} as const;

export const Type = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  familyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  size: {
    xs: '11px',
    sm: '12px',
    md: '13px',
    lg: '15px',
    xl: '18px',
    xxl: '22px',
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
  },
} as const;

export const Shadow = {
  sm: '0 1px 2px rgba(0,0,0,0.04)',
  md: '0 2px 8px rgba(0,0,0,0.08)',
  lg: '0 8px 24px rgba(0,0,0,0.12)',
} as const;
