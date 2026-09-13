import { BorderStyle, Document, Packer, PageBreak, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType, convertMillimetersToTwip } from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { DAYS, PERIODS, slotKey, type Aide, type ExchangeClass, type Student, type WeekPlan } from "@/lib/types";
import { addDays, daySections, formatWeek } from "@/lib/schedule";

export type WeekExportInput = {
  week: WeekPlan;
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
};

export type WeekExportLayouts = { sheets: boolean; overview: boolean; exchange: boolean; aides: boolean; classDaily: boolean; classOverview: boolean };

export function normalizeLayouts(v: unknown): WeekExportLayouts {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    sheets: o.sheets !== false,
    overview: o.overview !== false,
    exchange: o.exchange !== false,
    aides: o.aides !== false,
    classDaily: o.classDaily === true,
    classOverview: o.classOverview === true,
  };
}

export function sanitizeFileName(name: unknown): string {
  const src = typeof name === "string" ? name : "";
  const clean = src
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。．]+$/, "")
    .trim()
    .slice(0, 60);
  return clean || "export";
}

// 表の列幅比率（先頭列＝曜日/クラス名などのラベル列は少し狭く、残りは均等割り）
// 戻り値は合計1になる比率の配列
function columnWeights(colCount: number): number[] {
  if (colCount <= 1) return [1];
  const firstShare = colCount >= 5 ? 0.7 : 1; // 先頭列は残り列の70%幅
  const restCount = colCount - 1;
  const total = firstShare + restCount;
  return [firstShare / total, ...Array.from({ length: restCount }, () => 1 / total)];
}

// セル文字列（行配列）を作る共通ロジック
function aideName(aides: Aide[], id: string | null): string {
  if (!id) return "";
  return aides.find((a) => a.id === id)?.name ?? "";
}

function staffOf(aides: Aide[], teacher: string, aideId: string | null): string {
  return [teacher, aideName(aides, aideId)].filter(Boolean).join("・");
}

function absentDaysOf(input: WeekExportInput, sid: string): number[] {
  const days = input.week.absent?.[sid];
  return Array.isArray(days) ? days.filter((d): d is number => typeof d === "number") : [];
}

// 児童別シート: { title, header[], rows[][] }（セル内は改行区切り）
function studentSheet(input: WeekExportInput, sid: string): { title: string; header: string[]; rows: string[][]; notes: string } | null {
  const st = input.students.find((s) => s.id === sid);
  if (!st || !input.week.cells[sid]) return null;
  const absentDays = Array.isArray(input.week.absent?.[sid]) ? (input.week.absent as Record<string, number[]>)[sid] : [];
  const header = ["曜日", ...PERIODS.map((p) => `${p}時限`)];
  const rows = DAYS.map((d, day) => {
    const row = [`${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`];
    for (const p of PERIODS) {
      if (absentDays.includes(day)) {
        row.push("欠席");
        continue;
      }
      const c = input.week.cells[sid]?.[slotKey(day, p)];
      const lines = [`[${c?.place === "exchange" ? "交流" : "支援"}] ${c?.subject ?? ""}`];
      if (c?.content) lines.push(c.content);
      const staff = staffOf(input.aides, c?.teacher ?? "", c?.aideId ?? null);
      if (staff) lines.push(staff);
      row.push(lines.join("\n"));
    }
    return row;
  });
  return { title: st.name, header, rows, notes: typeof st.notes === "string" ? st.notes : "" };
}

