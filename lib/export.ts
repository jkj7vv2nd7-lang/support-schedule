import { Document, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { DAYS, PERIODS, slotKey, type Aide, type ExchangeClass, type Student, type WeekPlan } from "@/lib/types";
import { addDays, formatWeek } from "@/lib/schedule";

export type WeekExportInput = {
  week: WeekPlan;
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
};

export type WeekExportLayouts = { sheets: boolean; overview: boolean; exchange: boolean };

export function normalizeLayouts(v: unknown): WeekExportLayouts {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    sheets: o.sheets !== false,
    overview: o.overview !== false,
    exchange: o.exchange !== false,
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

// セル文字列（行配列）を作る共通ロジック
function aideName(aides: Aide[], id: string | null): string {
  if (!id) return "";
  return aides.find((a) => a.id === id)?.name ?? "";
}

function staffOf(aides: Aide[], teacher: string, aideId: string | null): string {
  return [teacher, aideName(aides, aideId)].filter(Boolean).join("・");
}

// 児童別シート: { title, header[], rows[][] }（セル内は改行区切り）
function studentSheet(input: WeekExportInput, sid: string): { title: string; header: string[]; rows: string[][] } | null {
  const st = input.students.find((s) => s.id === sid);
  if (!st || !input.week.cells[sid]) return null;
  const header = ["曜日", ...PERIODS.map((p) => `${p}時限`)];
  const rows = DAYS.map((d, day) => {
    const row = [`${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`];
    for (const p of PERIODS) {
      const c = input.week.cells[sid]?.[slotKey(day, p)];
      const lines = [`[${c?.place === "exchange" ? "交流" : "支援"}] ${c?.subject ?? ""}`];
      if (c?.content) lines.push(c.content);
      const staff = staffOf(input.aides, c?.teacher ?? "", c?.aideId ?? null);
      if (staff) lines.push(staff);
      row.push(lines.join("\n"));
    }
    return row;
  });
  return { title: st.name, header, rows };
}

// 全体一覧: rows = 曜日×児童
function overviewRows(input: WeekExportInput): { header: string[]; rows: string[][] } {
  const header = ["曜日", "児童", ...PERIODS.map((p) => `${p}時限`)];
  const rows: string[][] = [];
  DAYS.forEach((d, day) => {
    for (const s of input.students) {
      if (!input.week.cells[s.id]) continue;
      const row = [`${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`, s.name];
      for (const p of PERIODS) {
        const c = input.week.cells[s.id]?.[slotKey(day, p)];
        const aide = aideName(input.aides, c?.aideId ?? null);
        row.push(`${c?.place === "exchange" ? "交流" : ""}${c?.subject ?? ""}${aide ? `（${aide}）` : ""}`);
      }
      rows.push(row);
    }
  });
  return { header, rows };
}

// 交流クラス別: rows = 曜日×（クラス＋支援）
function exchangeRows(input: WeekExportInput): { header: string[]; rows: string[][] } {
  const header = ["曜日", "クラス", ...PERIODS.map((p) => `${p}時限`)];
  const rows: string[][] = [];
  DAYS.forEach((d, day) => {
    const dayLabel = `${d}（${addDays(input.week.weekStart, day).slice(5).replace("-", "/")}）`;
    for (const cls of input.classes) {
      const row = [dayLabel, cls.name];
      for (const p of PERIODS) {
        const key = slotKey(day, p);
        const inClass = input.students.filter((s) => {
          const c = input.week.cells[s.id]?.[key];
          if (!c || c.place !== "exchange") return false;
          return (c.classId ?? s.exchangeClassId) === cls.id;
        });
        if (inClass.length === 0) {
          row.push("―");
          continue;
        }
        const slot = cls.timetable[day]?.[p - 1];
        const subj = slot?.subject || inClass.map((s) => input.week.cells[s.id]?.[key]?.subject ?? "").find(Boolean) || "";
        const cont = slot?.content || inClass.map((s) => input.week.cells[s.id]?.[key]?.content ?? "").find(Boolean) || "";
        const staff = Array.from(
          new Set(
            inClass.flatMap((s) => {
              const c = input.week.cells[s.id]?.[key];
              return [c?.teacher ?? "", aideName(input.aides, c?.aideId ?? null)];
            }).filter(Boolean),
          ),
        ).join("・");
        const lines = [inClass.map((s) => s.name).join("・")];
        if (subj) lines.push(`${subj}${cont ? `：${cont}` : ""}`);
        if (staff) lines.push(staff);
        row.push(lines.join("\n"));
      }
      rows.push(row);
    }
    const inRoom = (p: number) =>
      input.students.filter((s) => {
        const c = input.week.cells[s.id]?.[slotKey(day, p)];
        return c && c.place !== "exchange";
      });
    const row = [dayLabel, "支援学級"];
    for (const p of PERIODS) {
      const list = inRoom(p);
      row.push(
        list.length === 0
          ? "―"
          : list.map((s) => `${s.name}${input.week.cells[s.id]?.[slotKey(day, p)]?.subject ? `：${input.week.cells[s.id]?.[slotKey(day, p)]?.subject}` : ""}`).join("\n"),
      );
    }
    rows.push(row);
  });
  return { header, rows };
}

/* ============================== Excel ============================== */

export async function buildWeekXlsx(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const title = `週予定表 ${input.week.weekStart}（${formatWeek(input.week.weekStart)}）`;
  const putTable = (ws: ExcelJS.Worksheet, header: string[], rows: string[][]) => {
    const h = ws.addRow(header);
    h.font = { bold: true };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE8E4" } };
    for (const r of rows) {
      const row = ws.addRow(r);
      row.alignment = { vertical: "top", wrapText: true };
    }
    ws.columns = header.map((_, i) => ({
      width: Math.min(40, Math.max(10, ...rows.map((r) => Math.min(40, (r[i] ?? "").length + 2)))),
    }));
  };
  const ws1 = wb.addWorksheet("児童別");
  ws1.addRow([title]);
  if (layouts.sheets) {
    for (const s of input.students) {
      const sheet = studentSheet(input, s.id);
      if (!sheet) continue;
      ws1.addRow([]);
      ws1.addRow([sheet.title]).font = { bold: true, size: 12 };
      putTable(ws1, sheet.header, sheet.rows);
    }
  }
  if (layouts.overview) {
    const ws2 = wb.addWorksheet("全体一覧");
    ws2.addRow([title]);
    const ov = overviewRows(input);
    putTable(ws2, ov.header, ov.rows);
  }
  if (layouts.exchange) {
    const ws3 = wb.addWorksheet("交流クラス別");
    ws3.addRow([title]);
    const ex = exchangeRows(input);
    putTable(ws3, ex.header, ex.rows);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ============================== Word ============================== */

const FONT = { ascii: "Yu Gothic", hAnsi: "Yu Gothic", eastAsia: "Yu Gothic" };

function docxTable(header: string[], rows: string[][]) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const even = Math.max(1, Math.floor(100 / colCount));
  const widths = Array.from({ length: colCount }, (_, i) => (i === 0 ? 100 - even * (colCount - 1) : even));
  const cell = (text: string, isHeader: boolean, w: number) =>
    new TableCell({
      width: { size: widths[w] ?? even, type: WidthType.PERCENTAGE },
      shading: isHeader ? { type: "clear", fill: "DDE8E4", color: "auto" } : undefined,
      children: [
        new Paragraph({
          children: [new TextRun({ text: text || " ", bold: isHeader, size: 16, font: FONT })],
          spacing: { after: 0 },
        }),
      ],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ...(header.length > 0 ? [new TableRow({ children: header.map((h, i) => cell(h, true, i)), tableHeader: true, cantSplit: true })] : []),
      ...rows.map((r) => new TableRow({ children: r.map((t, i) => cell(t, false, i)), cantSplit: true })),
    ],
  });
}

function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] });
}

