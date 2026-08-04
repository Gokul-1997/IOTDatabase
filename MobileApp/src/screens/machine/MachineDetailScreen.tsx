import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Card } from '../../components/Card';
import { Skeleton } from '../../components/Skeleton';
import { HourlyProductionChart } from '../../components/HourlyProductionChart';
import * as machineDetailApi from '../../api/machineDetail';
import * as chartApi from '../../api/chart';
import { MachineDetailResponse } from '../../types/machineDetail';
import { HourlyProductionPoint } from '../../types/chart';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MachineDetail'>;

const AUTO_REFRESH_MS = 15_000;

// Backend windows are IST-based (shift start/end times) — compute "today" in
// IST regardless of the device's own timezone, matching the web app.
function todayIST(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function statusColor(theme: ReturnType<typeof useTheme>, status: string) {
  if (status === 'RUNNING') return theme.colors.success;
  if (status === 'IDLE') return theme.colors.warning;
  return theme.colors.textMuted;
}

function statusBg(theme: ReturnType<typeof useTheme>, status: string) {
  if (status === 'RUNNING') return theme.colors.successBg;
  if (status === 'IDLE') return theme.colors.warningBg;
  return theme.colors.surfaceAlt;
}

function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        fontSize: theme.type.caption,
        fontWeight: theme.weight.semibold as any,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: theme.spacing.sm,
      }}
    >
      {children}
    </Text>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={{ marginBottom: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }}>{label}</Text>
        <Text style={{ fontSize: theme.type.caption, fontWeight: theme.weight.semibold as any, color: theme.colors.textPrimary, fontVariant: ['tabular-nums'] }}>
          {pct.toFixed(1)}%
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: theme.radius.pill, backgroundColor: color }} />
      </View>
    </View>
  );
}

function StatPair({ left, right }: { left: { label: string; value: string }; right: { label: string; value: string } }) {
  const theme = useTheme();
  const cell = (item: { label: string; value: string }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{item.label}</Text>
      <Text style={{ fontSize: theme.type.bodyLarge, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary, marginTop: 2, fontVariant: ['tabular-nums'] }}>
        {item.value}
      </Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row' }}>
      {cell(left)}
      {cell(right)}
    </View>
  );
}

function DetailSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
      <Skeleton width="100%" height={90} radius={theme.radius.lg} />
      <Skeleton width="100%" height={140} radius={theme.radius.lg} />
      <Skeleton width="100%" height={110} radius={theme.radius.lg} />
      <Skeleton width="100%" height={90} radius={theme.radius.lg} />
    </View>
  );
}

export function MachineDetailScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const { machineId, machineName } = route.params;

  const [detail, setDetail] = useState<MachineDetailResponse | null>(null);
  const [chartData, setChartData] = useState<HourlyProductionPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: machineName });
  }, [navigation, machineName]);

  const load = useCallback(async () => {
    try {
      const data = await machineDetailApi.getMachineDetail(machineId);
      setDetail(data);
      setError(null);

      if (data.shift.id != null) {
        try {
          const chart = await chartApi.getHourlyProduction(machineId, data.shift.id, todayIST());
          setChartData(chart.hourlyCount);
        } catch {
          // Chart is a secondary widget — a failure here shouldn't block the rest of the screen.
          setChartData(null);
        }
      } else {
        setChartData(null);
      }
    } catch {
      setError('Unable to load machine details.');
    }
  }, [machineId]);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
    const interval = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl }}>
          <Ionicons name="alert-circle-outline" size={28} color={theme.colors.textMuted} />
          <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.sm, textAlign: 'center' }}>
            {error ?? 'No data available'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = detail.live.machine_status;
  const color = statusColor(theme, status);
  const oeePct = Math.max(0, Math.min(100, detail.oee.oee));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
      >
        {/* Status + quick facts */}
        <Card style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: theme.type.subtitle, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary }} numberOfLines={1}>
              {detail.machine.name}
            </Text>
            <View
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 4,
                borderRadius: theme.radius.pill,
                backgroundColor: statusBg(theme, status),
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: theme.weight.bold as any, color, letterSpacing: 0.3 }}>{status}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }}>
              {detail.shift.shift_code} · {detail.operator.operator_name}
            </Text>
            <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }}>{detail.job.part_name}</Text>
          </View>
        </Card>

        {/* OEE — the headline metric */}
        <Card>
          <SectionLabel>Overall Equipment Effectiveness</SectionLabel>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
            <Text style={{ fontSize: 40, fontWeight: theme.weight.bold as any, color: theme.colors.accent, lineHeight: 42, fontVariant: ['tabular-nums'] }}>
              {oeePct.toFixed(1)}
            </Text>
            <Text style={{ fontSize: theme.type.bodyLarge, color: theme.colors.textMuted, marginBottom: 6 }}>%</Text>
          </View>
          <MetricBar label="Availability" value={detail.oee.availability} color={theme.colors.accent} />
          <MetricBar label="Performance" value={detail.oee.performance} color={theme.colors.accent} />
          <MetricBar label="Quality" value={detail.oee.quality} color={theme.colors.accent} />
        </Card>

        {/* Production */}
        <Card style={{ gap: theme.spacing.md }}>
          <SectionLabel>Production</SectionLabel>
          <StatPair left={{ label: 'Run Time', value: detail.production.run_time }} right={{ label: 'Idle Time', value: detail.production.idle_time }} />
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: theme.colors.textMuted }}>Achieved / Target</Text>
              <Text style={{ fontSize: 11, color: theme.colors.textSecondary, fontWeight: theme.weight.semibold as any }}>
                {detail.job.achieved_qty} / {detail.job.target_qty || '—'} pcs
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
              <View
                style={{
                  width: `${detail.job.target_qty > 0 ? Math.min(100, (detail.job.achieved_qty / detail.job.target_qty) * 100) : 0}%`,
                  height: '100%',
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.accent,
                }}
              />
            </View>
          </View>
        </Card>

        {/* Hourly production — trend for this shift */}
        {chartData && chartData.length > 0 && (
          <Card>
            <SectionLabel>Hourly Production</SectionLabel>
            <HourlyProductionChart data={chartData} />
          </Card>
        )}

        {/* Quality */}
        <Card>
          <SectionLabel>Quality</SectionLabel>
          <StatPair left={{ label: 'Accepted', value: String(detail.quality.accepted) }} right={{ label: 'Rejected', value: String(detail.quality.rejected) }} />
        </Card>

        {/* Power */}
        <Card>
          <SectionLabel>Energy</SectionLabel>
          <StatPair
            left={{ label: 'This Shift', value: `${detail.power.shift_kwh.toFixed(2)} kWh` }}
            right={{ label: 'Total', value: detail.power.total_kwh != null ? `${detail.power.total_kwh.toFixed(2)} kWh` : '—' }}
          />
        </Card>

        {/* Live readings — secondary, only while running */}
        {status === 'RUNNING' && (
          <Card>
            <SectionLabel>Live Readings</SectionLabel>
            <StatPair
              left={{ label: 'Spindle Load', value: `${detail.live.spindle_load.toFixed(0)}%` }}
              right={{ label: 'Feed Rate', value: `${detail.live.feed_rate.toFixed(0)}` }}
            />
          </Card>
        )}

        {error && (
          <Text style={{ fontSize: theme.type.caption, color: theme.colors.danger, textAlign: 'center' }}>{error}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
