import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, ColorTheme } from '../constants/colors';

type ThemeCtx = {
  colors: ColorTheme;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeCtx>({ colors: darkColors, isDark: true });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isDark = useColorScheme() !== 'light';
  return (
    <ThemeContext.Provider value={{ colors: isDark ? darkColors : lightColors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext);
}

export function useColors(): ColorTheme {
  return useContext(ThemeContext).colors;
}
