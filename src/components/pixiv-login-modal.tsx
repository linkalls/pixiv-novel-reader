import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import {
  createPixivOAuthSession,
  exchangePixivAuthorizationCode,
  PIXIV_WEBVIEW_USER_AGENT,
  type PixivOAuthSession,
} from '@/lib/pixiv-oauth';
import { extractPixivAuthorizationCode } from '@/lib/pixiv-oauth-url';
import { type AppColors, useAppTheme } from '@/theme';

interface PixivLoginModalProps {
  onClose: () => void;
  onSuccess: (refreshToken: string) => void | Promise<void>;
}

export function PixivLoginModal({
  onClose,
  onSuccess,
}: PixivLoginModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [session, setSession] = useState<PixivOAuthSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const capturedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function prepareSession() {
      try {
        const nextSession = await createPixivOAuthSession();

        if (isMounted) {
          setSession(nextSession);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(toErrorMessage(error));
        }
      }
    }

    void prepareSession();

    return () => {
      isMounted = false;
    };
  }, []);

  async function completeLogin(code: string) {
    if (!session || isExchanging || capturedCodeRef.current === code) {
      return;
    }

    capturedCodeRef.current = code;
    setIsExchanging(true);
    setErrorMessage(null);

    try {
      const tokenResponse = await exchangePixivAuthorizationCode(
        code,
        session.codeVerifier,
      );

      await onSuccess(tokenResponse.refreshToken);
    } catch (error) {
      capturedCodeRef.current = null;
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsExchanging(false);
    }
  }

  function inspectNavigation(url: string): boolean {
    const code = extractPixivAuthorizationCode(url);

    if (code) {
      void completeLogin(code);
      return false;
    }

    // WebViewがpixiv://を直接開こうとするとエラー画面になるので止める。
    if (url.startsWith('pixiv://')) {
      return false;
    }

    return true;
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            disabled={isExchanging}
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.closeButtonText}>閉じる</Text>
          </Pressable>

          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Pixivにログイン</Text>
            <Text style={styles.headerSubtitle}>
              パスワードはPixivのページへ直接入力される
            </Text>
          </View>
        </View>

        {errorMessage ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>ログインできなかった</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setErrorMessage(null);
                setSession(null);
                capturedCodeRef.current = null;
                void createPixivOAuthSession()
                  .then(setSession)
                  .catch((error: unknown) => {
                    setErrorMessage(toErrorMessage(error));
                  });
              }}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.retryButtonText}>もう一度試す</Text>
            </Pressable>
          </View>
        ) : session ? (
          <WebView
            applicationNameForUserAgent="PixivNovelReader/1.2"
            domStorageEnabled
            javaScriptEnabled
            onError={({ nativeEvent }) => {
              const code = extractPixivAuthorizationCode(nativeEvent.url);

              if (code) {
                void completeLogin(code);
                return;
              }

              if (!nativeEvent.url.startsWith('pixiv://')) {
                setErrorMessage(
                  `ログイン画面を読み込めなかったよ: ${nativeEvent.description}`,
                );
              }
            }}
            onNavigationStateChange={(navigationState) => {
              inspectNavigation(navigationState.url);
            }}
            onShouldStartLoadWithRequest={(request) =>
              inspectNavigation(request.url)
            }
            originWhitelist={['https://*', 'http://*', 'pixiv://*']}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            source={{
              uri: session.loginUrl,
            }}
            startInLoadingState
            thirdPartyCookiesEnabled
            userAgent={PIXIV_WEBVIEW_USER_AGENT}
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.loadingText}>ログイン画面を準備中…</Text>
          </View>
        )}

        {isExchanging && (
          <View style={styles.exchangeOverlay}>
            <View style={styles.exchangeCard}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.exchangeTitle}>ログイン処理中</Text>
              <Text style={styles.exchangeText}>
                Pixivの認証コードをrefresh tokenへ交換してるよ
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  closeButton: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
  },
  closeButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  headerTextContainer: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
  },
  errorMessage: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 180,
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: colors.accent,
  },
  retryButtonText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: '800',
  },
  exchangeOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: colors.overlay,
  },
  exchangeCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 12,
    padding: 24,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  exchangeTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  exchangeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  });
}
