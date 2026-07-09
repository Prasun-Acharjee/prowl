export const darkColors = {
  bg:       '#0D0E18',
  surface:  '#161824',
  elevated: '#1E2030',
  border:   '#2A2C3D',

  amber:       '#F5B93E',
  amberDim:    '#B8851A',
  amberFaint:  'rgba(245, 185, 62, 0.12)',
  amberBorder: 'rgba(245, 185, 62, 0.28)',

  rose:      '#C4728A',
  roseFaint: 'rgba(196, 114, 138, 0.12)',

  sage: '#8FA889',

  textPrimary:   '#F0EDE8',
  textSecondary: '#9B9AAD',
  textMuted:     '#555670',

  // Text colour for content placed ON an amber background (CTAs, pins)
  onAmber: '#0D0E18',
} as const;

// Cool lavender-parchment base — amber reads more vivid against a slightly cool
// ground than against the generic warm-cream palette. Surfaces layer from
// barely-lavender → paper → white, mirroring dark mode's hue DNA, inverted.
export const lightColors = {
  bg:       '#F0EFF6',
  surface:  '#F8F7FC',
  elevated: '#FFFFFF',
  border:   '#DDDCE6',

  amber:       '#F5B93E',
  amberDim:    '#B8851A',
  amberFaint:  'rgba(245, 185, 62, 0.13)',
  amberBorder: 'rgba(245, 185, 62, 0.38)',

  rose:      '#C4547A',   // deepened for AA contrast on light bg
  roseFaint: 'rgba(196, 84, 122, 0.12)',

  sage: '#5A7D62',        // darker for light-bg readability

  textPrimary:   '#1C1A2E',  // near-black with same blue-purple DNA as dark bg
  textSecondary: '#65637A',  // ~4.8:1 on bg
  textMuted:     '#9896AA',  // captions / labels only (≥ 14 px)

  onAmber: '#1C1A2E',
} as const;

// Convenience re-export so the rare non-theme import still compiles during migration.
export const colors = darkColors;

// ColorTheme uses string (not literals) so dark + light both satisfy the contract.
export type ColorTheme = { [K in keyof typeof darkColors]: string };
export type ColorKey   = keyof ColorTheme;
