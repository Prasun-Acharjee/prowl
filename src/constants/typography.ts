export const fonts = {
  display: 'DMSerifDisplay_400Regular',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodyBold: 'Inter_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.display, fontSize: 42, lineHeight: 46 },
  h1: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38 },
  h2: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  h3: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  bodyMed: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const,
  },
  count: { fontFamily: fonts.bodyBold, fontSize: 22, lineHeight: 26 },
} as const;
