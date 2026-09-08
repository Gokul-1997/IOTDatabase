import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { StmMexaLogo } from '../../components/StmMexaLogo';
import { useTheme } from '../../theme/ThemeProvider';
import * as authApi from '../../api/auth';
import { RootStackParamList } from '../../navigation/types';

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type Nav = NativeStackNavigationProp<RootStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  // The backend intentionally returns the same success response whether or
  // not the address is registered (no account-enumeration leak) — so this
  // screen never has a real "failure" state to show for a bad email, only
  // for the request itself not going through (see genericError below).
  const [sent, setSent] = useState(false);
  const [genericError, setGenericError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email is required');
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError('Enter a valid email address');
      return;
    }
    setEmailError(undefined);
    setGenericError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(trimmed);
      setSent(true);
    } catch {
      setGenericError('Something went wrong. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: theme.spacing.xl }}
      >
        <Ionicons name="chevron-back" size={20} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: theme.type.body, fontWeight: theme.weight.semibold as any }}>
          Back to Sign In
        </Text>
      </Pressable>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        {sent ? (
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.successBg,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: theme.spacing.xl,
              }}
            >
              <Ionicons name="mail-open-outline" size={32} color={theme.colors.success} />
            </View>
            <Text
              style={{
                fontSize: theme.type.title,
                fontWeight: theme.weight.bold as any,
                color: theme.colors.textPrimary,
                textAlign: 'center',
              }}
            >
              Check your email
            </Text>
            <Text
              style={{
                fontSize: theme.type.body,
                color: theme.colors.textSecondary,
                textAlign: 'center',
                marginTop: theme.spacing.sm,
                marginBottom: theme.spacing.xxl,
                lineHeight: 21,
              }}
            >
              If an account exists for{' '}
              <Text style={{ color: theme.colors.textPrimary, fontWeight: theme.weight.semibold as any }}>{email.trim()}</Text>,
              a password reset link is on its way.
            </Text>
            <Button label="Back to Sign In" onPress={() => navigation.goBack()} style={{ width: '100%' }} />
          </View>
        ) : (
          <>
            <View style={{ alignItems: 'center', marginBottom: theme.spacing.xxl }}>
              <View style={{ marginBottom: theme.spacing.lg }}>
                <StmMexaLogo width={140} dark={theme.isDark} />
              </View>
              <Text
                style={{
                  fontSize: theme.type.subtitle,
                  fontWeight: theme.weight.bold as any,
                  color: theme.colors.textPrimary,
                  marginTop: theme.spacing.sm,
                }}
              >
                Forgot your password?
              </Text>
              <Text
                style={{
                  fontSize: theme.type.body,
                  color: theme.colors.textSecondary,
                  textAlign: 'center',
                  marginTop: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.md,
                }}
              >
                Enter the email on your account and we'll send a link to reset it.
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
              error={emailError}
              returnKeyType="send"
              onSubmitEditing={handleSubmit}
            />

            {genericError && (
              <Text style={{ color: theme.colors.danger, fontSize: theme.type.caption, marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }}>
                {genericError}
              </Text>
            )}

            <Button label="Send Reset Link" onPress={handleSubmit} loading={submitting} style={{ marginTop: theme.spacing.sm }} />
          </>
        )}
      </View>
    </ScreenContainer>
  );
}
