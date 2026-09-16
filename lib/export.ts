import { BorderStyle, Document, Packer, PageBreak, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType, convertMillimetersToTwip } from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { DAYS, PERIODS, slotKey, type Aide, type ExchangeClass, type Student, type WeekPlan } from "@/lib/types";
import { addDays, classDayTable, classOverviewTable, daySections, exportTitle, sortClasses } from "@/lib/schedule";

export type WeekExportInput = {
  week: WeekPlan;
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
  // 学校名（印刷・出力の表題に付ける。全国の学校で使うための設定）
  settings?: { schoolName?: string };
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

// クラス別（日ごと）: 本体は lib/schedule の classDayTable（印刷と共用）
function classDaySheet(input: WeekExportInput, classId: string): { title: string; header: string[]; rows: string[][] } | null {
  return classDayTable(input, classId);
}

// クラス×曜日 一覧（A4横1枚向け）: 本体は lib/schedule の classOverviewTable（印刷と共用）
function classOverviewGrid(input: WeekExportInput): { header: string[]; rows: string[][]; dayStarts: number[]; dayEnds: number[] } {
  const t = classOverviewTable(input);
  const dayStarts: number[] = [];
  const dayEnds: number[] = [];
  t.columns.forEach((col, i) => {
    if (i > 0 && col.day !== t.columns[i - 1].day) dayStarts.push(i + 1); // +1 は先頭「時限」列ぶん
    if (i === t.columns.length - 1 || t.columns[i + 1].day !== col.day) dayEnds.push(i + 1);
  });
  return { header: t.header, rows: t.rows, dayStarts, dayEnds };
}

// 曜日×児童 行列で曜日が切り替わる本文行番号（0始まり）を返す
function dayGroupSeps(rows: string[][]): number[] {
  const seps: number[] = [];
  rows.forEach((r, i) => {
    if (i > 0 && r[0] !== rows[i - 1][0]) seps.push(i);
  });
  return seps;
}

// 曜日グループの最終行番号（囲みの下辺用）
function dayGroupEnds(rows: string[][]): number[] {
  const ends: number[] = [];
  rows.forEach((r, i) => {
    if (i === rows.length - 1 || rows[i + 1][0] !== r[0]) ends.push(i);
  });
  return ends;
}

/* ============================== Excel ============================== */

const THIN_SIDE: ExcelJS.Border = { style: "thin", color: { argb: "FFBBBBBB" } };
const MEDIUM_SIDE: ExcelJS.Border = { style: "medium", color: { argb: "FF666666" } };

// 表の区切り強調: colSeps=左罫を太くする列番号(0始まり)、colSepsR=右罫を太くする列番号、
// rowSeps=上罫を太くする本文行番号(0始まり)、rowSepsB=下罫を太くする本文行番号、
// boxCols=データ列すべてを左右で囲む、boxRows=本文行すべてを上下で囲む、outer=外枠を太くする
export type TableSepOpts = {
  colSeps?: number[];
  colSepsR?: number[];
  rowSeps?: number[];
  rowSepsB?: number[];
  boxCols?: boolean;
  boxRows?: boolean;
  strongHeader?: boolean;
  outer?: boolean;
};

export async function buildWeekXlsx(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const title = exportTitle(input.week.weekStart, input.settings?.schoolName);
  const putTable = (ws: ExcelJS.Worksheet, header: string[], rows: string[][], opts?: TableSepOpts) => {
    const colCount = header.length;
    const outer = opts?.outer !== false;
    const strongHeader = opts?.strongHeader !== false;
    const dataCols = Array.from({ length: Math.max(colCount - 1, 0) }, (_, i) => i + 1);
    const leftSet = new Set([...(opts?.colSeps ?? []), ...(opts?.boxCols ? dataCols : [])]);
    const rightSet = new Set([...(opts?.colSepsR ?? []), ...(opts?.boxCols ? dataCols : [])]);
    const boxRowIdx = opts?.boxRows ? rows.map((_, i) => i) : [];
    const topSet = new Set([...(opts?.rowSeps ?? []), ...boxRowIdx]);
    const bottomSet = new Set([...(opts?.rowSepsB ?? []), ...boxRowIdx]);
    const sides = (top: boolean, left: boolean, bottom: boolean, right: boolean): Partial<ExcelJS.Borders> => ({
      top: top ? MEDIUM_SIDE : THIN_SIDE,
      left: left ? MEDIUM_SIDE : THIN_SIDE,
      bottom: bottom ? MEDIUM_SIDE : THIN_SIDE,
      right: right ? MEDIUM_SIDE : THIN_SIDE,
    });
    const h = ws.addRow(header);
    h.font = { bold: true };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
    h.eachCell((cell, colNumber) => {
      const c = colNumber - 1;
      cell.border = sides(outer, (outer && c === 0) || leftSet.has(c), strongHeader, (outer && c === colCount - 1) || rightSet.has(c));
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    rows.forEach((r, ri) => {
      const row = ws.addRow(r);
      row.alignment = { vertical: "top", wrapText: true };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const c = colNumber - 1;
        cell.border = sides(
          topSet.has(ri),
          (outer && c === 0) || leftSet.has(c),
          bottomSet.has(ri) || (outer && ri === rows.length - 1),
          (outer && c === colCount - 1) || rightSet.has(c),
        );
        if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6FB" } };
      });
    });
    // 列幅は均等割り（先頭列は少し狭め）にしてA4いっぱいに広げる。折り返し表示前提。
    const totalUnits = 132;
    const firstW = 14;
    const rest = header.length > 1 ? Math.max(7, (totalUnits - firstW) / (header.length - 1)) : totalUnits;
    ws.columns = header.map((_, i) => ({ width: i === 0 ? firstW : rest }));
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
      putTable(ws1, sheet.header, sheet.rows, { boxRows: true });
      if (sheet.notes) ws1.addRow([`〔配慮メモ〕${sheet.notes}`]);
    }
  }
  const pageSetup: Partial<ExcelJS.PageSetup> = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { top: 0.4, bottom: 0.4, left: 0.3, right: 0.3, header: 0.2, footer: 0.2 } };
  if (layouts.overview) {
    const ws2 = wb.addWorksheet("全体一覧", { views: [{ showGridLines: false }] });
    ws2.pageSetup = pageSetup;
    ws2.addRow([title]).font = { bold: true, size: 13 };
    const ov = overviewRows(input);
    putTable(ws2, ov.header, ov.rows, { rowSeps: dayGroupSeps(ov.rows), rowSepsB: dayGroupEnds(ov.rows) });
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
      putTable(ws4, sheet.header, sheet.rows, { boxRows: true });
    }
  }
  if (layouts.classDaily) {
    const ws5 = wb.addWorksheet("クラス別(日ごと)", { views: [{ showGridLines: false }] });
    ws5.pageSetup = pageSetup;
    ws5.addRow([title]).font = { bold: true, size: 13 };
    for (const c of sortClasses(input.classes)) {
      const sheet = classDaySheet(input, c.id);
      if (!sheet) continue;
      ws5.addRow([]);
      ws5.addRow([sheet.title]).font = { bold: true, size: 12 };
      putTable(ws5, sheet.header, sheet.rows, { boxCols: true });
    }
  }
  if (layouts.classOverview) {
    const grid = classOverviewGrid(input);
    // 交流クラスが0件のときは「時限」1列の空表になるため出力しない
    if (grid.header.length > 1) {
      const ws6 = wb.addWorksheet("クラス×曜日 一覧", { views: [{ showGridLines: false }] });
      // A4横1枚に収まるよう、幅・高さとも1ページに強制的に収縮する
      ws6.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { top: 0.3, bottom: 0.3, left: 0.25, right: 0.25, header: 0.15, footer: 0.15 } };
      ws6.addRow([title]).font = { bold: true, size: 13 };
      putTable(ws6, grid.header, grid.rows, { colSeps: grid.dayStarts, colSepsR: grid.dayEnds });
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ============================== Word ============================== */

const FONT = { ascii: "Yu Gothic", hAnsi: "Yu Gothic", eastAsia: "Yu Gothic" };

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const CELL_BORDER_STRONG = { style: BorderStyle.SINGLE, size: 12, color: "666666" };
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

function docxTable(header: string[], rows: string[][], fontSize = 18, opts?: TableSepOpts) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const widths = docxColumnWidths(colCount);
  const outer = opts?.outer !== false;
  const strongHeader = opts?.strongHeader !== false;
  const dataCols = Array.from({ length: Math.max(colCount - 1, 0) }, (_, i) => i + 1);
  const leftSet = new Set([...(opts?.colSeps ?? []), ...(opts?.boxCols ? dataCols : [])]);
  const rightSet = new Set([...(opts?.colSepsR ?? []), ...(opts?.boxCols ? dataCols : [])]);
  const boxRowIdx = opts?.boxRows ? rows.map((_, i) => i) : [];
  const topSet = new Set([...(opts?.rowSeps ?? []), ...boxRowIdx]);
  const bottomSet = new Set([...(opts?.rowSepsB ?? []), ...boxRowIdx]);
  const cell = (text: string, isHeader: boolean, w: number, zebra: boolean, ri: number) => {
    const top = (isHeader ? outer : topSet.has(ri)) ? CELL_BORDER_STRONG : CELL_BORDER;
    const left = ((outer && w === 0) || leftSet.has(w)) ? CELL_BORDER_STRONG : CELL_BORDER;
    const bottom =
      (isHeader && strongHeader) || (!isHeader && (bottomSet.has(ri) || (outer && ri === rows.length - 1)))
        ? CELL_BORDER_STRONG
        : CELL_BORDER;
    const right = ((outer && w === colCount - 1) || rightSet.has(w)) ? CELL_BORDER_STRONG : CELL_BORDER;
    return new TableCell({
      width: { size: widths[w] ?? Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
      borders: { top, bottom, left, right },
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
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ...(header.length > 0 ? [new TableRow({ children: header.map((h, i) => cell(h, true, i, false, -1)), tableHeader: true, cantSplit: true })] : []),
      ...rows.map((r, ri) => new TableRow({ children: r.map((t, i) => cell(t, false, i, ri % 2 === 1, ri)), cantSplit: true })),
    ],
  });
}

function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] });
}

