import type { PixivNovelItem } from '@book000/pixivts';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import * as SystemUI from 'expo-system-ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PixivNovelAjaxLoader } from '@/components/pixiv-novel-ajax-loader';
import { parseNovelBlocks, type NovelBlock } from '@/lib/novel-format';
import {
  fetchNovelDetail,
  fetchNovelText,
  fetchRelatedNovels,
  setNovelBookmark,
  type NovelReaderContent,
} from '@/lib/pixiv';
import { useAppTheme } from '@/theme';

const READER_SETTINGS_KEY = 'pixiv-reader-settings-v1';
const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';

type ReaderThemeName = 'white' | 'gray' | 'black' | 'blue' | 'yellow';
type ReaderFontSize = 'small' | 'normal' | 'large';
type ReaderLineSpacing = 'narrow' | 'wide';

interface ReaderSettings {
  theme: ReaderThemeName;
  fontSize: ReaderFontSize;
  lineSpacing: ReaderLineSpacing;
}

interface ReaderPalette {
  background: string;
  toolbar: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  overlay: string;
  isDark: boolean;
}

const READER_THEMES: Record<ReaderThemeName, ReaderPalette> = {
  white: {
    background: '#FFFFFF',
    toolbar: '#FFFFFF',
    text: '#252525',
    muted: '#747474',
    border: '#E5E5E5',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
  gray: {
    background: '#EEEEEE',
    toolbar: '#F5F5F5',
    text: '#292929',
    muted: '#6E6E6E',
    border: '#D2D2D2',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
  black: {
    background: '#101010',
    toolbar: '#181818',
    text: '#E9E9E9',
    muted: '#9D9D9D',
    border: '#303030',
    accent: '#29A8FF',
    overlay: 'rgba(0, 0, 0, 0.72)',
    isDark: true,
  },
  blue: {
    background: '#EAF7FC',
    toolbar: '#F2FBFE',
    text: '#26343A',
    muted: '#6A7D85',
    border: '#CDE3EC',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
  yellow: {
    background: '#FFF7DC',
    toolbar: '#FFF9E8',
    text: '#3A3325',
    muted: '#81745A',
    border: '#E8DDBD',
    accent: '#0096FA',
    overlay: 'rgba(0, 0, 0, 0.44)',
    isDark: false,
  },
};

const THEME_OPTIONS: { value: ReaderThemeName; label: string }[] = [
  { value: 'white', label: '白' },
  { value: 'gray', label: '灰' },
  { value: 'black', label: '黒' },
  { value: 'blue', label: '青' },
  { value: 'yellow', label: '黄' },
];

const FONT_SIZE_VALUES: Record<ReaderFontSize, number> = {
  small: 15,
  normal: 18,
  large: 22,
};

const LINE_HEIGHT_RATIOS: Record<ReaderLineSpacing, number> = {
  narrow: 1.72,
  wide: 2.08,
};

export default function NovelReaderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const { colors, isDark: isAppDark } = useAppTheme();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const novelId = Number(rawId);
  const isValidNovelId = Number.isInteger(novelId) && novelId > 0;

  const [detail, setDetail] = useState<PixivNovelItem | null>(null);
  const [readerContent, setReaderContent] =
    useState<NovelReaderContent | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(isValidNovelId);
  const [isTextLoading, setIsTextLoading] = useState(isValidNovelId);
  const [isAjaxLoading, setIsAjaxLoading] = useState(isValidNovelId);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
  const [ajaxAttempt, setAjaxAttempt] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isValidNovelId ? null : '作品IDを読み取れなかったよ',
  );
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isMoreVisible, setIsMoreVisible] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [relatedNovels, setRelatedNovels] = useState<PixivNovelItem[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(isValidNovelId);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [relatedAttempt, setRelatedAttempt] = useState(1);
  const [settings, setSettings] = useState<ReaderSettings>({
    theme: isAppDark ? 'black' : 'white',
    fontSize: 'normal',
    lineSpacing: 'wide',
  });
  const fallbackStartedRef = useRef(false);
  const readerEndOffsetRef = useRef<number | null>(null);

  const palette = READER_THEMES[settings.theme];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const blocks = useMemo(
    () => (readerContent ? parseNovelBlocks(readerContent.text) : []),
    [readerContent],
  );
  const fontSize = FONT_SIZE_VALUES[settings.fontSize];
  const lineHeight = Math.round(
    fontSize * LINE_HEIGHT_RATIOS[settings.lineSpacing],
  );

  useEffect(() => {
    let isMounted = true;

    async function restoreSettings() {
      const rawSettings = await SecureStore.getItemAsync(
        READER_SETTINGS_KEY,
      ).catch(() => null);

      if (!isMounted || !rawSettings) {
        return;
      }

      try {
        const parsed = JSON.parse(rawSettings) as Partial<ReaderSettings>;
        const theme = isReaderTheme(parsed.theme) ? parsed.theme : settings.theme;
        const nextFontSize = isReaderFontSize(parsed.fontSize)
          ? parsed.fontSize
          : 'normal';
        const lineSpacing = isReaderLineSpacing(parsed.lineSpacing)
          ? parsed.lineSpacing
          : 'wide';

        setSettings({
          theme,
          fontSize: nextFontSize,
          lineSpacing,
        });
      } catch {
        // 壊れた設定値は無視し、既定値で読める状態を優先する。
      }
    }

    void restoreSettings();

    return () => {
      isMounted = false;
    };
    // 初回だけ復元する。端末テーマ変更はアプリ全体の設定画面に任せる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.background).catch(() => {});

    return () => {
      void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
    };
  }, [colors.background, palette.background]);

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId) {
      return () => {
        isMounted = false;
      };
    }

    async function loadDetail() {
      try {
        const nextDetail = await fetchNovelDetail(novelId);

        if (isMounted) {
          setDetail(nextDetail);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(toErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [isValidNovelId, novelId]);

  useEffect(() => {
    let isMounted = true;

    if (!isValidNovelId) {
      return () => {
        isMounted = false;
      };
    }

    async function loadRelatedNovels() {
      try {
        const result = await fetchRelatedNovels(novelId);

        if (!isMounted) {
          return;
        }

        await SecureStore.setItemAsync(
          REFRESH_TOKEN_KEY,
          result.refreshToken,
        ).catch(() => {});

        if (!isMounted) {
          return;
        }

        setRelatedNovels(
          result.novels
            .filter((novel) => novel.id !== novelId)
            .slice(0, 12),
        );
        setRelatedError(null);
      } catch (error) {
        if (isMounted) {
          setRelatedError(toErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsRelatedLoading(false);
        }
      }
    }

    void loadRelatedNovels();

    return () => {
      isMounted = false;
    };
  }, [isValidNovelId, novelId, relatedAttempt]);

  const handleAjaxSuccess = useCallback((content: NovelReaderContent) => {
    setReaderContent(content);
    setIsAjaxLoading(false);
    setIsTextLoading(false);
    setErrorMessage(null);
  }, []);

  const handleAjaxFailure = useCallback(
    async (ajaxError: Error) => {
      if (fallbackStartedRef.current || !isValidNovelId) {
        return;
      }

      fallbackStartedRef.current = true;
      setIsAjaxLoading(false);

      try {
        const content = await fetchNovelText(novelId);
        setReaderContent(content);
        setErrorMessage(null);
      } catch (fallbackError) {
        setErrorMessage(
          `${ajaxError.message}\n${toErrorMessage(fallbackError)}`,
        );
      } finally {
        setIsTextLoading(false);
      }
    },
    [isValidNovelId, novelId],
  );

  function updateSettings(nextSettings: ReaderSettings) {
    setSettings(nextSettings);
    void SecureStore.setItemAsync(
      READER_SETTINGS_KEY,
      JSON.stringify(nextSettings),
    ).catch(() => {});
  }

  function retryReader() {
    if (!isValidNovelId) {
      return;
    }

    fallbackStartedRef.current = false;
    setReaderContent(null);
    setErrorMessage(null);
    setIsTextLoading(true);
    setIsAjaxLoading(true);
    setAjaxAttempt((current) => current + 1);
  }

  async function toggleBookmark() {
    if (!detail || isBookmarkLoading) {
      return;
    }

    setIsBookmarkLoading(true);
    setErrorMessage(null);

    try {
      const shouldBookmark = !detail.isBookmarked;
      const refreshToken = await setNovelBookmark(detail.id, shouldBookmark);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      setDetail({
        ...detail,
        isBookmarked: shouldBookmark,
        totalBookmarks: Math.max(
          0,
          detail.totalBookmarks + (shouldBookmark ? 1 : -1),
        ),
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsBookmarkLoading(false);
    }
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const fallbackMaximumOffset = contentSize.height - layoutMeasurement.height;
    const readerEndOffset = readerEndOffsetRef.current;
    const readingMaximumOffset =
      readerEndOffset === null
        ? fallbackMaximumOffset
        : readerEndOffset - layoutMeasurement.height + 76;

    setScrollProgress(
      readingMaximumOffset <= 0
        ? 1
        : Math.max(
            0,
            Math.min(1, contentOffset.y / readingMaximumOffset),
          ),
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />

      {isAjaxLoading && isValidNovelId && (
        <PixivNovelAjaxLoader
          key={`${novelId}-${ajaxAttempt}`}
          novelId={novelId}
          onFailure={(error) => {
            void handleAjaxFailure(error);
          }}
          onSuccess={handleAjaxSuccess}
        />
      )}

      <View style={styles.toolbar}>
        <View style={styles.toolbarSide}>
          <ToolbarSymbolButton
            accessibilityLabel="前の画面へ戻る"
            androidName="arrow_back"
            iosName="chevron.left"
            onPress={() => {
              router.back();
            }}
            palette={palette}
            size={27}
          />
        </View>
        <View style={styles.toolbarTitleArea}>
          <Text numberOfLines={1} style={styles.toolbarTitle}>
            {readerContent?.title ?? detail?.title ?? '小説'}
          </Text>
        </View>
        <View style={[styles.toolbarSide, styles.toolbarSideRight]}>
          <ToolbarSymbolButton
            accessibilityLabel={
              detail?.isBookmarked
                ? 'ブックマークを解除する'
                : 'ブックマークする'
            }
            androidName={detail?.isBookmarked ? 'bookmark' : 'bookmark_border'}
            disabled={!detail || isBookmarkLoading}
            iosName={detail?.isBookmarked ? 'bookmark.fill' : 'bookmark'}
            onPress={() => {
              void toggleBookmark();
            }}
            palette={palette}
            size={26}
          />
          <ToolbarSymbolButton
            accessibilityLabel="その他の操作"
            androidName="more_horiz"
            iosName="ellipsis"
            onPress={() => {
              setIsMoreVisible(true);
            }}
            palette={palette}
            size={27}
          />
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressValue,
            { width: `${Math.round(scrollProgress * 100)}%` },
          ]}
        />
      </View>

      {isTextLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} size="large" />
          <Text style={styles.loadingText}>本文を読み込んでる…</Text>
        </View>
      ) : readerContent ? (
        <ScrollView
          contentContainerStyle={styles.readerContent}
          onScroll={handleScroll}
          scrollEventThrottle={80}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.workHeader}>
            {readerContent.seriesTitle ? (
              <Text style={styles.seriesTitle}>
                {readerContent.seriesTitle}
              </Text>
            ) : null}
            <Text selectable style={styles.workTitle}>
              {readerContent.title ?? detail?.title ?? '無題'}
            </Text>
            {detail ? (
              <>
                <Text style={styles.authorName}>{detail.user.name}</Text>
                <Text style={styles.workMeta}>
                  {detail.textLength.toLocaleString()}字　・　
                  {new Date(detail.createDate).toLocaleDateString('ja-JP')}
                </Text>
              </>
            ) : isDetailLoading ? (
              <ActivityIndicator color={palette.accent} size="small" />
            ) : null}
          </View>

          <View style={styles.titleDivider} />

          <View style={styles.novelBody}>
            {blocks.map((block, index) => (
              <NovelBlockView
                block={block}
                embeddedImages={readerContent.embeddedImages}
                fontSize={fontSize}
                key={`${block.type}-${index}`}
                lineHeight={lineHeight}
                palette={palette}
                styles={styles}
              />
            ))}
          </View>

          <View
            onLayout={(event) => {
              const { height, y } = event.nativeEvent.layout;
              readerEndOffsetRef.current = y + height;
            }}
            style={styles.readerEnd}
          >
            <Text style={styles.readerEndMark}>◆</Text>
            <Text style={styles.readerEndText}>読了</Text>
          </View>

          <RelatedNovelsSection
            error={relatedError}
            isLoading={isRelatedLoading}
            novels={relatedNovels}
            onNovelPress={(relatedNovelId) => {
              router.push({
                pathname: '/novel/[id]',
                params: { id: String(relatedNovelId) },
              });
            }}
            onRetry={() => {
              setIsRelatedLoading(true);
              setRelatedError(null);
              setRelatedAttempt((current) => current + 1);
            }}
            palette={palette}
            styles={styles}
          />
        </ScrollView>
      ) : (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>本文を表示できなかった</Text>
          <Text style={styles.errorText}>
            {errorMessage ?? '本文を読み込めなかったよ'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={retryReader}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryButtonText}>もう一度読み込む</Text>
          </Pressable>
        </View>
      )}

      {readerContent ? (
        <View style={styles.floatingControls}>
          <View style={styles.progressPill}>
            <Text style={styles.progressPercent}>
              {Math.round(scrollProgress * 100)}%
            </Text>
          </View>
          <Pressable
            accessibilityLabel="表示設定を開く"
            accessibilityRole="button"
            onPress={() => {
              setIsSettingsVisible(true);
            }}
            style={({ pressed }) => [
              styles.displayButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.displayButtonAa}>Aa</Text>
            <Text style={styles.displayButtonLabel}>表示</Text>
          </Pressable>
        </View>
      ) : null}

      <ReaderSettingsModal
        onChange={updateSettings}
        onClose={() => {
          setIsSettingsVisible(false);
        }}
        palette={palette}
        settings={settings}
        visible={isSettingsVisible}
      />

      <MoreActionsModal
        onClose={() => {
          setIsMoreVisible(false);
        }}
        onOpenPixiv={() => {
          setIsMoreVisible(false);
          void Linking.openURL(
            `https://www.pixiv.net/novel/show.php?id=${novelId}`,
          );
        }}
        onReload={() => {
          setIsMoreVisible(false);
          retryReader();
        }}
        onReturn={() => {
          setIsMoreVisible(false);
          router.back();
        }}
        palette={palette}
        visible={isMoreVisible}
      />
    </SafeAreaView>
  );
}

interface RelatedNovelsSectionProps {
  error: string | null;
  isLoading: boolean;
  novels: PixivNovelItem[];
  onNovelPress: (novelId: number) => void;
  onRetry: () => void;
  palette: ReaderPalette;
  styles: ReturnType<typeof createStyles>;
}

function RelatedNovelsSection({
  error,
  isLoading,
  novels,
  onNovelPress,
  onRetry,
  palette,
  styles,
}: RelatedNovelsSectionProps) {
  return (
    <View style={styles.relatedSection}>
      <View style={styles.relatedHeadingRow}>
        <View style={styles.relatedHeadingText}>
          <Text style={styles.relatedEyebrow}>NEXT READ</Text>
          <Text style={styles.relatedTitle}>次に読む</Text>
        </View>
        {!isLoading && novels.length > 0 ? (
          <Text style={styles.relatedCount}>{novels.length}作品</Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.relatedLoading}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.relatedMuted}>関連作品を探してる…</Text>
        </View>
      ) : error ? (
        <View style={styles.relatedErrorCard}>
          <Text style={styles.relatedErrorText} numberOfLines={3}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.relatedRetryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.relatedRetryText}>再読み込み</Text>
          </Pressable>
        </View>
      ) : novels.length === 0 ? (
        <Text style={styles.relatedMuted}>関連作品は見つからなかったよ</Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.relatedList}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
        >
          {novels.map((novel) => (
            <Pressable
              accessibilityLabel={`${novel.title}を読む`}
              accessibilityRole="button"
              key={novel.id}
              onPress={() => {
                onNovelPress(novel.id);
              }}
              style={({ pressed }) => [
                styles.relatedCard,
                pressed && styles.relatedCardPressed,
              ]}
            >
              <Image
                contentFit="cover"
                source={{
                  uri:
                    novel.imageUrls.medium ||
                    novel.imageUrls.squareMedium,
                  headers: {
                    Referer: 'https://app-api.pixiv.net/',
                  },
                }}
                style={styles.relatedCover}
                transition={160}
              />
              <View style={styles.relatedCardBody}>
                <Text numberOfLines={2} style={styles.relatedCardTitle}>
                  {novel.title}
                </Text>
                <Text numberOfLines={1} style={styles.relatedAuthor}>
                  {novel.user.name}
                </Text>
                <View style={styles.relatedMetaRow}>
                  <Text style={styles.relatedMeta}>
                    {novel.textLength.toLocaleString()}字
                  </Text>
                  <Text style={styles.relatedMeta}>
                    ♡ {novel.totalBookmarks.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.relatedReadRow}>
                  <Text style={styles.relatedReadText}>読む</Text>
                  <Text style={styles.relatedArrow}>›</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface ToolbarSymbolButtonProps {
  accessibilityLabel: string;
  androidName: 'arrow_back' | 'bookmark' | 'bookmark_border' | 'more_horiz';
  disabled?: boolean;
  iosName: 'chevron.left' | 'bookmark' | 'bookmark.fill' | 'ellipsis';
  onPress: () => void;
  palette: ReaderPalette;
  size: number;
}

function ToolbarSymbolButton({
  accessibilityLabel,
  androidName,
  disabled = false,
  iosName,
  onPress,
  palette,
  size,
}: ToolbarSymbolButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        toolbarStyles.button,
        pressed && toolbarStyles.pressed,
        disabled && toolbarStyles.disabled,
      ]}
    >
      <SymbolView
        fallback={<Text style={{ color: palette.text, fontSize: size }}>●</Text>}
        name={{ ios: iosName, android: androidName }}
        size={size}
        tintColor={palette.text}
      />
    </Pressable>
  );
}

interface NovelBlockViewProps {
  block: NovelBlock;
  embeddedImages: Record<string, string>;
  fontSize: number;
  lineHeight: number;
  palette: ReaderPalette;
  styles: ReturnType<typeof createStyles>;
}

function NovelBlockView({
  block,
  embeddedImages,
  fontSize,
  lineHeight,
  palette,
  styles,
}: NovelBlockViewProps) {
  switch (block.type) {
    case 'text':
      return (
        <Text
          selectable
          style={[
            styles.bodyText,
            {
              fontSize,
              lineHeight,
            },
          ]}
        >
          {block.text}
        </Text>
      );
    case 'chapter':
      return (
        <Text selectable style={styles.chapterTitle}>
          {block.title}
        </Text>
      );
    case 'pagebreak':
      return (
        <View accessibilityLabel="改ページ" style={styles.pageBreak}>
          <View style={styles.pageBreakLine} />
          <Text style={styles.pageBreakMark}>◆</Text>
          <View style={styles.pageBreakLine} />
        </View>
      );
    case 'image': {
      const uri = embeddedImages[block.id];

      if (!uri) {
        return (
          <View style={styles.imageFallback}>
            <Text style={styles.imageFallbackText}>挿絵 {block.id}</Text>
          </View>
        );
      }

      return (
        <Image
          contentFit="contain"
          source={{
            uri,
            headers: {
              Referer: 'https://www.pixiv.net/',
            },
          }}
          style={[styles.embeddedImage, { backgroundColor: palette.toolbar }]}
          transition={180}
        />
      );
    }
    case 'jump':
      return <Text style={styles.jumpText}>─ {block.label} ─</Text>;
  }
}

interface ReaderSettingsModalProps {
  onChange: (settings: ReaderSettings) => void;
  onClose: () => void;
  palette: ReaderPalette;
  settings: ReaderSettings;
  visible: boolean;
}

function ReaderSettingsModal({
  onChange,
  onClose,
  palette,
  settings,
  visible,
}: ReaderSettingsModalProps) {
  const styles = useMemo(() => createSheetStyles(palette), [palette]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>表示設定</Text>
            <Pressable
              accessibilityLabel="表示設定を閉じる"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>テーマ</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((option) => {
              const optionPalette = READER_THEMES[option.value];
              const isActive = settings.theme === option.value;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  key={option.value}
                  onPress={() => {
                    onChange({ ...settings, theme: option.value });
                  }}
                  style={({ pressed }) => [
                    styles.themeOption,
                    {
                      backgroundColor: optionPalette.background,
                      borderColor: isActive
                        ? palette.accent
                        : optionPalette.border,
                    },
                    isActive && styles.themeOptionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.themeOptionText,
                      { color: optionPalette.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.optionColumns}>
            <View style={styles.optionColumn}>
              <Text style={styles.sectionLabel}>文字サイズ</Text>
              <RadioOption
                active={settings.fontSize === 'small'}
                label="小"
                onPress={() => {
                  onChange({ ...settings, fontSize: 'small' });
                }}
                palette={palette}
              />
              <RadioOption
                active={settings.fontSize === 'normal'}
                label="普通"
                onPress={() => {
                  onChange({ ...settings, fontSize: 'normal' });
                }}
                palette={palette}
              />
              <RadioOption
                active={settings.fontSize === 'large'}
                label="大"
                onPress={() => {
                  onChange({ ...settings, fontSize: 'large' });
                }}
                palette={palette}
              />
            </View>

            <View style={styles.optionColumn}>
              <Text style={styles.sectionLabel}>行間</Text>
              <RadioOption
                active={settings.lineSpacing === 'narrow'}
                label="せまい"
                onPress={() => {
                  onChange({ ...settings, lineSpacing: 'narrow' });
                }}
                palette={palette}
              />
              <RadioOption
                active={settings.lineSpacing === 'wide'}
                label="広い"
                onPress={() => {
                  onChange({ ...settings, lineSpacing: 'wide' });
                }}
                palette={palette}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface RadioOptionProps {
  active: boolean;
  label: string;
  onPress: () => void;
  palette: ReaderPalette;
}

function RadioOption({ active, label, onPress, palette }: RadioOptionProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [
        radioStyles.row,
        pressed && radioStyles.pressed,
      ]}
    >
      <View
        style={[
          radioStyles.circle,
          { borderColor: active ? palette.accent : palette.muted },
        ]}
      >
        {active ? (
          <View
            style={[radioStyles.circleFill, { backgroundColor: palette.accent }]}
          />
        ) : null}
      </View>
      <Text style={[radioStyles.label, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

interface MoreActionsModalProps {
  onClose: () => void;
  onOpenPixiv: () => void;
  onReload: () => void;
  onReturn: () => void;
  palette: ReaderPalette;
  visible: boolean;
}

function MoreActionsModal({
  onClose,
  onOpenPixiv,
  onReload,
  onReturn,
  palette,
  visible,
}: MoreActionsModalProps) {
  const styles = useMemo(() => createSheetStyles(palette), [palette]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.actionSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>その他</Text>
          <SheetAction label="Pixivで作品を開く" onPress={onOpenPixiv} palette={palette} />
          <SheetAction label="本文を再読み込み" onPress={onReload} palette={palette} />
          <SheetAction label="読書画面を閉じる" onPress={onReturn} palette={palette} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({
  label,
  onPress,
  palette,
}: {
  label: string;
  onPress: () => void;
  palette: ReaderPalette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        actionStyles.button,
        { borderBottomColor: palette.border },
        pressed && actionStyles.pressed,
      ]}
    >
      <Text style={[actionStyles.text, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

function isReaderTheme(value: unknown): value is ReaderThemeName {
  return (
    value === 'white' ||
    value === 'gray' ||
    value === 'black' ||
    value === 'blue' ||
    value === 'yellow'
  );
}

function isReaderFontSize(value: unknown): value is ReaderFontSize {
  return value === 'small' || value === 'normal' || value === 'large';
}

function isReaderLineSpacing(value: unknown): value is ReaderLineSpacing {
  return value === 'narrow' || value === 'wide';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStyles(palette: ReaderPalette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: palette.background,
    },
    toolbar: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      backgroundColor: palette.toolbar,
    },
    toolbarSide: {
      width: 104,
      flexDirection: 'row',
      alignItems: 'center',
    },
    toolbarSideRight: {
      justifyContent: 'flex-end',
    },
    toolbarTitleArea: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 6,
    },
    toolbarTitle: {
      width: '100%',
      color: palette.text,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    progressTrack: {
      height: 2,
      backgroundColor: palette.border,
    },
    progressValue: {
      height: 2,
      backgroundColor: palette.accent,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 15,
      paddingHorizontal: 28,
      backgroundColor: palette.background,
    },
    loadingText: {
      color: palette.muted,
      fontSize: 13,
    },
    errorTitle: {
      color: palette.text,
      fontSize: 17,
      fontWeight: '800',
      textAlign: 'center',
    },
    errorText: {
      color: palette.muted,
      fontSize: 13,
      lineHeight: 21,
      textAlign: 'center',
    },
    retryButton: {
      minWidth: 190,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      borderRadius: 24,
      backgroundColor: palette.accent,
    },
    retryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },
    readerContent: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 25,
      paddingTop: 34,
      paddingBottom: 178,
      backgroundColor: palette.background,
    },
    workHeader: {
      gap: 9,
      paddingBottom: 28,
    },
    seriesTitle: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: '700',
    },
    workTitle: {
      color: palette.text,
      fontSize: 25,
      fontWeight: '700',
      lineHeight: 35,
    },
    authorName: {
      color: palette.text,
      fontSize: 14,
      fontWeight: '600',
    },
    workMeta: {
      color: palette.muted,
      fontSize: 11,
    },
    titleDivider: {
      height: StyleSheet.hairlineWidth,
      marginBottom: 34,
      backgroundColor: palette.border,
    },
    novelBody: {
      gap: 28,
    },
    bodyText: {
      color: palette.text,
      fontFamily: Platform.select({
        android: 'serif',
        ios: 'Hiragino Mincho ProN',
        default: undefined,
      }),
      letterSpacing: 0.25,
    },
    chapterTitle: {
      color: palette.text,
      fontSize: 21,
      fontWeight: '700',
      lineHeight: 31,
      paddingTop: 20,
      paddingBottom: 4,
    },
    pageBreak: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 24,
    },
    pageBreakLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.border,
    },
    pageBreakMark: {
      color: palette.muted,
      fontSize: 8,
    },
    embeddedImage: {
      width: '100%',
      minHeight: 240,
      maxHeight: 560,
      borderRadius: 4,
    },
    imageFallback: {
      minHeight: 130,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 5,
      backgroundColor: palette.toolbar,
    },
    imageFallbackText: {
      color: palette.muted,
      fontSize: 12,
    },
    jumpText: {
      color: palette.muted,
      fontSize: 12,
      textAlign: 'center',
    },
    readerEnd: {
      alignItems: 'center',
      gap: 7,
      paddingTop: 64,
    },
    readerEndMark: {
      color: palette.muted,
      fontSize: 10,
    },
    readerEndText: {
      color: palette.muted,
      fontSize: 12,
      letterSpacing: 3,
    },
    relatedSection: {
      gap: 18,
      marginTop: 62,
      paddingTop: 28,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    relatedHeadingRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 14,
    },
    relatedHeadingText: {
      gap: 3,
    },
    relatedEyebrow: {
      color: palette.accent,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.5,
    },
    relatedTitle: {
      color: palette.text,
      fontSize: 22,
      fontWeight: '800',
    },
    relatedCount: {
      color: palette.muted,
      fontSize: 11,
    },
    relatedLoading: {
      minHeight: 90,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    relatedMuted: {
      color: palette.muted,
      fontSize: 12,
      lineHeight: 19,
    },
    relatedErrorCard: {
      gap: 12,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 14,
      backgroundColor: palette.toolbar,
    },
    relatedErrorText: {
      color: palette.muted,
      fontSize: 12,
      lineHeight: 19,
    },
    relatedRetryButton: {
      alignSelf: 'flex-start',
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: 15,
      borderRadius: 18,
      backgroundColor: palette.accent,
    },
    relatedRetryText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
    relatedList: {
      gap: 13,
      paddingRight: 4,
    },
    relatedCard: {
      width: 190,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 16,
      backgroundColor: palette.toolbar,
    },
    relatedCardPressed: {
      opacity: 0.72,
      transform: [{ scale: 0.985 }],
    },
    relatedCover: {
      width: '100%',
      height: 124,
      backgroundColor: palette.border,
    },
    relatedCardBody: {
      minHeight: 145,
      gap: 6,
      padding: 13,
    },
    relatedCardTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: '800',
      lineHeight: 20,
    },
    relatedAuthor: {
      color: palette.muted,
      fontSize: 11,
    },
    relatedMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    relatedMeta: {
      color: palette.muted,
      fontSize: 10,
    },
    relatedReadRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      gap: 5,
      paddingTop: 4,
    },
    relatedReadText: {
      color: palette.accent,
      fontSize: 12,
      fontWeight: '800',
    },
    relatedArrow: {
      color: palette.accent,
      fontSize: 21,
      lineHeight: 20,
    },
    floatingControls: {
      position: 'absolute',
      right: 16,
      bottom: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    progressPill: {
      minWidth: 55,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 22,
      backgroundColor: palette.toolbar,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: palette.isDark ? 0.32 : 0.14,
      shadowRadius: 12,
      elevation: 5,
    },
    progressPercent: {
      color: palette.muted,
      fontSize: 11,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    displayButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 16,
      borderRadius: 24,
      backgroundColor: palette.accent,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: palette.isDark ? 0.34 : 0.2,
      shadowRadius: 13,
      elevation: 6,
    },
    displayButtonAa: {
      color: '#FFFFFF',
      fontSize: 18,
      fontWeight: '700',
    },
    displayButtonLabel: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.62,
    },
  });
}

function createSheetStyles(palette: ReaderPalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: palette.overlay,
    },
    sheet: {
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
      gap: 16,
      paddingHorizontal: 22,
      paddingTop: 10,
      paddingBottom: 32,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderTopWidth: 3,
      borderTopColor: palette.accent,
      backgroundColor: palette.toolbar,
    },
    actionSheet: {
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 28,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      backgroundColor: palette.toolbar,
    },
    sheetHandle: {
      width: 38,
      height: 4,
      alignSelf: 'center',
      borderRadius: 999,
      backgroundColor: palette.border,
    },
    sheetHeader: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
    },
    sheetTitle: {
      flex: 1,
      color: palette.text,
      fontSize: 20,
      fontWeight: '700',
    },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButtonText: {
      color: palette.text,
      fontSize: 26,
      fontWeight: '300',
    },
    sectionLabel: {
      color: palette.text,
      fontSize: 15,
      fontWeight: '700',
    },
    themeRow: {
      flexDirection: 'row',
      gap: 10,
    },
    themeOption: {
      flex: 1,
      minHeight: 49,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderRadius: 10,
    },
    themeOptionActive: {
      borderWidth: 3,
    },
    themeOptionText: {
      fontSize: 18,
      fontWeight: '600',
    },
    optionColumns: {
      flexDirection: 'row',
      gap: 24,
      paddingTop: 4,
    },
    optionColumn: {
      flex: 1,
      gap: 11,
    },
    pressed: {
      opacity: 0.62,
    },
  });
}

const toolbarStyles = StyleSheet.create({
  button: {
    minWidth: 52,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.55,
  },
  disabled: {
    opacity: 0.35,
  },
});

const radioStyles = StyleSheet.create({
  row: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  circle: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 11,
  },
  circleFill: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    fontSize: 14,
  },
  pressed: {
    opacity: 0.62,
  },
});

const actionStyles = StyleSheet.create({
  button: {
    minHeight: 53,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.62,
  },
});
