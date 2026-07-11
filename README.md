# Pixiv Novel Reader

[![Android APK](https://github.com/linkalls/pixiv-novel-reader/actions/workflows/android-apk.yml/badge.svg)](https://github.com/linkalls/pixiv-novel-reader/actions/workflows/android-apk.yml)

Expo 57・React Native・TypeScript・Bunで作った、Pixiv小説に特化したAndroidリーダー。

## 主な機能

- アプリ内WebViewによるPixiv OAuthログイン
- refresh tokenのSecureStore保存と自動再接続
- おすすめ小説
- 公開・非公開マイブックマーク
- 通常・R-18を含む小説ランキング
- キーワード、タグ、タイトル・説明からの小説検索
- 新着順、古い順、人気順の切り替え
- 作品詳細、タグ、閲覧数、ブックマーク数の表示
- ブックマーク追加・解除
- 作品詳細の「最初から読む」から開く独立した読書ページ
- Pixiv WebのAjax JSON APIを優先利用するネイティブ本文リーダー
- Pixiv本家風の読書ツールバー（表示設定・ブックマーク・その他）
- 白・灰・黒・青・黄の読書テーマ、3段階の文字サイズ、2段階の行間
- 章見出し、改ページ、ルビ、埋め込み画像のネイティブ描画
- 読了後の「こちらもおすすめ」と「ディスカバリー」
- SQLiteによる読書履歴・進捗保存・続きから読む機能
- 本文と作品情報のオフライン保存、通信なしでのライブラリ閲覧
- ブックマークの即時反映とホーム画面への状態同期
- 作品名中心の上部バーと、表示設定・オフライン保存をまとめた3点メニュー
- Ajax取得失敗時のApp APIフォールバック
- 端末追従・ライト固定・ダーク固定のテーマ切り替え
- ページネーション、引っ張って更新
- ログイン後は認証UIを隠し、設定画面にはログアウトだけを表示
- 青い開いた本とオレンジのしおりを使った専用アプリアイコン

## 開発

必要なもの：

- Bun 1.3.14+
- Node.js 22+
- Java 17
- Android SDK 36
- Android NDK 27.1.12297006

依存関係をインストールする：

```bash
bun install --frozen-lockfile
```

Expo開発サーバーを起動する：

```bash
bun run start
```

アイコン素材を再生成する：

```bash
bun run icons:generate
```

型・Lint・本文パーサーテスト・Expo構成を確認する：

```bash
bun run check
```

## APKのローカルビルド

`app.json`からAndroidプロジェクトを再生成し、arm64-v8a向けRelease APKを作る：

```bash
bun run android:apk
```

成果物：

```text
dist-android/pixiv-novel-reader-v<version>-arm64.apk
dist-android/pixiv-novel-reader-v<version>-arm64.apk.sha256
```

Release APKは現在、配布・動作確認用としてAndroidのdebug keystoreで署名する。Play Store公開時は専用のrelease keystoreへ切り替える。

## GitHub Actions

`.github/workflows/android-apk.yml`が次のタイミングで自動ビルドする：

- `main`へのpush
- `main`向けPull Request
- Actions画面からの手動実行
- `v*`タグのpush

通常ビルドではAPKとSHA-256をActions Artifactへ30日間保存する。`v1.5.2`のようなタグをpushすると、同じ成果物をGitHub Releaseへ自動添付する。

```bash
git tag v1.5.2
git push origin v1.5.2
```

タグのバージョンと`app.json`の`expo.version`が一致しない場合、誤配布防止のためReleaseを失敗させる。

## 認証情報

PixivのID・パスワードはPixivのWebViewへ直接入力され、アプリ側では受け取らない。端末へ保存するのはOAuthで取得したrefresh tokenだけで、ソースコードやGitHub Actionsへ認証情報を埋め込まない。

## ライセンス

[MIT](./LICENSE)