export async function buildWeekDocx(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false }): Promise<Buffer> {
  const title = exportTitle(input.week.weekStart, input.settings?.schoolName);
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
        docxTable(sheet.header, sheet.rows, 18, { boxRows: true }),
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
    children.push(docxTable(ov.header, ov.rows, 18, { rowSeps: dayGroupSeps(ov.rows), rowSepsB: dayGroupEnds(ov.rows) }));
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
        docxTable(sheet.header, sheet.rows, 18, { boxRows: true }),
      );
    }
  }
  if (layouts.classDaily) {
    for (const c of sortClasses(input.classes)) {
      const sheet = classDaySheet(input, c.id);
      if (!sheet) continue;
      needBreak();
      children.push(
        new Paragraph({ children: [new TextRun({ text: sheet.title, bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
        docxTable(sheet.header, sheet.rows, 18, { boxCols: true }),
      );
    }
  }
  if (layouts.classOverview) {
    const grid = classOverviewGrid(input);
    // 交流クラスが0件のときは「時限」1列の空表になるため出力しない
    if (grid.header.length > 1) {
      needBreak();
      children.push(
        new Paragraph({ children: [new TextRun({ text: "クラス×曜日 一覧", bold: true, size: 22, font: FONT })], spacing: { before: 200, after: 80 } }),
        // 列数が多くなりやすい表なので、1ページに収まりやすいよう小さめのフォントで組む（用紙サイズによっては複数ページに分かれる場合があります）
        docxTable(grid.header, grid.rows, 13, { colSeps: grid.dayStarts, colSepsR: grid.dayEnds }),
      );
    }
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

function pdfTable(c: PdfCtx, header: string[], rows: string[][], opts?: TableSepOpts) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const weights = columnWeights(colCount);
  const widths = weights.map((w) => c.usable * w);
  const strongHeader = opts?.strongHeader !== false;
  // 列の左端x座標（区切り線用）
  const colX = (ci: number): number => {
    let x = c.left;
    for (let i = 0; i < ci && i < widths.length; i++) x += widths[i] ?? c.usable / colCount;
    return x;
  };
  const sepLine = (x1: number, y1: number, x2: number, y2: number) => {
    c.doc.save();
    c.doc.lineWidth(2).strokeColor("#555555").moveTo(x1, y1).lineTo(x2, y2).stroke();
    c.doc.restore();
  };
  const outer = opts?.outer !== false;
  const dataCols = Array.from({ length: Math.max(colCount - 1, 0) }, (_, i) => i + 1);
  const leftSet = new Set([...(opts?.colSeps ?? []), ...(opts?.boxCols ? dataCols : [])]);
  const rightSet = new Set([...(opts?.colSepsR ?? []), ...(opts?.boxCols ? dataCols : [])]);
  const boxRowIdx = opts?.boxRows ? rows.map((_, i) => i) : [];
  const topSet = new Set([...(opts?.rowSeps ?? []), ...boxRowIdx]);
  const bottomSet = new Set([...(opts?.rowSepsB ?? []), ...boxRowIdx]);
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
  const drawRow = (cells: string[], isHeader: boolean, sy: number, zebra: boolean, bodyIndex: number) => {
    const h = rowH(cells);
    const topSep = !isHeader && topSet.has(bodyIndex);
    const botSep = !isHeader && (bottomSet.has(bodyIndex) || (outer && bodyIndex === rows.length - 1));
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
    // 区切り強調（行単位で描くので改ページをまたいでも崩れない）
    const vSeps = new Set<number>();
    for (const ci of leftSet) if (ci > 0 && ci < colCount) vSeps.add(ci);
    for (const ci of rightSet) if (ci >= 0 && ci < colCount - 1) vSeps.add(ci + 1);
    if (outer) {
      vSeps.add(0);
      vSeps.add(colCount);
    }
    for (const ci of vSeps) sepLine(colX(ci), sy, colX(ci), sy + h);
    if (topSep) sepLine(c.left, sy, c.left + c.usable, sy);
    if (botSep) sepLine(c.left, sy + h, c.left + c.usable, sy + h);
    if (isHeader && strongHeader) sepLine(c.left, sy + h, c.left + c.usable, sy + h);
    if (isHeader && outer) sepLine(c.left, sy, c.left + c.usable, sy);
  };
  const draw = (cells: string[], isHeader: boolean, zebra: boolean, bodyIndex: number) => {
    const h = rowH(cells);
    if (c.y + h > 595.28 - c.top) {
      c.doc.addPage();
      c.y = c.top;
      // 長い表の続きには表頭を繰り返す
      if (!isHeader && header.length > 0) {
        const hh = rowH(header);
        drawRow(header, true, c.y, false, -1);
        c.y += hh;
      }
    }
    drawRow(cells, isHeader, c.y, zebra, bodyIndex);
    c.y += h;
  };
  if (header.length > 0) draw(header, true, false, -1);
  rows.forEach((r, ri) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    draw(padded, false, ri % 2 === 1, ri);
  });
  c.y += 8;
}

// A4横1枚に必ず収める専用の表描画。列が多くページをまたぎそうな場合は
// フォントを段階的に縮小して、1ページの高さに収まるサイズを探す。
function pdfSinglePageTable(c: PdfCtx, header: string[], rows: string[][], opts?: TableSepOpts) {
  const colCount = Math.max(header.length, 1, ...rows.map((r) => r.length));
  const weights = columnWeights(colCount);
  const widths = weights.map((w) => c.usable * w);
  const strongHeader = opts?.strongHeader !== false;
  const outer = opts?.outer !== false;
  const dataCols = Array.from({ length: Math.max(colCount - 1, 0) }, (_, i) => i + 1);
  const leftSet = new Set([...(opts?.colSeps ?? []), ...(opts?.boxCols ? dataCols : [])]);
  const rightSet = new Set([...(opts?.colSepsR ?? []), ...(opts?.boxCols ? dataCols : [])]);
  const boxRowIdx = opts?.boxRows ? rows.map((_, i) => i) : [];
  const topSet = new Set([...(opts?.rowSeps ?? []), ...boxRowIdx]);
  const bottomSet = new Set([...(opts?.rowSepsB ?? []), ...boxRowIdx]);
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
  let fitsSinglePage = false;
  for (const [fontSize, lineH] of candidates) {
    const m = measure(fontSize, lineH);
    if (m.total <= maxHeight) {
      chosen = m;
      chosenSize = fontSize;
      fitsSinglePage = true;
      break;
    }
  }
  // 最小フォントでも1ページに収まらない場合は複数ページの通常表に切り替える（欠落させない）
  if (!fitsSinglePage) {
    pdfTable(c, header, rows, opts);
    return;
  }
  c.doc.fontSize(chosenSize);

  const drawRow = (cells: string[], isHeader: boolean, sy: number, h: number, zebra: boolean, bodyIndex: number) => {
    const topSep = !isHeader && topSet.has(bodyIndex);
    const botSep = !isHeader && (bottomSet.has(bodyIndex) || (outer && bodyIndex === rows.length - 1));
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
    const sepLine = (x1: number, y1: number, x2: number, y2: number) => {
      c.doc.save();
      c.doc.lineWidth(2).strokeColor("#555555").moveTo(x1, y1).lineTo(x2, y2).stroke();
      c.doc.restore();
    };
    let vx = c.left;
    const vSeps = new Set<number>();
    for (let i = 0; i < colCount; i++) {
      if (leftSet.has(i) && i > 0) vSeps.add(i);
      if (rightSet.has(i) && i < colCount - 1) vSeps.add(i + 1);
      vx += widths[i] ?? c.usable / colCount;
    }
    if (outer) {
      vSeps.add(0);
      vSeps.add(colCount);
    }
    vx = c.left;
    for (let i = 0; i <= colCount; i++) {
      if (vSeps.has(i)) sepLine(vx, sy, vx, sy + h);
      vx += widths[i] ?? c.usable / colCount;
    }
    if (topSep) sepLine(c.left, sy, c.left + c.usable, sy);
    if (botSep) sepLine(c.left, sy + h, c.left + c.usable, sy + h);
    if (isHeader && strongHeader) sepLine(c.left, sy + h, c.left + c.usable, sy + h);
    if (isHeader && outer) sepLine(c.left, sy, c.left + c.usable, sy);
  };

  if (header.length > 0) {
    drawRow(header, true, c.y, chosen.headerH, false, -1);
    c.y += chosen.headerH;
  }
  rows.forEach((r, ri) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    const h = chosen.rowH(padded);
    drawRow(padded, false, c.y, h, ri % 2 === 1, ri);
    c.y += h;
  });
  c.y += 8;
}

export async function buildWeekPdf(input: WeekExportInput, layouts: WeekExportLayouts = { sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false }): Promise<Buffer> {
  const c = makePdf();
  const title = exportTitle(input.week.weekStart, input.settings?.schoolName);
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
      pdfTable(c, sheet.header, sheet.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))), { boxRows: true });
      if (sheet.notes) pdfText(c, `〔配慮メモ〕${sheet.notes}`, 9, 3);
    }
  }
  if (layouts.overview) {
    needBreak();
    pdfText(c, "全体一覧", 11, 2);
    const ov = overviewRows(input);
    pdfTable(c, ov.header, ov.rows, { rowSeps: dayGroupSeps(ov.rows), rowSepsB: dayGroupEnds(ov.rows) });
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
      pdfTable(c, sheet.header, sheet.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))), { boxRows: true });
    }
  }
  if (layouts.classDaily) {
    for (const cls of sortClasses(input.classes)) {
      const sheet = classDaySheet(input, cls.id);
      if (!sheet) continue;
      needBreak();
      pdfText(c, sheet.title, 11, 2);
      pdfTable(c, sheet.header, sheet.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))), { boxCols: true });
    }
  }
  if (layouts.classOverview) {
    const grid = classOverviewGrid(input);
    // 交流クラスが0件のときは「時限」1列の空表になるため出力しない
    if (grid.header.length > 1) {
      needBreak();
      pdfText(c, "クラス×曜日 一覧", 11, 2);
      pdfSinglePageTable(c, grid.header, grid.rows.map((r) => r.map((t) => t.replace(/\n/g, "／"))), { colSeps: grid.dayStarts, colSepsR: grid.dayEnds });
    }
  }
  return collectPdf(c.doc);
}
