// API Route 共通の入力サイズガード
export function checkContentLength(request: Request, maxBytes: number): string | null {
  const len = request.headers.get("content-length");
  if (len == null) return null;
  const n = Number(len);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= maxBytes) return null;
  const mb = Math.max(1, Math.round(maxBytes / 1024 / 1024));
  return `リクエストが大きすぎます（上限 約${mb}MB）`;
}
