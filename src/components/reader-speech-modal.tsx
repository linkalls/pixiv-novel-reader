import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  findSpeechChunkIndex,
  type ReaderSpeechChunk,
} from '@/lib/reader-speech';

type SpeechState = 'idle' | 'playing' | 'paused' | 'finished';

interface ReaderSpeechModalProps {
  accent: string;
  background: string;
  border: string;
  chunks: ReaderSpeechChunk[];
  muted: string;
  onClose: () => void;
  onJump: (blockIndex: number) => void;
  overlay: string;
  startBlockIndex: number;
  text: string;
  visible: boolean;
}

const RATE_OPTIONS = [0.8, 1, 1.2, 1.4] as const;

export function ReaderSpeechModal({
  accent,
  background,
  border,
  chunks,
  muted,
  onClose,
  onJump,
  overlay,
  startBlockIndex,
  text,
  visible,
}: ReaderSpeechModalProps) {
  const styles = useMemo(
    () => createStyles({ accent, background, border, muted, overlay, text }),
    [accent, background, border, muted, overlay, text],
  );
  const [state, setState] = useState<SpeechState>('idle');
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [rate, setRate] = useState<(typeof RATE_OPTIONS)[number]>(1);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const currentIndexRef = useRef(-1);
  const rateRef = useRef(rate);
  const chunksRef = useRef(chunks);
  const onJumpRef = useRef(onJump);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    onJumpRef.current = onJump;
  }, [onJump]);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    if (!visible) {
      generationRef.current += 1;
      void Speech.stop().catch(() => {});
    }
  }, [visible]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      void Speech.stop().catch(() => {});
    },
    [],
  );

  function closeModal() {
    generationRef.current += 1;
    void Speech.stop().catch(() => {});
    setState('idle');
    onClose();
  }

  function begin(index?: number) {
    if (chunksRef.current.length === 0) {
      setError('読み上げ可能な本文がありません');
      return;
    }

    const resolvedIndex =
      index ??
      findSpeechChunkIndex(chunksRef.current, Math.max(0, startBlockIndex));
    const nextIndex = Math.max(
      0,
      Math.min(chunksRef.current.length - 1, resolvedIndex),
    );
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    void Speech.stop()
      .catch(() => {})
      .finally(() => speakChunk(nextIndex, generation));
  }

  function speakChunk(index: number, generation: number) {
    const chunk = chunksRef.current[index];
    if (!chunk || generation !== generationRef.current) {
      if (!chunk) {
        setState('finished');
      }
      return;
    }

    currentIndexRef.current = index;
    setCurrentIndex(index);
    setState('playing');
    setError(null);
    onJumpRef.current(chunk.blockIndex);

    Speech.speak(chunk.text, {
      language: 'ja-JP',
      pitch: 1,
      rate: rateRef.current,
      onDone: () => {
        if (generation !== generationRef.current) {
          return;
        }
        const nextIndex = index + 1;
        if (nextIndex >= chunksRef.current.length) {
          setState('finished');
          return;
        }
        speakChunk(nextIndex, generation);
      },
      onError: (speechError) => {
        if (generation !== generationRef.current) {
          return;
        }
        setState('idle');
        setError(
          speechError instanceof Error
            ? speechError.message
            : '読み上げ中にエラーが発生しました',
        );
      },
    });
  }

  async function togglePlayPause() {
    if (state === 'playing') {
      if (Platform.OS === 'android') {
        generationRef.current += 1;
        await Speech.stop().catch(() => {});
      } else {
        await Speech.pause().catch(() => {});
      }
      setState('paused');
      return;
    }

    if (state === 'paused') {
      if (Platform.OS === 'android') {
        begin(Math.max(0, currentIndexRef.current));
      } else {
        await Speech.resume().catch(() => {});
        setState('playing');
      }
      return;
    }

    if (state === 'finished') {
      begin(0);
      return;
    }

    begin();
  }

  async function stopSpeech() {
    generationRef.current += 1;
    await Speech.stop().catch(() => {});
    setState('idle');
    setCurrentIndex(-1);
    currentIndexRef.current = -1;
  }

  function moveChunk(offset: number) {
    const baseIndex = currentIndexRef.current >= 0 ? currentIndexRef.current : 0;
    begin(baseIndex + offset);
  }

  function changeRate(nextRate: (typeof RATE_OPTIONS)[number]) {
    setRate(nextRate);
    rateRef.current = nextRate;
    if (state === 'playing') {
      begin(Math.max(0, currentIndexRef.current));
    }
  }

  const currentChunk = currentIndex >= 0 ? chunks[currentIndex] : null;
  const progress =
    chunks.length > 0 && currentIndex >= 0
      ? (currentIndex + 1) / chunks.length
      : 0;

  return (
    <Modal
      animationType="fade"
      onRequestClose={closeModal}
      transparent
      visible={visible}
    >
      <Pressable onPress={closeModal} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>TEXT TO SPEECH</Text>
              <Text style={styles.title}>読み上げ</Text>
            </View>
            <Pressable
              accessibilityLabel="読み上げを閉じる"
              accessibilityRole="button"
              onPress={closeModal}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.previewCard}>
            <Text numberOfLines={4} style={styles.previewText}>
              {currentChunk?.text ?? '現在の読書位置から本文を読み上げます。'}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressValue, { width: `${progress * 100}%` }]}
              />
            </View>
            <Text style={styles.progressText}>
              {currentIndex >= 0
                ? `${currentIndex + 1} / ${chunks.length}`
                : `${chunks.length}区間`}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.controls}>
            <SpeechControl
              disabled={chunks.length === 0}
              label="前へ"
              onPress={() => moveChunk(-1)}
              styles={styles}
            />
            <Pressable
              accessibilityRole="button"
              disabled={chunks.length === 0}
              onPress={() => void togglePlayPause()}
              style={({ pressed }) => [
                styles.playButton,
                chunks.length === 0 && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.playText}>
                {state === 'playing'
                  ? '一時停止'
                  : state === 'paused'
                    ? '再開'
                    : state === 'finished'
                      ? '最初から'
                      : '再生'}
              </Text>
            </Pressable>
            <SpeechControl
              disabled={chunks.length === 0}
              label="次へ"
              onPress={() => moveChunk(1)}
              styles={styles}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void stopSpeech()}
            style={({ pressed }) => [
              styles.stopButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.stopText}>停止して位置をリセット</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>読み上げ速度</Text>
          <View style={styles.rateRow}>
            {RATE_OPTIONS.map((option) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: rate === option }}
                key={option}
                onPress={() => changeRate(option)}
                style={({ pressed }) => [
                  styles.rateButton,
                  rate === option && styles.rateButtonActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.rateText,
                    rate === option && styles.rateTextActive,
                  ]}
                >
                  {option.toFixed(1)}×
                </Text>
              </Pressable>
            ))}
          </View>

          {Platform.OS === 'android' ? (
            <Text style={styles.note}>
              Androidでは一時停止後、現在の区間の先頭から再開します。
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SpeechControl({
  disabled,
  label,
  onPress,
  styles,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: {
  accent: string;
  background: string;
  border: string;
  muted: string;
  overlay: string;
  text: string;
}) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
    },
    sheet: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      gap: 15,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 26,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.background,
    },
    handle: {
      width: 40,
      height: 4,
      alignSelf: 'center',
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    header: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerText: { flex: 1, gap: 2 },
    eyebrow: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.4,
    },
    title: { color: colors.text, fontSize: 19, fontWeight: '900' },
    closeButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 19,
      backgroundColor: colors.border,
    },
    closeText: { color: colors.text, fontSize: 22, lineHeight: 25 },
    previewCard: {
      gap: 10,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 15,
    },
    previewText: {
      minHeight: 48,
      color: colors.text,
      fontSize: 13,
      lineHeight: 21,
    },
    progressTrack: {
      height: 5,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    progressValue: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    progressText: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      textAlign: 'right',
    },
    error: { color: '#D75555', fontSize: 12, lineHeight: 19 },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    controlButton: {
      minWidth: 72,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 13,
    },
    controlText: { color: colors.text, fontSize: 12, fontWeight: '800' },
    playButton: {
      minWidth: 112,
      minHeight: 50,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 25,
      backgroundColor: colors.accent,
    },
    playText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
    stopButton: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stopText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
    sectionLabel: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    rateRow: { flexDirection: 'row', gap: 8 },
    rateButton: {
      flex: 1,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
    },
    rateButtonActive: {
      borderColor: colors.accent,
      backgroundColor: `${colors.accent}18`,
    },
    rateText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
    rateTextActive: { color: colors.accent },
    note: { color: colors.muted, fontSize: 10, lineHeight: 16 },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.65 },
  });
}
