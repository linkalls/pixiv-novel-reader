import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { NovelBlock } from '@/lib/novel-format';

export interface VerticalReaderHandle {
  jumpToBlock: (blockIndex: number, animated?: boolean) => void;
  jumpToProgress: (progress: number, animated?: boolean) => void;
}

interface VerticalReaderViewProps {
  authorName: string | null;
  background: string;
  blocks: NovelBlock[];
  embeddedImages: Record<string, string>;
  fontSize: number;
  initialProgress: number;
  lineHeight: number;
  meta: string | null;
  muted: string;
  onBlockChange: (blockIndex: number) => void;
  onProgress: (progress: number, scrollOffset: number) => void;
  seriesTitle: string | null;
  text: string;
  title: string;
  toolbar: string;
}

interface VerticalReaderMessage {
  blockIndex?: number;
  progress?: number;
  scrollOffset?: number;
  type?: string;
}

export const VerticalReaderView = forwardRef<
  VerticalReaderHandle,
  VerticalReaderViewProps
>(function VerticalReaderView(
  {
    authorName,
    background,
    blocks,
    embeddedImages,
    fontSize,
    initialProgress,
    lineHeight,
    meta,
    muted,
    onBlockChange,
    onProgress,
    seriesTitle,
    text,
    title,
    toolbar,
  },
  forwardedRef,
) {
  const webViewRef = useRef<WebView>(null);
  const html = useMemo(
    () =>
      buildVerticalReaderHtml({
        authorName,
        background,
        blocks,
        embeddedImages,
        fontSize,
        initialProgress,
        lineHeight,
        meta,
        muted,
        seriesTitle,
        text,
        title,
        toolbar,
      }),
    [
      authorName,
      background,
      blocks,
      embeddedImages,
      fontSize,
      initialProgress,
      lineHeight,
      meta,
      muted,
      seriesTitle,
      text,
      title,
      toolbar,
    ],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      jumpToBlock(blockIndex, animated = true) {
        webViewRef.current?.injectJavaScript(
          `window.__PNR && window.__PNR.jumpToBlock(${Math.max(
            0,
            Math.floor(blockIndex),
          )}, ${animated ? 'true' : 'false'}); true;`,
        );
      },
      jumpToProgress(progress, animated = true) {
        webViewRef.current?.injectJavaScript(
          `window.__PNR && window.__PNR.jumpToProgress(${clampProgress(
            progress,
          )}, ${animated ? 'true' : 'false'}); true;`,
        );
      },
    }),
    [],
  );

  function handleMessage(event: WebViewMessageEvent) {
    let message: VerticalReaderMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as VerticalReaderMessage;
    } catch {
      return;
    }

    if (
      message.type === 'progress' &&
      typeof message.progress === 'number' &&
      typeof message.scrollOffset === 'number'
    ) {
      onProgress(
        clampProgress(message.progress),
        Math.max(0, message.scrollOffset),
      );
    }

    if (
      message.type === 'block' &&
      typeof message.blockIndex === 'number'
    ) {
      onBlockChange(Math.max(0, Math.floor(message.blockIndex)));
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <WebView
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        domStorageEnabled={false}
        javaScriptEnabled
        mixedContentMode="compatibility"
        onMessage={handleMessage}
        originWhitelist={['*']}
        overScrollMode="never"
        ref={webViewRef}
        scrollEnabled
        setSupportMultipleWindows={false}
        source={{ html, baseUrl: 'https://www.pixiv.net/' }}
        style={[styles.webView, { backgroundColor: background }]}
      />
    </View>
  );
});

function buildVerticalReaderHtml({
  authorName,
  background,
  blocks,
  embeddedImages,
  fontSize,
  initialProgress,
  lineHeight,
  meta,
  muted,
  seriesTitle,
  text,
  title,
  toolbar,
}: Omit<VerticalReaderViewProps, 'onBlockChange' | 'onProgress'>): string {
  const renderedBlocks = blocks
    .map((block, index) => renderBlock(block, index, embeddedImages))
    .join('');
  const initial = clampProgress(initialProgress);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; margin: 0; overflow: hidden;
    background: ${escapeCssColor(background)};
  }
  body {
    color: ${escapeCssColor(text)};
    font-family: serif;
    -webkit-text-size-adjust: 100%;
    overscroll-behavior: none;
  }
  #viewport {
    width: 100vw; height: 100vh;
    overflow-x: auto; overflow-y: hidden;
    scrollbar-width: none;
    overscroll-behavior: none;
    touch-action: pan-x;
  }
  #viewport::-webkit-scrollbar { display: none; }
  #content {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    height: 100vh;
    min-width: 100vw;
    padding: 28px 24px 30px;
    background: ${escapeCssColor(background)};
  }
  #header {
    padding-left: 34px;
    margin-left: 28px;
    border-left: 1px solid ${escapeCssColor(toolbar)};
  }
  .series {
    color: ${escapeCssColor(muted)};
    font-family: sans-serif;
    font-size: 12px;
    font-weight: 700;
    margin-left: 10px;
  }
  .title {
    font-family: sans-serif;
    font-size: 25px;
    font-weight: 800;
    line-height: 1.45;
    margin: 0 0 14px 0;
  }
  .author, .meta {
    color: ${escapeCssColor(muted)};
    font-family: sans-serif;
    font-size: 12px;
    margin-left: 8px;
  }
  #body {
    font-size: ${Math.max(12, fontSize)}px;
    line-height: ${Math.max(fontSize + 4, lineHeight)}px;
    letter-spacing: 0.05em;
  }
  .block {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-left: 1.3em;
  }
  .chapter {
    font-family: sans-serif;
    font-size: 1.15em;
    font-weight: 800;
    margin-left: 2em;
    padding-top: 0.2em;
  }
  .pagebreak {
    width: 1px;
    height: 78%;
    align-self: center;
    margin: 0 2em;
    background: ${escapeCssColor(muted)};
    opacity: 0.45;
  }
  .image-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: min(78vw, 520px);
    margin-left: 2em;
  }
  .image-wrap img {
    max-width: min(72vw, 480px);
    max-height: 82vh;
    object-fit: contain;
  }
  .image-fallback, .jump {
    color: ${escapeCssColor(muted)};
    font-family: sans-serif;
    font-size: 0.8em;
  }
  #end {
    color: ${escapeCssColor(muted)};
    font-family: sans-serif;
    font-weight: 800;
    letter-spacing: 0.25em;
    margin-left: 28px;
    padding-left: 24px;
  }
