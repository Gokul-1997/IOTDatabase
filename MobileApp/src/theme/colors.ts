// Brand tokens — pulled directly from FrontendIOT's actual source of truth:
// the "STM MEXA" logo gradient (public/images/logo/STM_Mexa_logo.svg) and
// styles.scss (.bg-top-bar, .nav-btn). Navy -> wine -> red is the real STM
// Mexa identity; the mobile app previously used an unrelated generic blue.
export const palette = {
  navy900: '#102B4E', // "STM" wordmark — darkest anchor
  navy700: '#2B3990', // gradient start / .nav-btn default / header start
  wine600: '#863567', // .nav-btn:hover/.active
  wine500: '#9B3F70', // header gradient end
  red500: '#EF4136', // gradient tail — used sparingly (danger territory), not as a UI color

  brand50: '#eef0fa',
  brand100: '#d6d9f0',
  brand500: '#2B3990', // = navy700, the mobile app's primary accent
  brand600: '#223070',
  brand700: '#1a2456',

  // The full logo gradient, for hero surfaces only (header, ring) — never for
  // text or small UI (a 3-stop gradient on body text or icons reads as noisy).
  brandGradient: ['#2B3990', '#843D67', '#EF4136'] as const,

  // Dark-mode hero: same navy -> wine -> red identity, darkened and
  // desaturated for an OLED-dark surface instead of flattened to flat
  // black. Flat black was the original approach (see DashboardScreen git
  // history) and reads as broken/generic — this keeps the brand gradient
  // legible without the light-mode version's brightness.
  brandGradientDark: ['#141C30', '#241A2C', '#1B1014'] as const,

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
  // Lighter step of the brand navy — legible on near-black, still reads as
  // "the same brand" rather than a generic blue (matches the web app's dark
  // mode, which flattens the gradient header to near-black but keeps the
  // same brand family for interactive elements).
  accent: '#8891D6',
  accentPressed: '#a3abe3',
  onAccent: '#10142b',
  // Validated pair (scripts/validate_palette.js, dataviz skill, dark surface).
  success: '#4a9a6a',
  successBg: '#173322',
  warning: '#c67818',
  warningBg: '#2b2416',
  danger: '#e18080',
  dangerBg: '#331717',
};
