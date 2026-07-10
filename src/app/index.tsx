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

import { connectAndFetchNovelRanking } from '@/lib/pixiv';

const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

export default function HomeScreen() {
  const [refreshToken, setRefreshToken] = useState('');
  const [novels, setNovels] = useState<PixivNovelItem[]>([]);
  const [status, setStatus] = useState('refresh tokenを入れて疎通確認しよう');
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenLoaded, setIsTokenLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedToken() {
      try {
        const savedToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

        if (isMounted && savedToken) {
          setRefreshToken(savedToken);
          setStatus('保存済みのrefresh tokenを読み込んだよ');
        }
      } catch {
        if (isMounted) {
          setStatus('SecureStoreを読めなかったので、tokenを手入力してね');
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

  async function handleConnect() {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setNovels([]);
    setStatus('Pixivへ接続中…');

    try {
      const result = await connectAndFetchNovelRanking(refreshToken);

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
            <Text style={styles.title}>まずはAPI疎通テスト</Text>
            <Text style={styles.description}>
              @book000/pixivtsをExpoから直接呼んで、小説デイリーランキングを取得する。
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Pixiv refresh token</Text>
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
              disabled={isLoading || !isTokenLoaded}
              onPress={() => {
                void handleConnect();
              }}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                (isLoading || !isTokenLoaded) && styles.buttonDisabled,
              ]}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>接続してランキング取得</Text>
              )}
            </Pressable>

            <Text style={styles.status}>{status}</Text>
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
                      {novel.textLength.toLocaleString()}文字・♡{novel.totalBookmarks.toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  label: {
    color: '#303842',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#D9E1E8',
    borderRadius: 13,
    backgroundColor: '#F9FBFC',
    color: '#20262E',
    fontSize: 15,
  },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#0096FA',
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
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
