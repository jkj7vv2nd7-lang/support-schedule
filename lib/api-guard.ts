// API Route 共通の入力サイズガード
// Content-Length ヘッダーによる早期チェック（ヘッダーが省略・偽装されていれば素通りする点に注意）
export function checkContentLength(request: Request, maxBytes: number): string | null {
  const len = request.headers.get("content-length");
  if (len == null) return null;
  const n = Number(len);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= maxBytes) return null;
  return bodyTooLargeMessage(maxBytes);
}

export function bodyTooLargeMessage(maxBytes: number): string {
  const mb = Number.isFinite(maxBytes) ? Math.max(1, Math.round(maxBytes / 1024 / 1024)) : 10;
  return `リクエストが大きすぎます（上限 約${mb}MB）`;
}

export class BodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super("BODY_TOO_LARGE");
    this.name = "BodyTooLargeError";
  }
}

// 簡易レート制限（同一IPの短時間連打を抑止。サーバーレスの複数台では台ごとの計数になる点に注意）。
// メモリ保持のため長期運用では古いバケットを掃除する。
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec?: number } {
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  cur.count += 1;
  if (cur.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

export function rateLimitExceededMessage(retryAfterSec?: number): string {
  return typeof retryAfterSec === "number" && retryAfterSec > 0
    ? `リクエストが多すぎます。${retryAfterSec}秒ほど待って再試行してください`
    : "リクエストが多すぎます。時間をおいて再試行してください";
}

// Vercel等では x-forwarded-for の先頭がクライアントIPになる
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64) || "unknown";
  return "unknown";
}

// テスト用のバケット掃除
export function __clearRateLimits(): void {
  buckets.clear();
}

// ストリーム制限の打ち切りは multipart/JSON パーサでラップされる場合があるため、
// instanceof だけでなくエラー名でも判定する（413を400に化けさせない）
export function isBodyTooLarge(err: unknown): err is BodyTooLargeError {
  if (err instanceof BodyTooLargeError) return true;
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ((cur as { name?: unknown }).name === "BodyTooLargeError") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Content-Length ヘッダーに頼らず、実際に読み取ったバイト数で上限を強制するラッパー。
// ヘッダー省略や虚偽申告（chunked転送など）でも、想定外に大きなボディをメモリに載せ切る前に打ち切る。
export function boundRequestBody(request: Request, maxBytes: number): Request {
  const body = request.body;
  if (!body) return request;
  const reader = body.getReader();
  let total = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        controller.error(new BodyTooLargeError(maxBytes));
        await reader.cancel().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    // Node/undici の fetch 実装ではストリームボディに duplex 指定が必要
    duplex: "half",
    body: stream,
  } as RequestInit);
}