export async function buildWeekDocx(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true }): Promise<Buffer> {
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
    const ex = exchangeRows(input);
    children.push(docxTable(ex.header, ex.rows));
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [{ children }],
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
  const widths = Array.from({ length: colCount }, () => c.usable / colCount);
  const pad = 3;
  const fontSize = 8;
  const lineH = 11;
  const wrap = (text: string, i: number): string[] => {
    const w = Math.max((widths[i] ?? c.usable / colCount) - pad * 2, 8);
    const cols = Math.max(Math.floor(w / fontSize), 1);
    const out: string[] = [];
    for (let k = 0; k < text.length; k += cols) out.push(text.slice(k, k + cols));
    return out.length > 0 ? out : [""];
  };
  const rowH = (cells: string[]): number => {
    let max = 0;
    cells.forEach((txt, i) => {
      const h = wrap(txt, i).length * lineH + pad * 2;
      if (h > max) max = h;
    });
    return max;
  };
  const drawRow = (cells: string[], isHeader: boolean, sy: number) => {
    const h = rowH(cells);
    let x = c.left;
    c.doc.fontSize(fontSize);
    cells.forEach((txt, i) => {
      const w = widths[i] ?? c.usable / colCount;
      if (isHeader) {
        c.doc.save();
        c.doc.rect(x, sy, w, h).fill("#DDE8E4");
        c.doc.restore();
      }
      c.doc.rect(x, sy, w, h).stroke("#BBBBBB");
      c.doc.fillColor(isHeader ? "#0B3B36" : "#1F1F1F");
      wrap(txt, i).forEach((line, li) => c.doc.text(line, x + pad, sy + pad + li * lineH, { width: w - pad * 2 }));
      x += w;
    });
  };
  const draw = (cells: string[], isHeader: boolean) => {
    const h = rowH(cells);
    if (c.y + h > 595.28 - c.top) {
      c.doc.addPage();
      c.y = c.top;
      // 長い表の続きには表頭を繰り返す
      if (!isHeader && header.length > 0) {
        const hh = rowH(header);
        drawRow(header, true, c.y);
        c.y += hh;
      }
    }
    drawRow(cells, isHeader, c.y);
    c.y += h;
  };
  if (header.length > 0) draw(header, true);
  for (const r of rows) {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    draw(padded, false);
  }
  c.y += 8;
}

export async function buildWeekPdf(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true }): Promise<Buffer> {
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
    const ex = exchangeRows(input);
    pdfTable(c, ex.header, ex.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))));
  }
  return collectPdf(c.doc);
}
