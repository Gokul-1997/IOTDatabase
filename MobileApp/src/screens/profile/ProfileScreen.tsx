import React from 'react';
import { View, Text, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuthStore } from '../../store/authStore';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';

export function ProfileScreen() {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  // react-native-web does not implement multi-button Alert.alert — the
  // buttons render nothing and no onPress ever fires, so Sign Out silently
  // does nothing in the web preview. window.confirm is the reliable
  // cross-browser equivalent; native platforms keep the real Alert.
  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to sign out?')) signOut();
      return;
    }
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
      <View style={{ padding: theme.spacing.lg }}>
        <Text style={{ fontSize: theme.type.title, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary, marginBottom: theme.spacing.lg }}>
          Profile
        </Text>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.onAccent, fontSize: theme.type.subtitle, fontWeight: theme.weight.bold as any }}>
              {(user?.username ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: theme.type.bodyLarge, fontWeight: theme.weight.semibold as any, color: theme.colors.textPrimary }}>
              {user?.username ?? '—'}
            </Text>
            <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
              {user?.email ?? '—'}
            </Text>
          </View>
        </Card>

        <Card style={{ marginBottom: theme.spacing.xl }}>
          <ProfileRow icon="business-outline" label="Company" value={user?.company_name ?? '—'} theme={theme} />
          <ProfileRow icon="shield-checkmark-outline" label="Role" value={user?.roles?.join(', ') ?? '—'} theme={theme} last />
        </Card>

        <Button label="Sign Out" onPress={confirmSignOut} variant="secondary" />
      </View>
    </SafeAreaView>
  );
}

function ProfileRow({
  icon,
  label,
  value,
  theme,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  theme: ReturnType<typeof useTheme>;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.border,
        marginBottom: last ? 0 : theme.spacing.sm,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.colors.textMuted} />
      <Text style={{ color: theme.colors.textSecondary, fontSize: theme.type.caption, width: 80 }}>{label}</Text>
      <Text style={{ color: theme.colors.textPrimary, fontSize: theme.type.body, flex: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
