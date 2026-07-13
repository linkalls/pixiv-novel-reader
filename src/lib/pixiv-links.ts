export function buildPixivUserUrl(userId: number): string {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('PixivユーザーIDが不正です');
  }

  return `https://www.pixiv.net/users/${userId}`;
}
