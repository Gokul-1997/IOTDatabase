import React, { useState } from 'react';
import { View, Text, Image, Alert } from 'react-native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuthStore } from '../../store/authStore';

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function LoginScreen() {
  const theme = useTheme();
  const signIn = useAuthStore((s) => s.signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(email.trim())) errors.email = 'Enter a valid email address';
    if (!password) errors.password = 'Password is required';

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.response?.data?.message ?? 'Please check your credentials and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: theme.spacing.xxl }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: theme.spacing.lg,
            }}
          >
            <Text style={{ color: theme.colors.onAccent, fontSize: theme.type.title, fontWeight: theme.weight.bold as any }}>
              M
            </Text>
          </View>
          <Text
            style={{
              fontSize: theme.type.title,
              fontWeight: theme.weight.bold as any,
              color: theme.colors.textPrimary,
            }}
          >
            MEXA Monitor
          </Text>
          <Text style={{ fontSize: theme.type.body, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
            Sign in to your account
          </Text>
        </View>

        <TextField
          label="Email"
          placeholder="you@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          returnKeyType="next"
        />

        <TextField
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          secureToggle
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        <Button label="Sign In" onPress={handleSubmit} loading={submitting} style={{ marginTop: theme.spacing.sm }} />
      </View>
    </ScreenContainer>
  );
}
