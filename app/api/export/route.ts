import { buildWeekDocx, buildWeekPdf, buildWeekXlsx, normalizeLayouts, sanitizeFileName } from "@/lib/export";
import { buildWeekCells } from "@/lib/schedule";
import { isValidAide, isValidClass, isValidStudent, isValidWeek, isValidWeekStart, normalizeSettings } from "@/lib/storage";
import { boundRequestBody, bodyTooLargeMessage, checkContentLength, isBodyTooLarge } from "@/lib/api-guard";

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
    body = await boundRequestBody(request, MAX_BODY_BYTES).json();
  } catch (err) {
    if (isBodyTooLarge(err)) {
      return Response.json({ ok: false, error: bodyTooLargeMessage(err.maxBytes) }, { status: 413 });
    }
    return Response.json({ ok: false, error: "リクエストの形式が不正です" }, { status: 400 });
  }
  const { format, data, layouts: rawLayouts } = (body ?? {}) as { format?: string; data?: unknown; layouts?: unknown };
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
  if (!isValidWeekStart(week.weekStart)) {
    return Response.json({ ok: false, error: "週の日付が正しくありません（YYYY-MM-DD形式の月曜を指定してください）" }, { status: 400 });
  }

  try {
    const layouts = normalizeLayouts(rawLayouts);
    if (!layouts.sheets && !layouts.overview && !layouts.exchange && !layouts.aides && !layouts.classDaily && !layouts.classOverview) {
      return Response.json({ ok: false, error: "出力する表を1つ以上選んでください" }, { status: 400 });
    }
    // クラス×曜日一覧は列数=5N+1になるため、交流クラスが多いと判読不能・Wordの列上限に当たる
    if (layouts.classOverview) {
      const activeCount = new Set(students.map((s) => s.exchangeClassId).filter((v): v is string => typeof v === "string" && v.length > 0)).size;
      if (activeCount > 10) {
        return Response.json({ ok: false, error: "交流クラスが多いため「クラス×曜日 一覧」は出力できません（11クラス以上）。「クラス別(日ごと)」をご利用ください" }, { status: 400 });
      }
    }
    // 登録後に追加された児童などのセル欠落を補完
    const fullCells = buildWeekCells(students, classes, week.cells);
    const settings = normalizeSettings((d as { settings?: unknown }).settings);
    const input = { week: { ...week, cells: fullCells }, students, aides, classes, settings };
    const buffer =
      format === "pdf" ? await buildWeekPdf(input, layouts) : format === "xlsx" ? await buildWeekXlsx(input, layouts) : await buildWeekDocx(input, layouts);
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