// 介助員別連絡票: { title, header, rows }（行=曜日、列=時限）
function aideSheet(input: WeekExportInput, aideId: string): { title: string; header: string[]; rows: string[][] } | null {
  const aide = input.aides.find((a) => a.id === aideId);
  if (!aide) return null;
  const header = ["曜日", ...PERIODS.map((p) => `${p}時限`)];
  const rows = DAYS.map((d, day) => {
    const row = [`${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`];
    for (const p of PERIODS) {
      const key = slotKey(day, p);
      const assigned = input.students.filter(
        (s) => input.week.cells[s.id]?.[key]?.aideId === aideId && !absentDaysOf(input, s.id).includes(day),
      );
      if (assigned.length === 0) {
        row.push("―");
        continue;
      }
      row.push(
        assigned
          .map((s) => {
            const c = input.week.cells[s.id]?.[key];
            const place = c?.place === "exchange" ? "交流" : "支援";
            return `${s.name}：${place}${c?.subject ?? ""}${c?.content ? `（${c.content}）` : ""}`;
          })
          .join("\n"),
      );
    }
    return row;
  });
  return { title: `${aide.name}（介助）`, header, rows };
}
function overviewRows(input: WeekExportInput): { header: string[]; rows: string[][] } {
  const header = ["曜日", "児童", ...PERIODS.map((p) => `${p}時限`)];
  const rows: string[][] = [];
  DAYS.forEach((d, day) => {
    for (const s of input.students) {
      if (!input.week.cells[s.id]) continue;
      const absent = absentDaysOf(input, s.id).includes(day);
      const row = [`${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`, s.name];
      for (const p of PERIODS) {
        if (absent) {
          row.push("欠席");
          continue;
        }
        const c = input.week.cells[s.id]?.[slotKey(day, p)];
        const aide = aideName(input.aides, c?.aideId ?? null);
        row.push(`${c?.place === "exchange" ? "交流" : ""}${c?.subject ?? ""}${aide ? `（${aide}）` : ""}`);
      }
      rows.push(row);
    }
  });
  return { header, rows };
}

// クラス別（日ごと）: 手書き時間割に近い様式。列=曜日、行=予定/朝活動/時限/連絡等/下校時刻
function classDaySheet(input: WeekExportInput, classId: string): { title: string; header: string[]; rows: string[][] } | null {
  const cls = input.classes.find((c) => c.id === classId);
  if (!cls) return null;
  const attendees = input.students.filter((s) => s.exchangeClassId === classId);
  if (attendees.length === 0) return null;
  const title = `${cls.name}　${attendees.map((s) => s.name).join("・")}`;
  const header = ["", ...DAYS.map((d, day) => `${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`)];
  const rows: string[][] = [];
  const hasAny = (values: (string | undefined)[]) => values.some((v) => (v ?? "").trim().length > 0);

  const dayNotes = DAYS.map((_, day) => input.week.dayNotes?.[day] ?? "");
  if (hasAny(dayNotes)) rows.push(["予定", ...dayNotes]);

  const morning = DAYS.map((_, day) => cls.morning?.[day] ?? "");
  if (hasAny(morning)) rows.push(["朝活動", ...morning]);

  for (const p of PERIODS) {
    rows.push([
      `${p}`,
      ...DAYS.map((_, day) => {
        const slot = cls.timetable[day]?.[p - 1];
        const lines: string[] = [];
        if (slot?.subject) lines.push(slot.subject);
        if (slot?.content) lines.push(slot.content);
        const staffSet = new Set<string>();
        for (const s of attendees) {
          const c = input.week.cells[s.id]?.[slotKey(day, p)];
          if (c?.classId !== classId) continue;
          const staff = staffOf(input.aides, c.teacher ?? "", c.aideId ?? null);
          if (staff) staffSet.add(staff);
        }
        if (staffSet.size > 0) lines.push(Array.from(staffSet).join("・"));
        return lines.join("\n");
      }),
    ]);
  }

  if (cls.notice) rows.push(["連絡等", ...DAYS.map(() => cls.notice ?? "")]);

  const dismissal = DAYS.map((_, day) => cls.dismissal?.[day] ?? "");
  if (hasAny(dismissal)) rows.push(["下校時刻", ...dismissal]);

  return { title, header, rows };
}

