import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  parseNovelAjaxResponse,
  type NovelReaderContent,
} from '@/lib/pixiv';

interface PixivNovelAjaxLoaderProps {
  novelId: number;
  onSuccess: (content: NovelReaderContent) => void;
  onFailure: (error: Error) => void;
}

const AJAX_TIMEOUT_MS = 12_000;

/**
 * react-native-webviewが保持するPixivのログインcookieを使って、
 * www.pixiv.netの内部JSON APIを読むための不可視ブリッジ。
 */
export function PixivNovelAjaxLoader({
  novelId,
  onSuccess,
  onFailure,
}: PixivNovelAjaxLoaderProps) {
  const completedRef = useRef(false);
  const source = useMemo(
    () => ({
      uri: `https://www.pixiv.net/ajax/novel/${novelId}?lang=ja`,
      headers: {
        Accept: 'application/json',
        Referer: `https://www.pixiv.net/novel/show.php?id=${novelId}`,
      },
    }),
    [novelId],
  );

  function succeedOnce(content: NovelReaderContent) {
    if (completedRef.current) {
      return;
    }

    completedRef.current = true;
    onSuccess(content);
  }

  function failOnce(error: Error) {
    if (completedRef.current) {
      return;
    }

    completedRef.current = true;
    onFailure(error);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (completedRef.current) {
        return;
      }

      completedRef.current = true;
      onFailure(new Error('PixivのAJAX本文取得がタイムアウトしたよ'));
    }, AJAX_TIMEOUT_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [onFailure]);

  function handleMessage(event: WebViewMessageEvent) {
    try {
      succeedOnce(parseNovelAjaxResponse(event.nativeEvent.data, novelId));
    } catch (error) {
      failOnce(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return (
    <View pointerEvents="none" style={styles.hiddenContainer}>
      <WebView
        domStorageEnabled
        injectedJavaScript={`
          (function () {
            try {
              var text = document.body
                ? document.body.innerText
                : document.documentElement.innerText;
              window.ReactNativeWebView.postMessage(text || '');
            } catch (error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                error: true,
                message: String(error),
                body: null
              }));
            }
          })();
          true;
        `}
        javaScriptEnabled
        onError={({ nativeEvent }) => {
          failOnce(
            new Error(
              `PixivのAjaxページを開けなかったよ: ${nativeEvent.description}`,
            ),
          );
        }}
        onHttpError={({ nativeEvent }) => {
          failOnce(
            new Error(`PixivのAjax APIがHTTP ${nativeEvent.statusCode}を返したよ`),
          );
        }}
        onMessage={handleMessage}
        originWhitelist={['https://*']}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled
        source={source}
        thirdPartyCookiesEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenContainer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    overflow: 'hidden',
  },
});
