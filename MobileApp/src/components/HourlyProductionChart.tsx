import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { HourlyProductionPoint } from '../types/chart';

const CHART_HEIGHT = 140;
const BAR_MAX_WIDTH = 22;
const BAR_GAP = 2;

// Rounds an axis max up to a "clean" step (1/2/5 × 10^n) — matches the
// dataviz spec's "round to clean numbers" rule for y-axis ticks.
function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function HourlyProductionChart({ data }: { data: HourlyProductionPoint[] }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const max = useMemo(() => niceMax(Math.max(...data.map((d) => d.produced), 0)), [data]);
  const peakIndex = useMemo(() => {
    if (!data.length) return -1;
    let idx = 0;
    for (let i = 1; i < data.length; i++) if (data[i].produced > data[idx].produced) idx = i;
    return data[idx].produced > 0 ? idx : -1;
  }, [data]);

  if (!data.length) {
    return (
      <View style={{ height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.type.caption }}>
          No production data for this shift yet
        </Text>
      </View>
    );
  }

  const barSlot = chartWidth > 0 ? chartWidth / data.length : 0;
  const barWidth = Math.max(4, Math.min(BAR_MAX_WIDTH, barSlot - BAR_GAP));
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const activeIndex = selected ?? peakIndex;
  const activePoint = activeIndex >= 0 ? data[activeIndex] : null;

  // Show every Nth hour label so labels don't collide when there are many bars.
  const labelStride = data.length > 12 ? Math.ceil(data.length / 8) : data.length > 6 ? 2 : 1;

  return (
    <View>
      {/* Selected/peak value callout — mobile's equivalent of a hover tooltip */}
      <View style={{ height: 20, marginBottom: theme.spacing.xs }}>
        {activePoint && (
          <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary }}>
            <Text style={{ fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary }}>
              {activePoint.produced}
            </Text>{' '}
            pcs at {activePoint.hour}
            {selected === null ? ' (peak)' : ''}
          </Text>
        )}
      </View>

      <View
        style={{ height: CHART_HEIGHT }}
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
      >
        {chartWidth > 0 && (
          <Svg width={chartWidth} height={CHART_HEIGHT}>
            {/* Gridlines — hairline, recessive, one step off the surface */}
            {gridSteps.map((g) => (
              <Line
                key={g}
                x1={0}
                x2={chartWidth}
                y1={CHART_HEIGHT * (1 - g) + 0.5}
                y2={CHART_HEIGHT * (1 - g) + 0.5}
                stroke={theme.colors.border}
                strokeWidth={1}
              />
            ))}

            {data.map((d, i) => {
              const x = i * barSlot + (barSlot - barWidth) / 2;
              const barHeight = d.produced > 0 && max > 0 ? Math.max(4, (d.produced / max) * (CHART_HEIGHT - 1)) : 0;
              const y = CHART_HEIGHT - barHeight;
              const isActive = i === activeIndex;

              return (
                <React.Fragment key={d.hour}>
                  <Rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    ry={4}
                    fill={isActive ? theme.colors.accent : theme.colors.accent}
                    opacity={isActive ? 1 : 0.55}
                  />
                  {/* Square off the bottom corners so the bar reads as
                      "4px rounded data-end, square at the baseline" */}
                  {barHeight > 4 && (
                    <Rect x={x} y={CHART_HEIGHT - 4} width={barWidth} height={4} fill={isActive ? theme.colors.accent : theme.colors.accent} opacity={isActive ? 1 : 0.55} />
                  )}
                  {i % labelStride === 0 && (
                    <SvgText
                      x={x + barWidth / 2}
                      y={CHART_HEIGHT + 14}
                      fontSize={10}
                      fill={theme.colors.textMuted}
                      textAnchor="middle"
                    >
                      {d.hour}
                    </SvgText>
                  )}
                </React.Fragment>
              );
            })}
          </Svg>
        )}

        {/* Transparent tap targets — bigger than the bar itself, per the
            skill's "hit target bigger than the mark" rule */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' }}>
          {data.map((d, i) => (
            <Pressable
              key={d.hour}
              style={{ flex: 1 }}
              onPress={() => setSelected(selected === i ? null : i)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
