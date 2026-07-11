import type { PixivNovelItem } from '@book000/pixivts';

type NovelChangedListener = (novel: PixivNovelItem) => void;

const listeners = new Set<NovelChangedListener>();

/** Readerとホームの間でブックマーク状態を即時同期する。 */
export function emitNovelChanged(novel: PixivNovelItem): void {
  for (const listener of listeners) {
    listener(novel);
  }
}

export function subscribeNovelChanged(
  listener: NovelChangedListener,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
