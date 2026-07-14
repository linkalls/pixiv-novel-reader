import { useMemo, useState } from 'react';
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


interface PixivNovelInteractionModalProps {
  accent: string;
  background: string;
  border: string;
  muted: string;
  novelId: number;
  onClose: () => void;
  overlay: string;
  text: string;
  visible: boolean;
}

export function PixivNovelInteractionModal({
  accent,
  background,
  border,
  muted,
  novelId,
  onClose,
  text,
  visible,
}: PixivNovelInteractionModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, text }),
    [accent, background, border, muted, text],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="コメント・リアクションを閉じる"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.closeText}>閉じる</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>コメント・リアクション</Text>
            <Text style={styles.subtitle}>Pixivの作品ページをアプリ内表示</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.webContainer}>
          <WebView
            allowsBackForwardNavigationGestures
            domStorageEnabled
            javaScriptEnabled
            onError={(event) => {
              setLoadError(event.nativeEvent.description);
              setIsLoading(false);
            }}
            onLoadEnd={() => setIsLoading(false)}
            onLoadStart={() => {
              setIsLoading(true);
              setLoadError(null);
            }}
            originWhitelist={['https://*']}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            source={{
              uri: `https://www.pixiv.net/novel/show.php?id=${novelId}`,
            }}
            thirdPartyCookiesEnabled
            style={styles.webView}
          />
          {isLoading ? (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator color={accent} size="large" />
              <Text style={styles.loadingText}>Pixivを読み込み中…</Text>
            </View>
          ) : null}
          {loadError ? (
            <View pointerEvents="none" style={styles.errorOverlay}>
              <Text style={styles.errorTitle}>ページを表示できませんでした</Text>
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: {
  accent: string;
  background: string;
  border: string;
  muted: string;
  text: string;
}) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    header: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    closeButton: {
      minWidth: 58,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.border,
    },
    closeText: { color: colors.text, fontSize: 12, fontWeight: '900' },
    headerText: { flex: 1, alignItems: 'center', gap: 2 },
    title: { color: colors.text, fontSize: 14, fontWeight: '900' },
    subtitle: { color: colors.muted, fontSize: 9 },
    headerSpacer: { width: 58 },
    webContainer: { flex: 1 },
    webView: { flex: 1, backgroundColor: colors.background },
    loadingOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      backgroundColor: colors.background,
    },
    loadingText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
    errorOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 28,
      backgroundColor: colors.background,
    },
    errorTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
    errorText: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
    pressed: { opacity: 0.65 },
  });
}
