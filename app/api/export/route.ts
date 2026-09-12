import { buildWeekDocx, buildWeekPdf, buildWeekXlsx, sanitizeFileName } from "@/lib/export";
import { isValidAide, isValidClass, isValidStudent, isValidWeek } from "@/lib/storage";
import { checkContentLength } from "@/lib/api-guard";

export const runtime = "nodejs";

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function POST(request: Request) {
  const tooLarge = checkContentLength(request, MAX_BODY_BYTES);
  if (tooLarge) {
    return Response.json({ ok: false, error: tooLarge }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "リクエストの形式が不正です" }, { status: 400 });
  }
  const { format, data } = (body ?? {}) as { format?: string; data?: unknown };
  if (format !== "pdf" && format !== "xlsx" && format !== "docx") {
    return Response.json({ ok: false, error: "出力形式は pdf / xlsx / docx を指定してください" }, { status: 400 });
  }
  if (!data || typeof data !== "object") {
    return Response.json({ ok: false, error: "出力するデータがありません" }, { status: 400 });
  }
  const d = data as Record<string, unknown>;
  const week = d.week;
  const students = Array.isArray(d.students) ? d.students : null;
  const aides = Array.isArray(d.aides) ? d.aides : null;
  const classes = Array.isArray(d.classes) ? d.classes : null;
  if (
    !isValidWeek(week) ||
    !students || !students.every(isValidStudent) ||
    !aides || !aides.every(isValidAide) ||
    !classes || !classes.every(isValidClass)
  ) {
    return Response.json({ ok: false, error: "出力するデータの形式が正しくありません" }, { status: 400 });
  }

  try {
    const input = { week, students, aides, classes };
    const buffer =
      format === "pdf" ? await buildWeekPdf(input) : format === "xlsx" ? await buildWeekXlsx(input) : await buildWeekDocx(input);
    const base = sanitizeFileName(`週予定表${week.weekStart}`);
    const fileName = `${base}.${format}`;
    const asciiFallback = base.replace(/[^\x20-\x7E]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").trim() || "schedule";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": TYPES[format],
        "content-disposition": `attachment; filename="${asciiFallback}.${format}"; filename*=UTF-8''${encodeRfc5987(fileName)}`,
        "content-length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "エクスポートに失敗しました";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