// クラス×曜日 一覧（A4横1枚向け）: 児童名は出さず、クラス・時限ごとの教科／内容／担当のみ
// 列は元の手書き時間割に合わせ、曜日ごとにまとめて（月:各クラス→火:各クラス…）並べる
function classOverviewGrid(input: WeekExportInput): { header: string[]; rows: string[][] } {
  const activeClasses = input.classes.filter((c) => input.students.some((s) => s.exchangeClassId === c.id));
  const columns = DAYS.flatMap((d, day) => activeClasses.map((c) => ({ day, cls: c, label: `${d}　${c.name}` })));
  const header = ["時限", ...columns.map((col) => col.label)];
  const rows: string[][] = PERIODS.map((p) => [
    `${p}`,
    ...columns.map(({ day, cls }) => {
      const slot = cls.timetable[day]?.[p - 1];
      const lines: string[] = [];
      if (slot?.subject) lines.push(slot.subject);
      if (slot?.content) lines.push(slot.content);
      const staffSet = new Set<string>();
      for (const s of input.students) {
        if (s.exchangeClassId !== cls.id) continue;
        const c = input.week.cells[s.id]?.[slotKey(day, p)];
        if (c?.classId !== cls.id) continue;
        const staff = staffOf(input.aides, c.teacher ?? "", c.aideId ?? null);
        if (staff) staffSet.add(staff);
      }
      if (staffSet.size > 0) lines.push(Array.from(staffSet).join("・"));
      return lines.join("\n");
    }),
  ]);
  return { header, rows };
}

/* ============================== Excel ============================== */

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBBBBBB" } },
  left: { style: "thin", color: { argb: "FFBBBBBB" } },
  bottom: { style: "thin", color: { argb: "FFBBBBBB" } },
  right: { style: "thin", color: { argb: "FFBBBBBB" } },
};

// セル内は改行区切りの複数行になり得るため、実際に画面に出る「最長の1行」の文字数で幅を決める
function maxLineLength(text: string): number {
  return Math.max(0, ...text.split("\n").map((l) => l.length));
}

export async function buildWeekXlsx(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const title = `週予定表 ${input.week.weekStart}（${formatWeek(input.week.weekStart)}）`;
  const putTable = (ws: ExcelJS.Worksheet, header: string[], rows: string[][]) => {
    const h = ws.addRow(header);
    h.font = { bold: true };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
    h.eachCell((cell) => {
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    rows.forEach((r, ri) => {
      const row = ws.addRow(r);
      row.alignment = { vertical: "top", wrapText: true };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = THIN_BORDER;
        if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6FB" } };
      });
    });
    const weights = columnWeights(header.length);
    ws.columns = header.map((label, i) => {
      const content = Math.max(label.length, ...rows.map((r) => maxLineLength(r[i] ?? "")));
      // 内容量からの目安幅と、列比率からの下限幅の大きい方を採用する
      const byContent = Math.min(40, Math.max(8, content + 2));
      const byWeight = Math.round(weights[i] * (header.length >= 5 ? 12 : 16));
      return { width: Math.max(byContent, byWeight) };
    });
  };
  const ws1 = wb.addWorksheet("児童別", { views: [{ showGridLines: false }] });
  ws1.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 } };
  ws1.addRow([title]).font = { bold: true, size: 13 };
  if (layouts.sheets) {
    for (const s of input.students) {
      const sheet = studentSheet(input, s.id);
      if (!sheet) continue;
      ws1.addRow([]);
      ws1.addRow([sheet.title]).font = { bold: true, size: 12 };
      putTable(ws1, sheet.header, sheet.rows);
      if (sheet.notes) ws1.addRow([`〔配慮メモ〕${sheet.notes}`]);
    }
  }
  const pageSetup: Partial<ExcelJS.PageSetup> = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 } };
  if (layouts.overview) {
    const ws2 = wb.addWorksheet("全体一覧", { views: [{ showGridLines: false }] });
    ws2.pageSetup = pageSetup;
    ws2.addRow([title]).font = { bold: true, size: 13 };
    const ov = overviewRows(input);
    putTable(ws2, ov.header, ov.rows);
  }
  if (layouts.exchange) {
    const ws3 = wb.addWorksheet("交流クラス別", { views: [{ showGridLines: false }] });
    ws3.pageSetup = pageSetup;
    ws3.addRow([title]).font = { bold: true, size: 13 };
    for (const sec of daySections(input)) {
      ws3.addRow([]);
      ws3.addRow([`${sec.weekday}（${sec.date}）`]).font = { bold: true, size: 12 };
      putTable(ws3, ["クラス", ...PERIODS.map((p) => `${p}時限`)], sec.rows.map((r) => [r.label, ...r.cells]));
    }
  }
  if (layouts.aides) {
    const ws4 = wb.addWorksheet("介助員別", { views: [{ showGridLines: false }] });
    ws4.pageSetup = pageSetup;
    ws4.addRow([title]).font = { bold: true, size: 13 };
    for (const a of input.aides) {
      const sheet = aideSheet(input, a.id);
      if (!sheet) continue;
      ws4.addRow([]);
      ws4.addRow([sheet.title]).font = { bold: true, size: 12 };
      putTable(ws4, sheet.header, sheet.rows);
    }
  }
  if (layouts.classDaily) {
    const ws5 = wb.addWorksheet("クラス別(日ごと)", { views: [{ showGridLines: false }] });
    ws5.pageSetup = pageSetup;
    ws5.addRow([title]).font = { bold: true, size: 13 };
    for (const c of input.classes) {
      const sheet = classDaySheet(input, c.id);
      if (!sheet) continue;
      ws5.addRow([]);
      ws5.addRow([sheet.title]).font = { bold: true, size: 12 };
      putTable(ws5, sheet.header, sheet.rows);
    }
  }
  if (layouts.classOverview) {
    const ws6 = wb.addWorksheet("クラス×曜日 一覧", { views: [{ showGridLines: false }] });
    // A4横1枚に収まるよう、幅・高さとも1ページに強制的に収縮する
    ws6.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { top: 0.3, bottom: 0.3, left: 0.25, right: 0.25, header: 0.15, footer: 0.15 } };
    ws6.addRow([title]).font = { bold: true, size: 13 };
    const grid = classOverviewGrid(input);
    putTable(ws6, grid.header, grid.rows);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ============================== Word ============================== */

