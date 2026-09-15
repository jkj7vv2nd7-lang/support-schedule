import { BodyTooLargeError, boundRequestBody, bodyTooLargeMessage, checkContentLength } from "@/lib/api-guard";
import { emptyTimetable } from "@/lib/types";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MODEL = process.env.GEMINI_TIMETABLE_MODEL || "gemini-2.5-flash";

const SYSTEM = `写真は小学校・中学校の週時間割表です。表を読み取り、次のJSONだけを出力してください（コードフェンス・注釈禁止）。
{"slots":[{"day":0,"period":1,"subject":"国語","content":"漢字ドリル"}]}
ルール:
- dayは月=0〜金=4、periodは1〜6。土日や空きコマは含めない
- subjectは教科名のみ（短く）。contentは学習内容・備考（なければ""）
- 2時間続きなど結合セルは各時限に展開する
- 読み取れない文字は推測せず""にする`;

function stripFence(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}

// モデルの応答からJSONを取り出す。余計な前置き・後書きが付いていても {…} の範囲を抜き出す
export function extractTimetableJson(text: string): unknown {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // ignore and try brace extraction
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no-json");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sanitize(raw: unknown) {
  const table = emptyTimetable();
  const list: unknown = (raw as { slots?: unknown } | null)?.slots ?? raw;
  if (!Array.isArray(list)) return table;
  for (const s of list.slice(0, 60)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const day = typeof o.day === "number" ? Math.floor(o.day) : -1;
    const period = typeof o.period === "number" ? Math.floor(o.period) : -1;
    if (day < 0 || day > 4 || period < 1 || period > 6) continue;
    table[day][period - 1] = {
      subject: typeof o.subject === "string" ? o.subject.slice(0, 30) : "",
      content: typeof o.content === "string" ? o.content.slice(0, 100) : "",
    };
  }
  return table;
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return Response.json(
      { ok: false, error: "時間割の写真取り込みには GEMINI_API_KEY の設定が必要です（.env.local）。手入力でも登録できます。" },
      { status: 501 },
    );
  }
  const tooLarge = checkContentLength(request, MAX_BODY_BYTES);
  if (tooLarge) {
    return Response.json({ ok: false, error: tooLarge }, { status: 413 });
  }
  let image: File | null = null;
  try {
    const form = await boundRequestBody(request, MAX_BODY_BYTES).formData();
    const v = form.get("image");
    if (v && typeof v === "object" && typeof (v as File).arrayBuffer === "function") {
      image = v as File;
    }
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return Response.json({ ok: false, error: bodyTooLargeMessage(err.maxBytes) }, { status: 413 });
    }
    return Response.json({ ok: false, error: "リクエストの形式が不正です" }, { status: 400 });
  }
  if (!image) {
    return Response.json({ ok: false, error: "画像を指定してください" }, { status: 400 });
  }
  if (!image.type.startsWith("image/")) {
    return Response.json({ ok: false, error: "画像ファイルを指定してください" }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return Response.json({ ok: false, error: "画像は8MB以内のものを使用してください" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await image.arrayBuffer()).toString("base64");
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "この時間割を読み取ってください。" },
            { inlineData: { mimeType: image.type || "image/jpeg", data: buf } },
          ],
        },
      ],
    });
    let res: Response | null = null;
    let lastStatus = 0;
    let lastBody = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1) + Math.random() * 500));
      }
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(60000) },
      );
      if (res.ok) break;
      lastStatus = res.status;
      lastBody = await res.text();
      if (res.status !== 429 && res.status !== 500 && res.status !== 502 && res.status !== 503 && res.status !== 504) break;
    }
    if (!res || !res.ok) {
      let detail = lastBody.slice(0, 200);
      try {
        const json = JSON.parse(lastBody) as { error?: { message?: unknown } };
        if (typeof json?.error?.message === "string" && json.error.message) {
          detail = json.error.message.slice(0, 200);
        }
      } catch {
        // ignore
      }
      return Response.json({ ok: false, error: `時間割の読み取りに失敗しました (HTTP ${lastStatus}): ${detail}` }, { status: 502 });
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "")
      .join("");
    let parsed: unknown = null;
    try {
      parsed = extractTimetableJson(text);
    } catch {
      return Response.json({ ok: false, error: "時間割の読み取り結果を解析できませんでした。写真を明るく・正面から撮り直してください" }, { status: 502 });
    }
    return Response.json({ ok: true, timetable: sanitize(parsed) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "時間割の読み取りに失敗しました";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
