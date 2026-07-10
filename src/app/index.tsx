import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PixivNovelItem } from '@book000/pixivts';

import { PixivLoginModal } from '@/components/pixiv-login-modal';
import { connectAndFetchNovelRanking } from '@/lib/pixiv';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

export default function HomeScreen() {
  const [refreshToken, setRefreshToken] = useState('');
  const [novels, setNovels] = useState<PixivNovelItem[]>([]);
  const [status, setStatus] = useState('Pixivへログインして疎通確認しよう');
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenLoaded, setIsTokenLoaded] = useState(false);
  const [isLoginVisible, setIsLoginVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedToken() {
      try {
        const savedToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

        if (isMounted && savedToken) {
          setRefreshToken(savedToken);
          setStatus('保存済みのログイン情報を読み込んだよ');
        }
      } catch {
        if (isMounted) {
          setStatus('SecureStoreを読めなかったので、もう一度ログインしてね');
        }
      } finally {
        if (isMounted) {
          setIsTokenLoaded(true);
        }
      }
    }

    void loadSavedToken();

    return () => {
      isMounted = false;
    };
  }, []);

  async function connectWithToken(token: string) {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setNovels([]);
    setStatus('Pixivへ接続中…');

    try {
      const result = await connectAndFetchNovelRanking(token);

      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, result.refreshToken);
      setRefreshToken(result.refreshToken);
      setNovels(result.novels.slice(0, 10));
      setStatus(
        `接続成功！ userId=${result.userId} / 小説ランキング${result.novels.length}件を取得`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`接続失敗: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleWebViewLoginSuccess(token: string) {
    setIsLoginVisible(false);
    setRefreshToken(token);
    await connectWithToken(token);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>PIXIV NOVEL READER</Text>
            <Text style={styles.title}>Pixiv小説を、読むためのアプリ。</Text>
            <Text style={styles.description}>
              アプリ内のPixivログイン画面から認証して、小説ランキングを取得する。
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pixivアカウント</Text>
            <Text style={styles.cardDescription}>
              IDとパスワードはPixivのWebViewへ直接入力される。アプリが保存するのはrefresh tokenだけ。
            </Text>

            <Pressable
              accessibilityRole="button"
              disabled={isLoading || !isTokenLoaded}
              onPress={() => {
                setIsLoginVisible(true);
              }}
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.buttonPressed,
                (isLoading || !isTokenLoaded) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.loginButtonText}>Pixivでログイン</Text>
            </Pressable>

            {refreshToken.length > 0 && (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={() => {
                  void connectWithToken(refreshToken);
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                  isLoading && styles.buttonDisabled,
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#0096FA" />
                ) : (
                  <Text style={styles.secondaryButtonText}>
                    保存済みログインで再接続
                  </Text>
                )}
              </Pressable>
            )}

            <Text style={styles.status}>{status}</Text>
          </View>

          <View style={styles.fallbackCard}>
            <Text style={styles.fallbackTitle}>手動token入力</Text>
            <Text style={styles.fallbackDescription}>
              WebViewログインが使えない場合だけ使う予備ルート。
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading && isTokenLoaded}
              onChangeText={setRefreshToken}
              placeholder="refresh tokenを貼り付け"
              placeholderTextColor="#8D96A0"
              secureTextEntry
              selectionColor="#0096FA"
              style={styles.input}
              value={refreshToken}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isLoading || refreshToken.trim().length === 0}
              onPress={() => {
                void connectWithToken(refreshToken);
              }}
              style={({ pressed }) => [
                styles.manualButton,
                pressed && styles.buttonPressed,
                (isLoading || refreshToken.trim().length === 0) &&
                  styles.buttonDisabled,
              ]}
            >
              <Text style={styles.manualButtonText}>tokenで接続</Text>
            </Pressable>
          </View>

          {novels.length > 0 && (
            <View style={styles.resultsSection}>
              <Text style={styles.sectionTitle}>デイリーランキング</Text>

              {novels.map((novel, index) => (
                <View key={novel.id} style={styles.novelCard}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankText}>{index + 1}</Text>
                  </View>

                  <View style={styles.novelBody}>
                    <Text numberOfLines={2} style={styles.novelTitle}>
                      {novel.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.author}>
                      {novel.user.name}
                    </Text>
                    <Text style={styles.metadata}>
                      {novel.textLength.toLocaleString()}文字・♡
                      {novel.totalBookmarks.toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {isLoginVisible && (
        <PixivLoginModal
          onClose={() => {
            setIsLoginVisible(false);
          }}
          onSuccess={handleWebViewLoginSuccess}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7FA',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 120,
    gap: 24,
  },
  hero: {
    gap: 8,
  },
  eyebrow: {
    color: '#0096FA',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: '#20262E',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.7,
    lineHeight: 39,
  },
  description: {
    color: '#65717D',
    fontSize: 15,
    lineHeight: 23,
  },
  card: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    gap: 13,
    shadowColor: '#15202B',
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  cardTitle: {
    color: '#303842',
    fontSize: 18,
    fontWeight: '800',
  },
  cardDescription: {
    color: '#65717D',
    fontSize: 13,
    lineHeight: 20,
  },
  loginButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#0096FA',
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#A9DBFC',
    borderRadius: 14,
    backgroundColor: '#F2FAFF',
  },
  secondaryButtonText: {
    color: '#0088E5',
    fontSize: 14,
    fontWeight: '800',
  },
  fallbackCard: {
    padding: 17,
    borderWidth: 1,
    borderColor: '#DDE5EB',
    borderRadius: 18,
    backgroundColor: '#F9FBFC',
    gap: 11,
  },
  fallbackTitle: {
    color: '#3B4650',
    fontSize: 15,
    fontWeight: '800',
  },
  fallbackDescription: {
    color: '#74808A',
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#D9E1E8',
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    color: '#20262E',
    fontSize: 15,
  },
  manualButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#35404A',
  },
  manualButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  status: {
    color: '#596570',
    fontSize: 13,
    lineHeight: 20,
  },
  resultsSection: {
    gap: 12,
  },
  sectionTitle: {
    color: '#20262E',
    fontSize: 20,
    fontWeight: '800',
  },
  novelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  rankBadge: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#E5F5FF',
  },
  rankText: {
    color: '#0088E5',
    fontSize: 15,
    fontWeight: '900',
  },
  novelBody: {
    flex: 1,
    gap: 3,
  },
  novelTitle: {
    color: '#252B33',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  author: {
    color: '#66727E',
    fontSize: 13,
  },
  metadata: {
    color: '#8A949E',
    fontSize: 12,
  },
});
