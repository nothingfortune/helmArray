// The design tokens. The canvas (docs/design/canvas/Main.dc.html and Contrast.dc.html) is the
// source for every value here; where it differs from docs/plans/03-ui-system.md, the canvas wins.
// styles/tokens.css is written from this file: run `pnpm tokens`.

export const color = {
  bg: '#0A0C0F',
  chrome: '#0D0F13',
  panel: '#111419',
  raised: '#1A1F27',
  hover: '#222833',
  line: '#262C36',
  'line-key': '#2A313C',
  edge: '#6B7687',
  text: '#EDF0F4',
  secondary: '#C3CAD5',
  muted: '#8E98A8',
  accent: '#FFB224',
  'accent-hover': '#FFC861',
  'accent-ink': '#1A1200',
  pressed: '#3A2E14',
  combat: '#FF7A90',
  'combat-tint': '#22202A',
  movement: '#3BD6B0',
  'movement-tint': '#1B2427',
  ability: '#6EA8FF',
  'ability-tint': '#1B2130',
  travel: '#B5E361',
  'travel-tint': '#1F2523',
  menu: '#B99BFF',
  'menu-tint': '#201F2E',
  ok: '#4ADE80',
  'ok-bg': '#122019',
  warning: '#FFD866',
  'warning-bg': '#2A2412',
  error: '#FF5D5D',
  'error-text': '#FF8A8A',
  'error-bg': '#2A1719',
  conflict: '#2A1A1D',
} as const;

export const font = {
  name: "'Space Grotesk', sans-serif",
  read: 'Inter, sans-serif',
  signal: "'JetBrains Mono', monospace",
} as const;

export const size = {
  display: '40px',
  title: '24px',
  body: '15px',
  label: '13px',
  key: '12px',
  caption: '12px',
} as const;

export const radius = {
  chip: '6px',
  key: '10px',
  panel: '16px',
} as const;

export const space = [4, 8, 12, 16, 24, 32, 48] as const;

export const motion = {
  hover: '120ms',
  drawer: '200ms',
  flash: '180ms',
} as const;

export function tokensCss(): string {
  const lines: string[] = [];
  const group = (prefix: string, values: Readonly<Record<string, string>>): void => {
    for (const [name, value] of Object.entries(values))
      lines.push(`  --${prefix}-${name}: ${value};`);
  };
  group('color', color);
  group('font', font);
  group('size', size);
  group('radius', radius);
  for (const step of space) lines.push(`  --space-${step}: ${step}px;`);
  group('motion', motion);
  return [
    '/* Written from src/shared/tokens.ts by `pnpm tokens`. Do not edit. */',
    ':root {',
    ...lines,
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    ...Object.keys(motion).map((name) => `    --motion-${name}: 0ms;`),
    '  }',
    '}',
    '',
  ].join('\n');
}