const FONT = { ascii: "Yu Gothic", hAnsi: "Yu Gothic", eastAsia: "Yu Gothic" };

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };
const CELL_MARGIN = { top: 60, bottom: 60, left: 100, right: 100 };
const ZEBRA_FILL = "F4F6FB";

// パーセント幅は丸め誤差が出るため最終列で帳尻を合わせ、合計がちょうど100になるようにする
function docxColumnWidths(colCount: number): number[] {
  const weights = columnWeights(colCount);
  const widths = weights.map((w) => Math.round(w * 100));
  const diff = 100 - widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += diff;
  return widths;
}

function docxTable(header: string[], rows: string[][], fontSize = 18) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const widths = docxColumnWidths(colCount);
  const cell = (text: string, isHeader: boolean, w: number, zebra: boolean) =>
    new TableCell({
      width: { size: widths[w] ?? Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
      borders: CELL_BORDERS,
      margins: CELL_MARGIN,
      verticalAlign: VerticalAlign.CENTER,
      shading: isHeader ? { type: "clear", fill: "DBEAFE", color: "auto" } : zebra ? { type: "clear", fill: ZEBRA_FILL, color: "auto" } : undefined,
      children: text.split("\n").map(
        (line, i) =>
          new Paragraph({
            children: [new TextRun({ text: line || " ", bold: isHeader, size: fontSize, font: FONT })],
            spacing: { after: 0 },
            keepLines: true,
            ...(i === 0 ? {} : { spacing: { before: 20, after: 0 } }),
          }),
      ),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ...(header.length > 0 ? [new TableRow({ children: header.map((h, i) => cell(h, true, i, false)), tableHeader: true, cantSplit: true })] : []),
      ...rows.map((r, ri) => new TableRow({ children: r.map((t, i) => cell(t, false, i, ri % 2 === 1)), cantSplit: true })),
    ],
  });
}

function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] });
}

