import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { subscribePixivRefreshToken } from '@/lib/pixiv';
import { AppThemeProvider, useAppTheme } from '@/theme';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootNavigator />
    </AppThemeProvider>
  );
}

function RootNavigator() {
  const { colors, isDark } = useAppTheme();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  useEffect(
    () =>
      subscribePixivRefreshToken((refreshToken) =>
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
      ),
    [],
  );

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: colors.background,
          },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="novel/detail/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen name="novel/[id]" options={{ animation: 'none' }} />
      </Stack>
    </>
  );
}
