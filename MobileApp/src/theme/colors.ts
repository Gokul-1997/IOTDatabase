// Brand tokens — kept in sync with the web app's design system (accent #1f5e8c).
export const palette = {
  brand50: '#e8f0f6',
  brand100: '#c9dcea',
  brand500: '#1f5e8c',
  brand600: '#194c72',
  brand700: '#123a58',

  ink900: '#182430',
  ink700: '#333f4b',
  ink500: '#46586a',
  ink300: '#7b8b9a',
  ink100: '#d5dde4',
  ink50: '#f6f8fa',

  // Validated pair (scripts/validate_palette.js, dataviz skill): passes the
  // normal-vision floor; CVD separation lands in the 6-8 WARN band, which is
  // acceptable because every status is also spelled out as text, never color alone.
  success: '#1c7d43',
  successBg: '#e6f4ea',
  warning: '#9c5c0c',
  warningBg: '#f8efe0',
  danger: '#9a1f1f',
  dangerBg: '#fbe9e9',

  white: '#ffffff',
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
}

export const lightColors: ColorScheme = {
  background: palette.ink50,
  surface: palette.white,
  surfaceAlt: palette.brand50,
  border: palette.ink100,
  textPrimary: palette.ink900,
  textSecondary: palette.ink500,
  textMuted: palette.ink300,
  accent: palette.brand500,
  accentPressed: palette.brand600,
  onAccent: palette.white,
  success: palette.success,
  successBg: palette.successBg,
  warning: palette.warning,
  warningBg: palette.warningBg,
  danger: palette.danger,
  dangerBg: palette.dangerBg,
};

export const darkColors: ColorScheme = {
  background: '#10161d',
  surface: '#171f28',
  surfaceAlt: '#1b2c3a',
  border: '#2c3a47',
  textPrimary: '#dfe7ee',
  textSecondary: '#a7b6c3',
  textMuted: '#71828f',
  accent: '#5f9cc8',
  accentPressed: '#79aed3',
  onAccent: '#0d1720',
  // Validated pair (scripts/validate_palette.js, dataviz skill, dark surface).
  success: '#4a9a6a',
  successBg: '#173322',
  warning: '#c67818',
  warningBg: '#2b2416',
  danger: '#e18080',
  dangerBg: '#331717',
};
