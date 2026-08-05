import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 168;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function FleetUtilizationRing({
  value,
  running,
  total,
}: {
  value: number; // 0-100, average utilization across active machines
  running: number;
  total: number;
}) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(100, value));

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: pct,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDashoffset isn't a transform/opacity prop — native driver can't animate it
    }).start();
  }, [pct]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 100],
    outputRange: [CIRCUMFERENCE, 0],
  });

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          {/* Track — a lighter step of the same ramp, so state reads across the whole ring */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={theme.colors.surfaceAlt}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={theme.colors.accent}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE}, ${CIRCUMFERENCE}`}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>

        {/* Centered value — proportional figures, not tabular (display-size number) */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 40, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary, lineHeight: 42 }}>
              {Math.round(pct)}
            </Text>
            <Text style={{ fontSize: theme.type.bodyLarge, color: theme.colors.textMuted, marginBottom: 6, marginLeft: 1 }}>%</Text>
          </View>
          <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
            Fleet Utilization
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: theme.type.caption, color: theme.colors.textMuted, marginTop: theme.spacing.sm }}>
        <Text style={{ fontWeight: theme.weight.semibold as any, color: theme.colors.success }}>{running}</Text> of {total} machines running
      </Text>
    </View>
  );
}
