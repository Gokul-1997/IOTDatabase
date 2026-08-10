import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, ColorScheme } from './colors';
import { spacing, radius, typeScale, fontWeight, shadow } from './tokens';

interface Theme {
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof typeScale;
  weight: typeof fontWeight;
  shadow: typeof shadow;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const theme = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      type: typeScale,
      weight: fontWeight,
      shadow,
      isDark,
    }),
    [isDark]
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