export async function buildWeekDocx(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false }): Promise<Buffer> {
  const title = `週予定表 ${input.week.weekStart}（${formatWeek(input.week.weekStart)}）`;
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 30, font: FONT })], spacing: { after: 80 } }),
  ];
  let started = false;
  const needBreak = () => {
    if (started) children.push(pageBreakPara());
    started = true;
  };
  if (layouts.sheets) {
    for (const s of input.students) {
      const sheet = studentSheet(input, s.id);
      if (!sheet) continue;
      needBreak();
      children.push(
        new Paragraph({ children: [new TextRun({ text: sheet.title, bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
        docxTable(sheet.header, sheet.rows),
      );
      if (sheet.notes) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `〔配慮メモ〕${sheet.notes}`, size: 18, font: FONT })],
            spacing: { before: 80, after: 80 },
          }),
        );
      }
    }
  }
  if (layouts.overview) {
    needBreak();
    children.push(
      new Paragraph({ children: [new TextRun({ text: "全体一覧", bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
    );
    const ov = overviewRows(input);
    children.push(docxTable(ov.header, ov.rows));
  }
  if (layouts.exchange) {
    needBreak();
    children.push(
      new Paragraph({ children: [new TextRun({ text: "交流クラス別", bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
    );
    for (const sec of daySections(input)) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `${sec.weekday}（${sec.date}）`, bold: true, size: 18, font: FONT })], spacing: { before: 120, after: 60 } }),
        docxTable(["クラス", ...PERIODS.map((p) => `${p}時限`)], sec.rows.map((r) => [r.label, ...r.cells])),
      );
    }
  }
  if (layouts.aides) {
    for (const a of input.aides) {
      const sheet = aideSheet(input, a.id);
      if (!sheet) continue;
      needBreak();
      children.push(
        new Paragraph({ children: [new TextRun({ text: sheet.title, bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
        docxTable(sheet.header, sheet.rows),
      );
    }
  }
  if (layouts.classDaily) {
    for (const c of input.classes) {
      const sheet = classDaySheet(input, c.id);
      if (!sheet) continue;
      needBreak();
      children.push(
        new Paragraph({ children: [new TextRun({ text: sheet.title, bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
        docxTable(sheet.header, sheet.rows),
      );
    }
  }
  if (layouts.classOverview) {
    needBreak();
    const grid = classOverviewGrid(input);
    children.push(
      new Paragraph({ children: [new TextRun({ text: "クラス×曜日 一覧", bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
      // 列数が多くなりやすい表なので、1ページに収まりやすいよう小さめのフォントで組む（用紙サイズによっては複数ページに分かれる場合があります）
      docxTable(grid.header, grid.rows, 13),
    );
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297),
            },
            margin: { top: 720, bottom: 720, left: 560, right: 560 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/* ============================== PDF ============================== */

const BUNDLED_FONT = path.join(process.cwd(), "assets", "fonts", "NotoSansCJKjp-Regular.otf");
const SYSTEM_FONTS = [
  "C:/Windows/Fonts/msgothic.ttc",
  "C:/Windows/Fonts/meiryo.ttc",
  "C:/Windows/Fonts/YuGothM.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
];

type PdfCtx = { doc: PDFKit.PDFDocument; fontName: string; y: number; top: number; left: number; usable: number };

function makePdf(): PdfCtx {
  const candidates = [process.env.EXPORT_PDF_FONT, BUNDLED_FONT, ...SYSTEM_FONTS].filter(Boolean) as string[];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
      doc.font(p);
      return { doc, fontName: p, y: 36, top: 36, left: 36, usable: 841.89 - 72 };
    } catch {
      continue;
    }
  }
  throw new Error("日本語PDFフォントを読み込めませんでした");
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (e: Error) => reject(e));
    doc.end();
  });
}

function pdfText(c: PdfCtx, text: string, size = 9, after = 3) {
  c.doc.font(c.fontName).fontSize(size).fillColor("#111111");
  for (const line of String(text ?? "").split("\n")) {
    if (c.y + size + 6 > 595.28 - c.top) {
      c.doc.addPage();
      c.y = c.top;
    }
    c.doc.text(line || " ", c.left, c.y, { width: c.usable });
    c.y = c.doc.y + 1;
  }
  c.y += after;
}

// 役割の違う表はページを分ける（既に先頭なら改ページしない）
function pageBreak(c: PdfCtx) {
  if (c.y > c.top + 1) {
    c.doc.addPage();
    c.y = c.top;
  }
}

function pdfTable(c: PdfCtx, header: string[], rows: string[][]) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const weights = columnWeights(colCount);
  const widths = weights.map((w) => c.usable * w);
  const pad = 4;
  const fontSize = 8;
  const lineH = 11.5;
  // 実際のグリフ幅を測って詰め込む（全角・半角混在でも隙間なく折り返せる）
  const wrap = (text: string, i: number): string[] => {
    const w = Math.max((widths[i] ?? c.usable / colCount) - pad * 2, 8);
    const src = String(text ?? "");
    if (!src) return [""];
    c.doc.font(c.fontName).fontSize(fontSize);
    const lines: string[] = [];
    let line = "";
    for (const ch of Array.from(src)) {
      const candidate = line + ch;
      if (line && c.doc.widthOfString(candidate) > w) {
        lines.push(line);
        line = ch;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  };
  const rowH = (cells: string[]): number => {
    let max = 0;
    cells.forEach((txt, i) => {
      const h = wrap(txt, i).length * lineH + pad * 2;
      if (h > max) max = h;
    });
    return max;
  };
  const drawRow = (cells: string[], isHeader: boolean, sy: number, zebra: boolean) => {
    const h = rowH(cells);
    let x = c.left;
    c.doc.fontSize(fontSize);
    cells.forEach((txt, i) => {
      const w = widths[i] ?? c.usable / colCount;
      if (isHeader) {
        c.doc.save();
        c.doc.rect(x, sy, w, h).fill("#DBEAFE");
        c.doc.restore();
      } else if (zebra) {
        c.doc.save();
        c.doc.rect(x, sy, w, h).fill("#F4F6FB");
        c.doc.restore();
      }
      c.doc.rect(x, sy, w, h).stroke("#BBBBBB");
      c.doc.fillColor(isHeader ? "#1E3A8A" : "#1F1F1F");
      wrap(txt, i).forEach((line, li) => c.doc.text(line, x + pad, sy + pad + li * lineH, { width: w - pad * 2 }));
      x += w;
    });
  };
  const draw = (cells: string[], isHeader: boolean, zebra: boolean) => {
    const h = rowH(cells);
    if (c.y + h > 595.28 - c.top) {
      c.doc.addPage();
      c.y = c.top;
      // 長い表の続きには表頭を繰り返す
      if (!isHeader && header.length > 0) {
        const hh = rowH(header);
        drawRow(header, true, c.y, false);
        c.y += hh;
      }
    }
    drawRow(cells, isHeader, c.y, zebra);
    c.y += h;
  };
  if (header.length > 0) draw(header, true, false);
  rows.forEach((r, ri) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    draw(padded, false, ri % 2 === 1);
  });
  c.y += 8;
}

// A4横1枚に必ず収める専用の表描画。列が多くページをまたぎそうな場合は
// フォントを段階的に縮小して、1ページの高さに収まるサイズを探す。
function pdfSinglePageTable(c: PdfCtx, header: string[], rows: string[][]) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const weights = columnWeights(colCount);
  const widths = weights.map((w) => c.usable * w);
  const maxHeight = 595.28 - c.top - 36; // 用紙下端の余白ぶんを差し引いた1ページの使用可能高さ
  const pad = 3;

  const measure = (fontSize: number, lineH: number) => {
    c.doc.font(c.fontName).fontSize(fontSize);
    const wrap = (text: string, i: number): string[] => {
      const w = Math.max((widths[i] ?? c.usable / colCount) - pad * 2, 6);
      const src = String(text ?? "");
      if (!src) return [""];
      const lines: string[] = [];
      let line = "";
      for (const ch of Array.from(src)) {
        const candidate = line + ch;
        if (line && c.doc.widthOfString(candidate) > w) {
          lines.push(line);
          line = ch;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines.length > 0 ? lines : [""];
    };
    const rowH = (cells: string[]): number => Math.max(...cells.map((t, i) => wrap(t, i).length * lineH + pad * 2));
    const headerH = header.length > 0 ? rowH(header) : 0;
    const bodyH = rows.reduce((sum, r) => sum + rowH(r), 0);
    return { wrap, rowH, headerH, bodyH, total: headerH + bodyH };
  };

  // 8ptから段階的に縮小し、1ページに収まる最小限のフォントサイズを探す
  const candidates: [number, number][] = [
    [8, 11],
    [7, 9.5],
    [6, 8],
    [5.5, 7.2],
    [5, 6.5],
    [4.5, 6],
  ];
  let chosen = measure(candidates[candidates.length - 1][0], candidates[candidates.length - 1][1]);
  let chosenSize = candidates[candidates.length - 1][0];
  for (const [fontSize, lineH] of candidates) {
    const m = measure(fontSize, lineH);
    if (m.total <= maxHeight) {
      chosen = m;
      chosenSize = fontSize;
      break;
    }
  }
  c.doc.fontSize(chosenSize);

  const drawRow = (cells: string[], isHeader: boolean, sy: number, h: number, zebra: boolean) => {
    let x = c.left;
    cells.forEach((txt, i) => {
      const w = widths[i] ?? c.usable / colCount;
      if (isHeader) {
        c.doc.save();
        c.doc.rect(x, sy, w, h).fill("#DBEAFE");
        c.doc.restore();
      } else if (zebra) {
        c.doc.save();
        c.doc.rect(x, sy, w, h).fill("#F4F6FB");
        c.doc.restore();
      }
      c.doc.rect(x, sy, w, h).stroke("#BBBBBB");
      c.doc.fillColor(isHeader ? "#1E3A8A" : "#1F1F1F");
      const lineH = (h - pad * 2) / Math.max(chosen.wrap(txt, i).length, 1);
      chosen.wrap(txt, i).forEach((line, li) => c.doc.text(line, x + pad, sy + pad + li * lineH, { width: w - pad * 2, lineBreak: false }));
      x += w;
    });
  };

  if (header.length > 0) {
    drawRow(header, true, c.y, chosen.headerH, false);
    c.y += chosen.headerH;
  }
  rows.forEach((r, ri) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    const h = chosen.rowH(padded);
    drawRow(padded, false, c.y, h, ri % 2 === 1);
    c.y += h;
  });
  c.y += 8;
}

export async function buildWeekPdf(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false }): Promise<Buffer> {
  const c = makePdf();
  const title = `週予定表 ${input.week.weekStart}（${formatWeek(input.week.weekStart)}）`;
  pdfText(c, title, 14, 4);
  let started = false;
  const needBreak = () => {
    if (started) pageBreak(c);
    started = true;
  };
  if (layouts.sheets) {
    for (const s of input.students) {
      const sheet = studentSheet(input, s.id);
      if (!sheet) continue;
      needBreak();
      pdfText(c, sheet.title, 11, 2);
      pdfTable(c, sheet.header, sheet.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))));
      if (sheet.notes) pdfText(c, `〔配慮メモ〕${sheet.notes}`, 9, 3);
    }
  }
  if (layouts.overview) {
    needBreak();
    pdfText(c, "全体一覧", 11, 2);
    const ov = overviewRows(input);
    pdfTable(c, ov.header, ov.rows);
  }
  if (layouts.exchange) {
    needBreak();
    pdfText(c, "交流クラス別", 11, 2);
    for (const sec of daySections(input)) {
      pdfText(c, `${sec.weekday}（${sec.date}）`, 10, 2);
      pdfTable(c, ["クラス", ...PERIODS.map((p) => `${p}時限`)], sec.rows.map((r) => [r.label, ...r.cells].map((x) => x.replace(/\n/g, "／"))));
    }
  }
  if (layouts.aides) {
    for (const a of input.aides) {
      const sheet = aideSheet(input, a.id);
      if (!sheet) continue;
      needBreak();
      pdfText(c, sheet.title, 11, 2);
      pdfTable(c, sheet.header, sheet.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))));
    }
  }
  if (layouts.classDaily) {
    for (const cls of input.classes) {
      const sheet = classDaySheet(input, cls.id);
      if (!sheet) continue;
      needBreak();
      pdfText(c, sheet.title, 11, 2);
      pdfTable(c, sheet.header, sheet.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))));
    }
  }
  if (layouts.classOverview) {
    needBreak();
    pdfText(c, "クラス×曜日 一覧", 11, 2);
    const grid = classOverviewGrid(input);
    pdfSinglePageTable(c, grid.header, grid.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))));
  }
  return collectPdf(c.doc);
}
