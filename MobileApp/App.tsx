import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuthStore } from './src/store/authStore';
import { registerForPushNotificationsAsync } from './src/api/pushNotifications';

SplashScreen.preventAutoHideAsync().catch(() => {
  // No-op if already handled (e.g. fast refresh during development).
});

function AppShell() {
  const theme = useTheme();
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const status = useAuthStore((s) => s.status);
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    (async () => {
      await bootstrap();
      registerForPushNotificationsAsync().catch(() => {
        // Non-fatal — user can be re-prompted from Settings later.
      });
      setAppReady(true);
    })();
  }, [bootstrap]);

  const onLayoutRootView = useCallback(async () => {
    if (appReady && status !== 'checking') {
      await SplashScreen.hideAsync();
    }
  }, [appReady, status]);

  if (!appReady) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }} onLayout={onLayoutRootView}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <RootNavigator />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
