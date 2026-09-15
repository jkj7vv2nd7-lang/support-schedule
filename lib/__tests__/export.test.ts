import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWeekDocx, buildWeekPdf, buildWeekXlsx, sanitizeFileName, type WeekExportInput } from "@/lib/export";
import { emptyTimetable } from "@/lib/types";

function input(): WeekExportInput {
  const tt = emptyTimetable();
  tt[0][0] = { subject: "国語", content: "漢字" };
  return {
    week: {
      id: "w",
      weekStart: "2026-09-07",
      cells: {
        s1: {
          "0-0": { place: "exchange", subject: "国語", content: "漢字", teacher: "", aideId: "a1", classId: "c1" },
          "0-1": { place: "support", subject: "算数", content: "", teacher: "担任", aideId: null },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    },
    students: [{ id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [{ day: 0, period: 1 }] }],
    aides: [{ id: "a1", name: "鈴木さん", offSlots: [] }],
    classes: [{ id: "c1", name: "3年2組", grade: "3年", timetable: tt, updatedAt: 1 }],
  };
}

describe("week export", () => {
  it("pdf", async () => {
    const buf = await buildWeekPdf(input());
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("xlsx", async () => {
    const buf = await buildWeekXlsx(input());
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("docx", async () => {
    const buf = await buildWeekDocx(input());
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("空っぽでも落ちない", async () => {
    const empty = input();
    empty.students = [];
    empty.classes = [];
    empty.week.cells = {};
    expect((await buildWeekPdf(empty)).length).toBeGreaterThan(0);
    expect((await buildWeekXlsx(empty)).length).toBeGreaterThan(0);
    expect((await buildWeekDocx(empty)).length).toBeGreaterThan(0);
  });

  it("layouts指定で表を絞れる", async () => {
    const only = { sheets: false, overview: false, exchange: true, aides: false, classDaily: false, classOverview: false };
    expect((await buildWeekDocx(input(), only)).length).toBeGreaterThan(0);
    expect((await buildWeekXlsx(input(), only)).length).toBeGreaterThan(0);
    const buf = await buildWeekPdf(input(), only);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("介助員別が出力される", async () => {
    const only = { sheets: false, overview: false, exchange: false, aides: true, classDaily: false, classOverview: false };
    expect((await buildWeekDocx(input(), only)).length).toBeGreaterThan(0);
    expect((await buildWeekXlsx(input(), only)).length).toBeGreaterThan(0);
  });

  it("欠席と配慮メモが反映される", async () => {
    const data = input();
    data.week.absent = { s1: [0] };
    data.students = [{ ...data.students[0], notes: "アレルギーあり" }];
    const buf = await buildWeekPdf(data, { sheets: true, overview: true, exchange: false, aides: false, classDaily: false, classOverview: false });
    expect(buf.length).toBeGreaterThan(0);
    expect((await buildWeekDocx(data)).length).toBeGreaterThan(0);
    expect((await buildWeekXlsx(data)).length).toBeGreaterThan(0);
  });

  it("クラス×曜日一覧だけならPDFは1ページに収まる", async () => {
    const data = input();
    // 参考様式に近い3クラス構成にする
    const tt2 = emptyTimetable();
    tt2[0][0] = { subject: "算数", content: "" };
    data.classes = [
      data.classes[0],
      { id: "c2", name: "4年1組", grade: "4年", timetable: tt2, morning: ["朝清掃", "", "", "", ""], notice: "連絡あり", dismissal: ["14:20", "15:10", "14:20", "15:10", "14:20"], updatedAt: 1 },
      { id: "c3", name: "4年2組", grade: "4年", timetable: emptyTimetable(), updatedAt: 1 },
    ];
    data.students = [
      data.students[0],
      { id: "s2", name: "佐藤", exchangeClassId: "c2", exchangeSlots: [{ day: 0, period: 1 }] },
      { id: "s3", name: "鈴木", exchangeClassId: "c3", exchangeSlots: [{ day: 0, period: 1 }] },
    ];
    const only = { sheets: false, overview: false, exchange: false, aides: false, classDaily: false, classOverview: true };
    const buf = await buildWeekPdf(data, only);
    expect(buf.length).toBeGreaterThan(0);
    const pages = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBe(1);
  });

  it("Excelの曜日境目と見出し下に太罫が入る", async () => {
    const only = { sheets: false, overview: true, exchange: false, aides: false, classDaily: false, classOverview: true };
    const buf = await buildWeekXlsx(input(), only);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("クラス×曜日 一覧");
    expect(ws).toBeDefined();
    let headerRow: ExcelJS.Row | undefined;
    ws!.eachRow((row) => {
      if (row.getCell(1).value === "時限") headerRow = row;
    });
    expect(headerRow).toBeDefined();
    // 見出し下は太罫
    expect(headerRow!.getCell(2).border.bottom?.style).toBe("medium");
    // 火曜開始列（3列目）の左罫は太罫（1クラス構成でも曜日境目は区切る）
    expect(headerRow!.getCell(3).border.left?.style).toBe("medium");
    // 外枠：先頭列の左・最終列の右
    expect(headerRow!.getCell(1).border.left?.style).toBe("medium");
    const lastCol = headerRow!.cellCount;
    expect(headerRow!.getCell(lastCol).border.right?.style).toBe("medium");
  });
});

describe("sanitizeFileName", () => {
  it("禁止文字と末尾ドットを除去", () => {
    expect(sanitizeFileName("週予定/表。")).toBe("週予定表");
    expect(sanitizeFileName(123)).toBe("export");
  });
});
