# Pixiv内部APIメモ

このアプリで利用しているPixivの非公開App API・Web APIについて、実装場所、確認済み仕様、注意点を記録する。

> これらはPixivの公開・公式SDKではない。予告なくレスポンスや認証方式が変わる可能性があるため、取得失敗時はアプリ全体を巻き込まず、画面単位で再試行できる設計にする。

## 小説コメント

### 取得

```http
GET https://app-api.pixiv.net/v1/novel/comments
```

クエリ：

| 名前 | 型 | 内容 |
| --- | --- | --- |
| `novel_id` | number | 小説ID |
| `offset` | number | 2ページ目以降のページング位置。初回は省略可能 |
| `include_total_comments` | boolean | `true`にすると総コメント数を含める |

必要な認証：

```http
Authorization: Bearer <access token>
```

主なレスポンス：

```json
{
  "comments": [
    {
      "id": 123,
      "comment": "コメント本文",
      "date": "2026-07-21T00:00:00+09:00",
      "user": {
        "id": 456,
        "name": "ユーザー名",
        "account": "account",
        "profile_image_urls": {
          "medium": "https://..."
        }
      },
      "has_replies": false,
      "parent_comment": {}
    }
  ],
  "total_comments": 1,
  "next_url": null
}
```

返信コメントでは`parent_comment`に返信元コメントが入る。トップレベルコメントでは空オブジェクトになる場合がある。

### 実装場所

- API取得・snake_case変換：`src/lib/pixiv.ts` の `fetchNovelComments`
- ネイティブ一覧UI：`src/components/pixiv-novel-interaction-modal.tsx`
- 詳細画面からの導線：`src/app/novel/detail/[id].tsx`
- 読書画面からの導線：`src/app/novel/[id].tsx`

### ページング

APIが返した`next_url`を保持し、そこから`offset`を取り出して次ページを取得する。コメントIDで重複除外する。

### 現在できること

- コメント一覧取得
- 総コメント数表示
- 無限スクロール
- 返信元の表示
- 投稿者プロフィールへのアプリ内遷移

### 未実装・未確認

- コメント投稿
- コメントへの返信投稿
- コメント削除
- リアクション一覧・追加・削除

上記は取得APIとは別の内部エンドポイントが必要。実装前に公式AndroidアプリまたはWeb版の通信を再確認し、この文書へ追記する。

## 小説本文

- 優先：`GET https://www.pixiv.net/ajax/novel/{id}`
- フォールバック：App APIの`/webview/v2/novel`
- 実装：`src/lib/pixiv.ts`

Web API側はWebViewが保持するPixivログインCookieを利用する。失敗時にApp APIへフォールバックする。

## 更新ルール

内部APIを追加・変更したときは、次を同じコミットに含める。

1. この文書のエンドポイント・パラメータ・既知の制約を更新する。
2. API変換処理へテスト可能な純粋関数を用意する。
3. 認証切れ・空レスポンス・不正データでアプリ全体が落ちないことを確認する。
4. `bun run check`を通す。
