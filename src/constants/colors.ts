// ─── Coral Dusk ───────────────────────────────────────────────────────────────
//
// Twilight plum grounds with a warm coral accent and a soft violet second
// colour. The pair doubles as the map's freshness code: coral = seen in the last
// 24 h, violet = seen this week, muted = older (see PetPin / dashboard).
//
// Text on a coral fill is always dark ink, in both themes — white on coral
// falls short of AA at body sizes.

export const darkColors = {
  bg:       '#160F1F',
  surface:  '#20172B',
  elevated: '#2A1F38',
  border:   '#3A2D4A',

  accent:       '#FF7A6B',
  accentDim:    '#D9574A',
  accentFaint:  'rgba(255, 122, 107, 0.14)',
  accentBorder: 'rgba(255, 122, 107, 0.34)',

  violet:      '#B892FF',
  violetFaint: 'rgba(184, 146, 255, 0.14)',

  mint: '#6FD6B5',

  textPrimary:   '#F6EEF4',
  textSecondary: '#B4A6BF',
  textMuted:     '#6C5E7A',

  // Content placed ON a coral fill (CTAs, pins, avatars)
  onAccent: '#160F1F',

  // Translucent chrome floating over the map
  glass: 'rgba(32, 23, 43, 0.88)',
  // Dims whatever sits behind a sheet or overlay
  scrim: 'rgba(10, 6, 16, 0.38)',
  // Shimmer highlight swept across skeleton placeholders
  shimmer: 'rgba(255, 255, 255, 0.06)',
} as const;

// Lilac-tinted paper. Surfaces layer lilac → paper → white, mirroring dark
// mode's hue, inverted. Accent and violet are deepened to hold contrast on a
// light ground.
export const lightColors = {
  bg:       '#F7F2F7',
  surface:  '#FCF9FC',
  elevated: '#FFFFFF',
  border:   '#E6DCE8',

  accent:       '#F25C4C',
  accentDim:    '#C8402F',
  accentFaint:  'rgba(242, 92, 76, 0.12)',
  accentBorder: 'rgba(242, 92, 76, 0.36)',

  violet:      '#7B53D6',
  violetFaint: 'rgba(123, 83, 214, 0.12)',

  mint: '#1F9477',

  textPrimary:   '#22162E',
  textSecondary: '#6A5A78',  // ~5:1 on bg
  textMuted:     '#A395AE',  // captions / labels only (≥ 14 px)

  onAccent: '#22162E',

  glass:   'rgba(252, 249, 252, 0.92)',
  scrim:   'rgba(34, 22, 46, 0.22)',
  shimmer: 'rgba(255, 255, 255, 0.7)',
} as const;

// Placeholder avatar fills for pets without a photo. Picked to sit on both
// grounds and carry dark `onAccent` initials; hashed from the pet id so a pet
// keeps its colour everywhere (see usePets / CameraScreen / dashboard).
export const AVATAR_COLORS = ['#FF8A7A', '#B892FF', '#6FD6B5', '#F2B36B', '#E58FB8', '#8FB3FF', '#C9A7E8'];

// Convenience re-export so the rare non-theme import still compiles.
export const colors = darkColors;

// ColorTheme uses string (not literals) so dark + light both satisfy the contract.
export type ColorTheme = { [K in keyof typeof darkColors]: string };
export type ColorKey   = keyof ColorTheme;

export function avatarColor(id: string): string {
  const hash = id.split('').reduce((n, c) => n + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
