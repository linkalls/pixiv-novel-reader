import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { runAutomaticBackupIfDue } from '@/lib/app-backup';
import { registerBackgroundSync } from '@/lib/background-sync';
import { configureAppNotifications } from '@/lib/app-notifications';
import {
  setPixivRefreshTokenLoader,
  subscribePixivRefreshToken,
} from '@/lib/pixiv';
import { AppThemeProvider, useAppTheme } from '@/theme';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

setPixivRefreshTokenLoader(() =>
  SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
);

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ resetOnBackground: false }}>
      <AppThemeProvider>
        <RootNavigator />
      </AppThemeProvider>
    </ShareIntentProvider>
  );
}

function RootNavigator() {
  const { colors, isDark } = useAppTheme();
  const router = useRouter();
  const linkingUrl = Linking.useLinkingURL();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const lastHandledValueRef = useRef<string | null>(null);

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

  useEffect(() => {
    void configureAppNotifications().catch(() => {});
    void registerBackgroundSync().catch(() => {});
    void runAutomaticBackupIfDue().catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void runAutomaticBackupIfDue().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const novelId = extractPixivNovelId(linkingUrl);
    if (!novelId || lastHandledValueRef.current === `link:${novelId}`) {
      return;
    }

    lastHandledValueRef.current = `link:${novelId}`;
    router.push({
      pathname: '/novel/detail/[id]',
      params: { id: String(novelId) },
    });
  }, [linkingUrl, router]);

  useEffect(() => {
    if (!hasShareIntent) {
      return;
    }

    const sharedValue = shareIntent.webUrl ?? shareIntent.text ?? '';
    const novelId = extractPixivNovelId(sharedValue);
    if (novelId && lastHandledValueRef.current !== `share:${novelId}`) {
      lastHandledValueRef.current = `share:${novelId}`;
      router.push({
        pathname: '/novel/detail/[id]',
        params: { id: String(novelId) },
      });
    }
    resetShareIntent();
  }, [hasShareIntent, resetShareIntent, router, shareIntent.text, shareIntent.webUrl]);

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

function extractPixivNovelId(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?pixiv\.net\/novel\/show\.php\?[^\s#]*\bid=(\d+)/i,
    /pixivnovelreader:\/\/(?:novel\/)?(?:detail\/)?(\d+)/i,
    /pixivnovelreader:\/\/novel\/detail\/(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}
