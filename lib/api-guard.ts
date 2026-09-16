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
