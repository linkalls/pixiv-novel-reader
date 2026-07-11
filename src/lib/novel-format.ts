export type NovelBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'chapter';
      title: string;
    }
  | {
      type: 'pagebreak';
    }
  | {
      type: 'image';
      id: string;
    }
  | {
      type: 'jump';
      label: string;
    };

const BLOCK_PATTERN =
  /\[chapter:([^\]]+)]|\[newpage]|\[(?:pixivimage|uploadedimage):([^\]]+)]|\[jump:([^\]]+)]/g;

/**
 * Pixiv小説独自記法を、ネイティブ画面で個別に描画できるブロックへ分解する。
 * ルビと外部リンク記法は、React Nativeの標準Textでも読める表記へ丸める。
 */
export function parseNovelBlocks(value: string): NovelBlock[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const blocks: NovelBlock[] = [];
  let cursor = 0;

  for (const match of normalized.matchAll(BLOCK_PATTERN)) {
    const index = match.index ?? 0;
    pushTextBlock(blocks, normalized.slice(cursor, index));

    if (match[1]) {
      blocks.push({
        type: 'chapter',
        title: cleanInlineNovelMarkup(match[1]).trim(),
      });
    } else if (match[0] === '[newpage]') {
      blocks.push({ type: 'pagebreak' });
    } else if (match[2]) {
      blocks.push({
        type: 'image',
        id: match[2].trim(),
      });
    } else if (match[3]) {
      blocks.push({
        type: 'jump',
        label: cleanInlineNovelMarkup(match[3]).trim(),
      });
    }

    cursor = index + match[0].length;
  }

  pushTextBlock(blocks, normalized.slice(cursor));
  return blocks;
}

/** 互換用途。ブロックをプレーンテキストへ戻す。 */
export function formatNovelText(value: string): string {
  return parseNovelBlocks(value)
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'chapter':
          return `【${block.title}】`;
        case 'pagebreak':
          return '──────────';
        case 'image':
          return `［挿絵 ${block.id}］`;
        case 'jump':
          return `［${block.label}へ移動］`;
      }
    })
    .join('\n\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function pushTextBlock(blocks: NovelBlock[], rawText: string): void {
  const text = cleanInlineNovelMarkup(rawText)
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\n+|\n+$/g, '');

  if (text.length > 0) {
    blocks.push({ type: 'text', text });
  }
}

function cleanInlineNovelMarkup(value: string): string {
  return value
    .replace(/\[\[rb:([^>\]]+?)\s*>\s*([^\]]+)]]/g, '$1（$2）')
    .replace(
      /\[\[jumpuri:([^>\]]+?)\s*>\s*([^\]]+)]]/g,
      '$1（$2）',
    );
}
