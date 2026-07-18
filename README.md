# Pixiv Novel Reader

[![Android APK](https://github.com/linkalls/pixiv-novel-reader/actions/workflows/android-apk.yml/badge.svg)](https://github.com/linkalls/pixiv-novel-reader/actions/workflows/android-apk.yml)

Expo 57・React Native・TypeScript・Bunで作った、Pixiv小説に特化したAndroidリーダー。

## 主な機能

### 探す・フォロー

- Pixiv OAuthログイン、refresh tokenのSecureStore保存と自動再接続
- おすすめ、フォロー新着、公開・非公開ブックマーク、通常・R-18ランキング
- フォロー新着で前回確認後に公開された作品へNEW表示
- 作者プロフィール内の作品検索、タグ絞り込み、シリーズ絞り込み
- 作者のフォロー・解除、作者／タグのミュートと解除管理
- キーワード、タグ、タイトル・説明からの検索
- 新着順、古い順、人気順の切り替え
- 文字数、最低ブックマーク数、投稿期間、R-18、AI生成、シリーズ／単発、読了済み除外の高度検索
- 検索条件の端末内保存と検索履歴の固定・再実行
- 関連作品、ディスカバリー、おすすめ理由表示、「興味なし」の除外・復元

### 読書

- Pixiv WebのAjax JSON APIを優先利用するネイティブ本文リーダー
- Ajax取得失敗時のApp APIフォールバック
- 横書き・縦書きの切り替え、縦書き時の右から左への横スワイプ読書
- 章見出し、改ページ、ルビ、埋め込み画像のネイティブ描画
- 読書位置・スクロール位置のSQLite保存、ホームと詳細から続きへ直接復帰
- 章・改ページから生成する目次と、本文・章題の全文検索
- 端末TTSによる日本語読み上げ、速度変更、一時停止、前後区間移動
- しおり、位置メモ
- 文字サイズ、行間、文字の太さ、段落間隔、余白、縦書き列間の連続調整
- 明朝体／ゴシック体、白・灰・黒・青・黄の読書テーマ
- 読書中の画面消灯防止、明るさ固定、ステータスバー非表示
- 読了時にシリーズ次話を自動で開く設定
- 読書画面と作品詳細から作品URLを直接コピー・共有
- Pixiv作品ページをアプリ内WebViewで開き、コメント・リアクションを利用

### シリーズ・オフライン

- シリーズ全話一覧、前話・次話、次の未読話への移動
- 各話の未読・読書中・読了・保存済み状態とシリーズ全体の進捗表示
- シリーズ全話、作者の全作品、作者内で絞り込んだ作品の一括保存
- 永続ダウンロードキュー、強制終了後の再開、失敗作品だけの再試行
- Wi-Fi接続時のみ、挿絵を含める／本文のみ、読了後自動削除の設定
- 購読シリーズの新話を起動時・アプリ復帰時に検出して自動保存
- 保存作品数、挿絵ファイル数、総容量、作品ごとの概算容量表示
- 本文・作品情報・挿絵を通信なしで閲覧

### ライブラリ・統計

- 読書履歴の検索、読みかけ・読了・保存済み絞り込み、並べ替え、個別削除
- 複数選択による履歴削除、読了／未読変更、本棚追加・移動、オフライン保存
- 複数本棚の作成・名前変更・削除、作品の手動順序変更
- しおり一覧、ミュート一覧、オフライン管理、読書統計
- 読了日時の記録と履歴表示
- 今日・直近7日・直近30日の読書時間、推定読書文字数、読了作品数
- 1日／週間読書目標、達成率、現在・最長の連続読書日数
- よく読んだ作品・作者・タグの集計
- 履歴、本棚、しおり、ミュート、検索条件、オフライン、統計、表示設定のJSONバックアップ／復元
- バックアップ内容の件数プレビュー、1日1回・最大7世代の自動バックアップ

### Android連携・配布

- Pixiv作品URLのApp Link、カスタムスキーム、Android共有シートからのURL受け取り
- フォロー新着・購読シリーズ新話の任意ローカル通知
- 端末追従・ライト固定・ダーク固定のアプリテーマ
- GitHub Releaseの更新確認、現在バージョン、変更履歴、Release一覧
- ページネーション、引っ張って更新、認証切れ時の再ログイン案内
- arm64-v8a Release APKのGitHub Actions自動ビルド・署名検証・SHA-256添付

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

通常ビルドではAPKとSHA-256をActions Artifactへ30日間保存する。`v2.0.1`のようなタグをpushすると、同じ成果物をGitHub Releaseへ自動添付する。

```bash
git tag v2.0.1
git push origin v2.0.1
```

タグのバージョンと`app.json`の`expo.version`が一致しない場合、誤配布防止のためReleaseを失敗させる。

## 認証情報

PixivのID・パスワードはPixivのWebViewへ直接入力され、アプリ側では受け取らない。端末へ保存するのはOAuthで取得したrefresh tokenだけで、ソースコードやGitHub Actionsへ認証情報を埋め込まない。

## ライセンス

[MIT](./LICENSE)