</style>
</head>
<body>
<div id="viewport">
  <main id="content">
    <header id="header">
      ${seriesTitle ? `<div class="series">${escapeHtml(seriesTitle)}</div>` : ''}
      <h1 class="title">${escapeHtml(title)}</h1>
      ${authorName ? `<div class="author">${escapeHtml(authorName)}</div>` : ''}
      ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
    </header>
    <section id="body">${renderedBlocks}</section>
    <div id="end">◆　読了</div>
  </main>
</div>
<script>
(function () {
  var viewport = document.getElementById('viewport');
  var blocks = Array.prototype.slice.call(document.querySelectorAll('[data-block-index]'));
  var raf = 0;
  var lastBlock = -1;

  function maximumOffset() {
    return Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  }
  function offsetValue() {
    return Math.min(maximumOffset(), Math.abs(viewport.scrollLeft));
  }
  function postProgress() {
    var maximum = maximumOffset();
    var offset = offsetValue();
    var progress = maximum <= 0 ? 1 : Math.min(1, offset / maximum);
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'progress', progress: progress, scrollOffset: offset
    }));

    var targetX = viewport.clientWidth * 0.68;
    var current = -1;
    var distance = Number.MAX_VALUE;
    for (var i = 0; i < blocks.length; i += 1) {
      var rect = blocks[i].getBoundingClientRect();
      if (rect.right < -20 || rect.left > viewport.clientWidth + 20) continue;
      var nextDistance = Math.abs(rect.right - targetX);
      if (nextDistance < distance) {
        distance = nextDistance;
        current = Number(blocks[i].getAttribute('data-block-index'));
      }
    }
    if (current >= 0 && current !== lastBlock) {
      lastBlock = current;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'block', blockIndex: current
      }));
    }
  }
  function schedulePost() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; postProgress(); });
  }
  function setLogicalOffset(offset, animated) {
    var maximum = maximumOffset();
    var target = Math.max(0, Math.min(maximum, offset));
    var behavior = animated ? 'smooth' : 'auto';
    viewport.scrollTo({ left: -target, behavior: behavior });
    setTimeout(function () {
      if (target > 2 && Math.abs(viewport.scrollLeft) < 2) {
        viewport.scrollTo({ left: target, behavior: behavior });
      }
      schedulePost();
    }, animated ? 220 : 20);
  }

  window.__PNR = {
    jumpToBlock: function (index, animated) {
      var element = document.querySelector('[data-block-index="' + index + '"]');
      if (!element) return;
      element.scrollIntoView({
        behavior: animated ? 'smooth' : 'auto',
        block: 'nearest', inline: 'start'
      });
      setTimeout(schedulePost, animated ? 240 : 30);
    },
    jumpToProgress: function (progress, animated) {
      setLogicalOffset(maximumOffset() * Math.max(0, Math.min(1, progress)), animated);
    }
  };

  viewport.addEventListener('scroll', schedulePost, { passive: true });
  window.addEventListener('resize', schedulePost);
  window.addEventListener('load', function () {
    requestAnimationFrame(function () {
      window.__PNR.jumpToProgress(${initial}, false);
      schedulePost();
    });
  });
})();
</script>
</body>
</html>`;
}

function renderBlock(
  block: NovelBlock,
  index: number,
  embeddedImages: Record<string, string>,
): string {
  const data = `data-block-index="${index}"`;
  switch (block.type) {
    case 'text':
      return `<div class="block text" ${data}>${escapeHtml(block.text)}</div>`;
    case 'chapter':
      return `<div class="block chapter" ${data}>${escapeHtml(block.title)}</div>`;
    case 'pagebreak':
      return `<div class="block pagebreak" ${data} aria-label="改ページ"></div>`;
    case 'image': {
      const uri = embeddedImages[block.id];
      return uri
        ? `<div class="block image-wrap" ${data}><img alt="挿絵" src="${escapeHtmlAttribute(uri)}" /></div>`
        : `<div class="block image-fallback" ${data}>［挿絵 ${escapeHtml(block.id)}］</div>`;
    }
    case 'jump':
      return `<div class="block jump" ${data}>─ ${escapeHtml(block.label)} ─</div>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeCssColor(value: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([\d\s.,%]+\)$/i.test(value)
    ? value
    : '#000000';
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webView: { flex: 1 },
});
