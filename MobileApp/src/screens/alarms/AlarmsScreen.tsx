import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Alert, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import * as alarmsApi from '../../api/alarms';
import { MachineAlarm, AlarmSeverity, AlarmType } from '../../types/alarm';
import { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'active' | 'resolved';
const PAGE_LIMIT = 20;

// Same three-tier classification Backend/src/dashboard/factory.service.js
// uses for the Factory Dashboard's alarm summary (CRITICAL stays its own
// tier; HIGH/MEDIUM collapse to "attention"; LOW reads as informational) —
// keeping mobile and web triage severity in one visual language.
function severityTier(theme: ReturnType<typeof useTheme>, severity: AlarmSeverity) {
  if (severity === 'CRITICAL') return { color: theme.colors.danger, bg: theme.colors.dangerBg, label: 'Critical' };
  if (severity === 'HIGH' || severity === 'MEDIUM') return { color: theme.colors.warning, bg: theme.colors.warningBg, label: severity === 'HIGH' ? 'High' : 'Medium' };
  return { color: theme.colors.textMuted, bg: theme.colors.surfaceAlt, label: 'Low' };
}

function typeIcon(type: AlarmType): keyof typeof Ionicons.glyphMap {
  if (type === 'OFFLINE') return 'cloud-offline-outline';
  if (type === 'LOW_PERFORMANCE') return 'speedometer-outline';
  return 'alert-circle-outline';
}

function typeLabel(type: AlarmType): string {
  if (type === 'OFFLINE') return 'Machine Offline';
  if (type === 'LOW_PERFORMANCE') return 'Low Performance';
  return 'Alarm';
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.md,
        alignItems: 'center',
        backgroundColor: active ? theme.colors.accent : 'transparent',
      }}
    >
      <Text
        style={{
          fontSize: theme.type.caption,
          fontWeight: theme.weight.semibold as any,
          color: active ? theme.colors.onAccent : theme.colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AlarmCard({
  item,
  onResolve,
  resolving,
  onPress,
}: {
  item: MachineAlarm;
  onResolve: () => void;
  resolving: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tier = severityTier(theme, item.severity);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <View style={{ width: 4, borderRadius: 2, backgroundColor: tier.color }} />

        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Ionicons name={typeIcon(item.alarm_type)} size={15} color={tier.color} />
              <Text style={{ fontSize: theme.type.bodyLarge, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary }} numberOfLines={1}>
                {item.machine_serial_no}
              </Text>
            </View>
            <View style={{ paddingHorizontal: theme.spacing.sm, paddingVertical: 3, borderRadius: theme.radius.pill, backgroundColor: tier.bg }}>
              <Text style={{ fontSize: 10.5, fontWeight: theme.weight.bold as any, color: tier.color, letterSpacing: 0.3 }}>
                {tier.label.toUpperCase()}
              </Text>
            </View>
          </View>

          <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }}>
            {typeLabel(item.alarm_type)}
            {item.message ? ` · ${item.message}` : ''}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ fontSize: theme.type.caption, color: theme.colors.textMuted }}>
              {item.is_resolved
                ? `Resolved ${item.resolved_at ? timeAgo(item.resolved_at) : ''}${item.resolved_by_name ? ` · ${item.resolved_by_name}` : ''}`
                : `Started ${timeAgo(item.started_at)}`}
            </Text>

            {!item.is_resolved && (
              <Pressable
                onPress={onResolve}
                disabled={resolving}
                hitSlop={8}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: 4,
                  borderRadius: theme.radius.sm,
                  borderWidth: 1,
                  borderColor: theme.colors.accent,
                }}
              >
                {resolving ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={13} color={theme.colors.accent} />
                    <Text style={{ fontSize: 11, fontWeight: theme.weight.semibold as any, color: theme.colors.accent }}>Resolve</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export function AlarmsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();

  const [tab, setTab] = useState<Tab>('active');
  const [items, setItems] = useState<MachineAlarm[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const load = useCallback(async (targetTab: Tab, targetPage: number, append: boolean) => {
    try {
      setError(null);
      const res = await alarmsApi.getAlarms({
        is_resolved: targetTab === 'resolved',
        page: targetPage,
        limit: PAGE_LIMIT,
      });
      setItems((prev) => (append ? [...prev, ...res.data] : res.data));
      setTotal(res.pagination.total);
      setPage(res.pagination.page);
      setHasMore(res.pagination.page < res.pagination.totalPages);
    } catch {
      setError('Unable to load alarms. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(tab, 1, false);
  }, [tab, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load(tab, 1, false);
  };

  const onEndReached = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    load(tab, page + 1, true);
  };

  const doResolve = async (alarm: MachineAlarm) => {
    setResolvingId(alarm.id);
    try {
      await alarmsApi.resolveAlarm(alarm.id);
      setItems((prev) => prev.filter((a) => a.id !== alarm.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      Alert.alert('Could not resolve', 'Please check your connection and try again.');
    } finally {
      setResolvingId(null);
    }
  };

  const handleResolve = (alarm: MachineAlarm) => {
    const confirmMessage = `Mark this ${alarm.machine_serial_no} alarm as resolved?`;
    // See ProfileScreen.confirmSignOut — react-native-web doesn't implement
    // multi-button Alert.alert, so the web preview needs window.confirm.
    if (Platform.OS === 'web') {
      if (window.confirm(confirmMessage)) doResolve(alarm);
      return;
    }
    Alert.alert('Resolve alarm', confirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resolve', onPress: () => doResolve(alarm) },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: theme.type.title, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary }}>
            Alarms
          </Text>
          {!loading && (
            <Text style={{ fontSize: theme.type.caption, color: theme.colors.textMuted, fontVariant: ['tabular-nums'] }}>
              {total} {tab === 'active' ? 'unresolved' : 'resolved'}
            </Text>
          )}
        </View>

        <View
          style={{
            flexDirection: 'row',
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.md,
            padding: 3,
            marginTop: theme.spacing.md,
            gap: 3,
          }}
        >
          <SegmentButton label="Active" active={tab === 'active'} onPress={() => setTab('active')} />
          <SegmentButton label="Resolved" active={tab === 'resolved'} onPress={() => setTab('resolved')} />
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: theme.spacing.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginTop: theme.spacing.md }} color={theme.colors.accent} /> : null}
        ListEmptyComponent={
          !loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: theme.spacing.xxxl }}>
              <Ionicons
                name={error ? 'cloud-offline-outline' : tab === 'active' ? 'shield-checkmark-outline' : 'file-tray-outline'}
                size={32}
                color={error ? theme.colors.danger : theme.colors.success}
              />
              <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.md, textAlign: 'center' }}>
                {error ?? (tab === 'active' ? 'All clear — no active alarms' : 'No resolved alarms yet')}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <AlarmCard
            item={item}
            resolving={resolvingId === item.id}
            onResolve={() => handleResolve(item)}
            onPress={() => navigation.navigate('MachineDetail', { machineId: item.machine_id, machineName: item.machine_serial_no })}
          />
        )}
      />
    </SafeAreaView>
  );
}
