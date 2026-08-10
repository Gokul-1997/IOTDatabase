import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, style }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const backgroundColor =
    variant === 'primary'
      ? isDisabled
        ? theme.colors.border
        : theme.colors.accent
      : 'transparent';

  const textColor = variant === 'primary' ? theme.colors.onAccent : theme.colors.accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor,
          borderWidth: variant === 'secondary' ? 1.5 : 0,
          borderColor: theme.colors.accent,
          opacity: pressed && !isDisabled ? 0.85 : 1,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.md,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.label, { color: textColor, fontSize: theme.type.body, fontWeight: theme.weight.semibold as any }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    letterSpacing: 0.2,
  },
});
