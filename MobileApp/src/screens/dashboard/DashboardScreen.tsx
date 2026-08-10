import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuthStore } from '../../store/authStore';
import { Card } from '../../components/Card';
import { Skeleton } from '../../components/Skeleton';
import { FleetUtilizationRing } from '../../components/FleetUtilizationRing';
import { palette } from '../../theme/colors';
import * as dashboardApi from '../../api/dashboard';
import { connectSocket, joinPlant, onMachineUpdate, offMachineUpdate, MachineUpdatePayload } from '../../api/socket';
import { DashboardMachine, DashboardResponse, MachineStatus } from '../../types/dashboard';

// The REST snapshot recomputes the heavier aggregated fields (run/idle time,
// utilization, achieved/target qty, operator, part) — those don't need
// sub-second freshness. status/alarm are patched instantly over the socket
// the moment new telemetry lands (see api/socket.ts), matching
// FrontendIOT's dashboard.component.ts split.
const POLL_INTERVAL_MS = 30_000;
const OFFLINE_THRESHOLD_SEC = 60; // matches Backend/src/dashboard/dashboard.service.js
const STALENESS_SWEEP_MS = 5_000;

function resolveStatus(machineStatus: string | undefined, receivedAtSec: number | null): MachineStatus {
  if (!receivedAtSec) return 'OFFLINE';
  const freshDiff = Math.floor(Date.now() / 1000) - receivedAtSec;
  if (freshDiff > OFFLINE_THRESHOLD_SEC) return 'OFFLINE';
  if (['RUN', 'RUNNING', 'CUTTING'].includes((machineStatus || '').toUpperCase())) return 'RUNNING';
  return 'IDLE';
}

function statusColor(theme: ReturnType<typeof useTheme>, status: MachineStatus) {
  if (status === 'RUNNING') return theme.colors.success;
  if (status === 'IDLE') return theme.colors.warning;
  return theme.colors.textMuted;
}

function statusBg(theme: ReturnType<typeof useTheme>, status: MachineStatus) {
  if (status === 'RUNNING') return theme.colors.successBg;
  if (status === 'IDLE') return theme.colors.warningBg;
  return theme.colors.surfaceAlt;
}

function timeAgo(date: Date | null) {
  if (!date) return '';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

function FleetStatCell({ value, label, color }: { value: number; label: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }} />
        <Text
          style={{ fontSize: theme.type.title, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary, fontVariant: ['tabular-nums'] }}
        >
          {value}
        </Text>
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
}

function FleetStatsCard({
  total,
  running,
  idle,
  offline,
}: {
  total: number;
  running: number;
  idle: number;
  offline: number;
}) {
  const theme = useTheme();
  return (
    <Card style={{ flexDirection: 'row', marginTop: -theme.spacing.xl }}>
      <FleetStatCell value={total} label="Total" color={theme.colors.accent} />
      <FleetStatCell value={running} label="Running" color={theme.colors.success} />
      <FleetStatCell value={idle} label="Idle" color={theme.colors.warning} />
      <FleetStatCell value={offline} label="Offline" color={theme.colors.textMuted} />
    </Card>
  );
}

function UtilizationBar({ value, color }: { value: number; color: string }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={{ height: 5, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: theme.radius.pill, backgroundColor: color }} />
    </View>
  );
}

function MachineRow({ item, onPress }: { item: DashboardMachine; onPress: () => void }) {
  const theme = useTheme();
  const color = statusColor(theme, item.status);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
    <Card style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: theme.type.bodyLarge, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary, flex: 1 }} numberOfLines={1}>
          {item.machine_serial_no}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {item.alarm && <Ionicons name="alert-circle" size={16} color={theme.colors.danger} />}
          <View
            style={{
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 3,
              borderRadius: theme.radius.pill,
              backgroundColor: statusBg(theme, item.status),
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: theme.weight.bold as any, color, letterSpacing: 0.3 }}>{item.status}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
          {item.operator_name !== '--' ? item.operator_name : 'No operator assigned'}
        </Text>
        <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
          {item.part_name ?? 'No active job'}
        </Text>
      </View>

      <View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ fontSize: 11, color: theme.colors.textMuted }}>Utilization</Text>
          <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: theme.weight.semibold as any }}>
            {item.utilization}%{item.target_qty > 0 ? ` · ${item.achieved_qty}/${item.target_qty} pcs` : ''}
          </Text>
        </View>
        <UtilizationBar value={item.utilization} color={color} />
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="play-circle-outline" size={13} color={theme.colors.textMuted} />
          <Text style={{ fontSize: 11, color: theme.colors.textMuted, fontVariant: ['tabular-nums'] }}>{item.run_time}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="pause-circle-outline" size={13} color={theme.colors.textMuted} />
          <Text style={{ fontSize: 11, color: theme.colors.textMuted, fontVariant: ['tabular-nums'] }}>{item.idle_time}</Text>
        </View>
      </View>
    </Card>
    </Pressable>
  );
}

function DashboardSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
      <Skeleton width={160} height={22} />
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Skeleton width="48%" height={72} radius={theme.radius.lg} />
        <Skeleton width="48%" height={72} radius={theme.radius.lg} />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Skeleton width="48%" height={72} radius={theme.radius.lg} />
        <Skeleton width="48%" height={72} radius={theme.radius.lg} />
      </View>
      <Skeleton width="100%" height={80} radius={theme.radius.lg} />
      <Skeleton width="100%" height={110} radius={theme.radius.lg} />
      <Skeleton width="100%" height={110} radius={theme.radius.lg} />
    </View>
  );
}

export function DashboardScreen() {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const staleSweepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-machine "last seen" clock: seeded fresh on every REST snapshot (the
  // server just computed status as of that moment) and advanced by each
  // socket packet's own received_at. Drives the local staleness sweep below,
  // matching the web dashboard's OFFLINE-detection safety net.
  const lastSeenRef = useRef<Map<number, number>>(new Map());

  // Silent background refresh — never flips the full-screen loading state,
  // so a poll or socket patch never feels like a reload.
  //
  // Matches FrontendIOT/dashboard.component.ts exactly: after the very
  // first load, a REST poll only refreshes run_time/idle_time/utilization/
  // operator/part — it must NEVER overwrite status/alarm again, or it fights
  // with the socket's instant updates and the web/mobile counts drift apart
  // (this was the actual bug — the two clients were computing counts the
  // same way, but mobile kept re-syncing status from a 30s-stale snapshot).
  const fetchSilently = useCallback(async () => {
    try {
      const data = await dashboardApi.getDashboard();
      const nowSec = Math.floor(Date.now() / 1000);

      setDashboard((prev) => {
        if (!prev) {
          // Bootstrap: nothing to preserve yet, take everything as-is.
          data.machines.forEach((m) => lastSeenRef.current.set(m.machine_id, nowSec));
          return data;
        }

        const existingById = new Map(prev.machines.map((m) => [m.machine_id, m]));
        const machines = data.machines.map((incoming) => {
          const existing = existingById.get(incoming.machine_id);
          if (!existing) {
            // A machine that's new since the last snapshot — nothing to
            // preserve, so its freshness clock starts now.
            lastSeenRef.current.set(incoming.machine_id, nowSec);
            return incoming;
          }
          // Keep the socket/sweep-owned fields; take everything else fresh.
          return { ...incoming, status: existing.status, alarm: existing.alarm };
        });

        return { ...data, machines };
      });

      setError(null);
      setLastUpdated(new Date());
    } catch {
      setError((prev) => prev ?? 'Unable to reach the server.');
    }
  }, []);

  // Instant status/alarm patch — never touches run/idle time, utilization,
  // operator or part, which stay owned by the 30s REST snapshot above.
  const applySocketUpdate = useCallback((update: MachineUpdatePayload) => {
    const receivedAtSec = update.received_at != null ? Math.floor(new Date(update.received_at).getTime() / 1000) || Number(update.received_at) : Math.floor(Date.now() / 1000);
    lastSeenRef.current.set(update.machine_id, receivedAtSec);
    const status = resolveStatus(update.machine_status, receivedAtSec);

    setDashboard((prev) => {
      if (!prev) return prev;
      let changed = false;
      const machines = prev.machines.map((m) => {
        if (m.machine_id !== update.machine_id) return m;
        if (m.status === status && m.alarm === !!update.alarm) return m;
        changed = true;
        return { ...m, status, alarm: !!update.alarm };
      });
      return changed ? { ...prev, machines } : prev;
    });
  }, []);

  // Safety net: a machine that stops sending data without a final packet
  // (network drop, power off) needs to flip OFFLINE even with no new event.
  const sweepStaleness = useCallback(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    setDashboard((prev) => {
      if (!prev) return prev;
      let changed = false;
      const machines = prev.machines.map((m) => {
        const seenAt = lastSeenRef.current.get(m.machine_id);
        if (seenAt == null) return m;
        const isStale = nowSec - seenAt > OFFLINE_THRESHOLD_SEC;
        if (isStale && m.status !== 'OFFLINE') {
          changed = true;
          return { ...m, status: 'OFFLINE' as MachineStatus };
        }
        return m;
      });
      return changed ? { ...prev, machines } : prev;
    });
  }, []);

  useEffect(() => {
    (async () => {
      await fetchSilently();
      setLoading(false);
    })();

    pollRef.current = setInterval(fetchSilently, POLL_INTERVAL_MS);
    staleSweepRef.current = setInterval(sweepStaleness, STALENESS_SWEEP_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (staleSweepRef.current) clearInterval(staleSweepRef.current);
    };
  }, [fetchSilently, sweepStaleness]);

  useEffect(() => {
    if (!user?.plant_id) return;

    let cancelled = false;
    (async () => {
      await connectSocket();
      if (cancelled) return;
      joinPlant(Number(user.plant_id));
      onMachineUpdate(applySocketUpdate);
    })();

    return () => {
      cancelled = true;
      offMachineUpdate();
    };
  }, [user?.plant_id, applySocketUpdate]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSilently();
    setRefreshing(false);
  }, [fetchSilently]);

  // Derived from the live machine list (not the 30s-old summary field) so
  // the stat tiles reflect socket-driven status changes the instant they land.
  const summary = useMemo(() => {
    const machines = dashboard?.machines ?? [];
    const running = machines.filter((m) => m.status === 'RUNNING').length;
    const idle = machines.filter((m) => m.status === 'IDLE').length;
    const offline = machines.filter((m) => m.status === 'OFFLINE').length;
    const avgUtilization = machines.length
      ? machines.reduce((sum, m) => sum + (m.utilization || 0), 0) / machines.length
      : 0;
    return { total: machines.length, running, idle, offline, avgUtilization };
  }, [dashboard]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
        <DashboardSkeleton />
      </SafeAreaView>
    );
  }

  const machines = dashboard?.machines ?? [];
  const noActiveShift = !dashboard?.shift;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
      {/* Brand hero — same navy -> wine -> red gradient as FrontendIOT's .bg-top-bar
          (flattened to near-black in dark mode, matching the web app's dark theme). */}
      <LinearGradient
        colors={theme.isDark ? ['#0f0f0f', '#0f0f0f'] : [palette.navy700, palette.wine600, palette.red500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: noActiveShift ? theme.spacing.xl : theme.spacing.xxxl,
          borderBottomLeftRadius: theme.radius.xl,
          borderBottomRightRadius: theme.radius.xl,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontSize: theme.type.caption, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {user?.company_name ?? 'Shop Floor'} {dashboard?.shift ? `· ${dashboard.shift.shift_code}` : ''}
            </Text>
            <Text style={{ fontSize: theme.type.title, fontWeight: theme.weight.bold as any, color: '#FFFFFF', marginTop: 2 }}>
              Hello, {user?.username ?? 'there'}
            </Text>
          </View>
          {lastUpdated && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#7CE6A6' }} />
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{timeAgo(lastUpdated)}</Text>
            </View>
          )}
        </View>

        {noActiveShift ? (
          <View style={{ alignItems: 'center', paddingVertical: theme.spacing.xl }}>
            <Ionicons name="time-outline" size={26} color="rgba(255,255,255,0.75)" />
            <Text style={{ color: 'rgba(255,255,255,0.85)', marginTop: theme.spacing.sm, textAlign: 'center' }}>
              No shift is currently active
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: theme.spacing.lg }}>
            <FleetUtilizationRing value={summary.avgUtilization} running={summary.running} total={summary.total} />
          </View>
        )}
      </LinearGradient>

      <FlatList
        data={machines}
        keyExtractor={(item) => String(item.machine_id)}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.md }}>
            {!noActiveShift && (
              <FleetStatsCard total={summary.total} running={summary.running} idle={summary.idle} offline={summary.offline} />
            )}

            {error && (
              <Text style={{ fontSize: theme.type.caption, color: theme.colors.danger, marginTop: theme.spacing.sm }}>
                {error} — pull down to retry.
              </Text>
            )}

            {machines.length > 0 && (
              <Text style={{ fontSize: theme.type.caption, fontWeight: theme.weight.semibold as any, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
                MACHINES
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !noActiveShift ? (
            <Card style={{ alignItems: 'center', paddingVertical: theme.spacing.xxl }}>
              <Ionicons name="construct-outline" size={26} color={theme.colors.textMuted} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>No machines found</Text>
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <MachineRow
            item={item}
            onPress={() => navigation.navigate('MachineDetail', { machineId: item.machine_id, machineName: item.machine_serial_no })}
          />
        )}
      />
    </SafeAreaView>
  );
}
