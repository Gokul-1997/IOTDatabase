import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, Platform } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// react-native-web's Animated drives updates through setNativeProps on the
// underlying DOM node; react-native-svg's web Circle doesn't support that
// for SVG presentation attributes (strokeDashoffset), so
// Animated.createAnimatedComponent(Circle) throws on mount in the web
// preview (verified: crashes at this component with expo ~57 / RN 0.86 /
// react-native-svg 15.15 / react-native-web 0.21). Native iOS/Android are
// unaffected — this only guards the web path, which is dev-preview-only
// (see api/secureTokenStore.ts's isWeb convention; the shipped app is native).
const isWeb = Platform.OS === 'web';

const SIZE = 168;
const STROKE = 14;
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
    if (isWeb) return;
    Animated.timing(progress, {
      toValue: pct,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // strokeDashoffset isn't a transform/opacity prop — native driver can't animate it
    }).start();
  }, [pct]);

  const staticDashoffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 100],
    outputRange: [CIRCUMFERENCE, 0],
  });

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          {/* Track — translucent white reads as "the same ramp, lighter step" against a colored hero */}
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="rgba(255,255,255,0.28)" strokeWidth={STROKE} fill="none" />
          {isWeb ? (
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke="#FFFFFF"
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${CIRCUMFERENCE}, ${CIRCUMFERENCE}`}
              strokeDashoffset={staticDashoffset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          ) : (
            <AnimatedCircle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke="#FFFFFF"
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${CIRCUMFERENCE}, ${CIRCUMFERENCE}`}
              strokeDashoffset={strokeDashoffset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
        </Svg>

        {/* Centered value — proportional figures, not tabular (display-size number) */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 40, fontWeight: theme.weight.bold as any, color: '#FFFFFF', lineHeight: 42 }}>{Math.round(pct)}</Text>
            <Text style={{ fontSize: theme.type.bodyLarge, color: 'rgba(255,255,255,0.8)', marginBottom: 6, marginLeft: 1 }}>%</Text>
          </View>
          <Text style={{ fontSize: theme.type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>Fleet Utilization</Text>
        </View>
      </View>

      <Text style={{ fontSize: theme.type.caption, color: 'rgba(255,255,255,0.75)', marginTop: theme.spacing.sm }}>
        <Text style={{ fontWeight: theme.weight.semibold as any, color: '#FFFFFF' }}>{running}</Text> of {total} machines running
      </Text>
    </View>
  );
}
