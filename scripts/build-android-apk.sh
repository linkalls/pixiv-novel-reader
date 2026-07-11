#!/usr/bin/env bash

# GitHub Actionsとローカルで同じ手順を使い、arm64向けRelease APKを作る。
# 生成されたAndroidプロジェクトはGit管理せず、app.jsonから毎回再生成する。

set -euo pipefail

OUTPUT_DIR="${1:-dist-android}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJECT_ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo 'Error: Bunが見つからないよ。Bunをインストールしてから再実行してね。' >&2
  exit 1
fi

if ! command -v java >/dev/null 2>&1; then
  echo 'Error: Java 17が見つからないよ。JAVA_HOMEも確認してね。' >&2
  exit 1
fi

# app.jsonを唯一のネイティブ設定元として、Androidプロジェクトを作り直す。
echo '==> Expo prebuildでAndroidプロジェクトを生成'
bunx expo prebuild --platform android --clean --no-install

chmod +x android/gradlew

# GitHub Actionsの標準arm64端末と、ユーザーのPixel系端末に合わせてarm64だけを作る。
# ABIを絞ることで、ビルド時間とAPKサイズを減らす。
echo '==> arm64-v8a Release APKをビルド'
(
  cd android
  NODE_ENV=production ./gradlew :app:assembleRelease \
    -PreactNativeArchitectures=arm64-v8a \
    -x lintVitalAnalyzeRelease \
    -x lintVitalReportRelease \
    -x lintVitalRelease \
    --no-daemon \
    --stacktrace \
    --console=plain
)

VERSION="$(bun -e "const config = await Bun.file('app.json').json(); console.log(config.expo.version);")"
APK_NAME="pixiv-novel-reader-v${VERSION}-arm64.apk"
SOURCE_APK="android/app/build/outputs/apk/release/app-release.apk"

if [[ ! -f "$SOURCE_APK" ]]; then
  echo "Error: APKが生成されなかったよ: $SOURCE_APK" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
cp "$SOURCE_APK" "$OUTPUT_DIR/$APK_NAME"
sha256sum "$OUTPUT_DIR/$APK_NAME" > "$OUTPUT_DIR/$APK_NAME.sha256"

echo
printf 'APK: %s\n' "$OUTPUT_DIR/$APK_NAME"
printf 'SHA-256: '
cut -d ' ' -f 1 "$OUTPUT_DIR/$APK_NAME.sha256"
