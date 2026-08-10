import React from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { StmMexaLogo } from '../components/StmMexaLogo';

// Shown briefly after the native splash hides while auth status is checked.
export function BootstrapScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
      <StmMexaLogo width={140} dark={theme.isDark} />
      <ActivityIndicator size="large" color={theme.colors.accent} style={{ marginTop: theme.spacing.xl }} />
      <Text style={{ marginTop: theme.spacing.md, color: theme.colors.textSecondary, fontSize: theme.type.body }}>
        Loading MEXA Monitor…
      </Text>
    </View>
  );
}
