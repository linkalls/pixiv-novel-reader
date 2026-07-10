# Pixiv Novel Reader

Expo 57 + TypeScript + Bunで作るPixiv小説リーダー。
現在は`@book000/pixivts`がReact Native / ExpoのAndroid bundleへ組み込めることを確認するための疎通テスト段階。

## 現在できること

- Pixiv refresh tokenを`expo-secure-store`へ保存
- `@book000/pixivts`でPixivへログイン
- 小説デイリーランキングの先頭ページを取得
- 上位10作品のタイトル、作者、文字数、ブックマーク数を表示

## 起動

```bash
cd ~/Apps/pixiv-novel-reader
bun install
bun run start
```

Androidを直接開く場合：

```bash
bun run android
```

## 検証

```bash
bun run check
```

Android向けMetro bundleを生成する場合：

```bash
bunx expo export --platform android --output-dir dist-android --clear
```

## 認証情報

refresh tokenはソースコードや`.env`へ直書きせず、アプリ上で入力する。
入力されたtokenは端末のSecureStoreへ保存される。
