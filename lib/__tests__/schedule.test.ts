import { describe, expect, it } from "vitest";
import { applyRoster, autoAssignAides, buildWeekCells, classOverviewTable, detachAideFromWeeks, detachClassFromStudents, detachStudentFromWeeks } from "@/lib/schedule";
import { exportBackup, importBackup } from "@/lib/storage";
import { emptyTimetable, slotKey, type Aide, type ExchangeClass, type Student, type WeekPlan } from "@/lib/types";

function cls(): ExchangeClass {
  const t = emptyTimetable();
  t[0][0] = { subject: "国語", content: "漢字" };
  return { id: "c1", name: "3年2組", grade: "3年", timetable: t, updatedAt: 1 };
}

function student(): Student {
  return { id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [{ day: 0, period: 1 }] };
}

function aide(id: string, off: { day: number; period: number }[] = []): Aide {
  return { id, name: id, offSlots: off };
}

describe("buildWeekCells", () => {
  it("交流コマは時間割を引用し他は支援になる", () => {
    const cells = buildWeekCells([student()], [cls()]);
    expect(cells.s1[slotKey(0, 1)]).toMatchObject({ place: "exchange", subject: "国語", classId: "c1" });
    expect(cells.s1[slotKey(0, 2)].place).toBe("support");
    expect(Object.keys(cells.s1)).toHaveLength(30);
  });

  it("手修正セルを温存する", () => {
    const prev = buildWeekCells([student()], [cls()]);
    prev.s1[slotKey(0, 2)] = { place: "support", subject: "算数", content: "", teacher: "担任", aideId: null };
    const next = buildWeekCells([student()], [cls()], prev);
    expect(next.s1[slotKey(0, 2)].subject).toBe("算数");
  });
});

describe("autoAssignAides", () => {
  it("勤務不可を避けて均等に割付ける", () => {
    const students: Student[] = [
      student(),
      { id: "s2", name: "佐藤", exchangeClassId: null, exchangeSlots: [] },
    ];
    let cells = buildWeekCells(students, [cls()]);
    cells = autoAssignAides(cells, [aide("a1", [{ day: 0, period: 1 }]), aide("a2")]);
    // 月1はa1不可 → a2
    expect(cells.s1[slotKey(0, 1)].aideId).toBe("a2");
    // 全セルに誰か付く
    for (const bySlot of Object.values(cells)) {
      for (const cell of Object.values(bySlot)) {
        expect(cell.aideId).not.toBeNull();
      }
    }
    // 負荷が均等（差1以内）
    const load = new Map<string, number>();
    for (const bySlot of Object.values(cells)) {
      for (const cell of Object.values(bySlot)) {
        load.set(cell.aideId ?? "", (load.get(cell.aideId ?? "") ?? 0) + 1);
      }
    }
    expect(Math.abs((load.get("a1") ?? 0) - (load.get("a2") ?? 0))).toBeLessThanOrEqual(2);
  });

  it("介助員ゼロでも落ちない", () => {
    const cells = autoAssignAides(buildWeekCells([student()], [cls()]), []);
    expect(cells.s1[slotKey(0, 1)].aideId).toBeNull();
  });
});

describe("applyRoster", () => {
  it("児童指定＞クラス指定で反映し手修正を温存する", () => {
    const cells = buildWeekCells([student()], [cls()]);
    const out = applyRoster(cells, [student()], [
      { aideId: "a1", studentIds: [], classIds: ["c1"] },
      { aideId: "a2", studentIds: ["s1"], classIds: [] },
    ]);
    // s1は児童指定a2が優先
    expect(out.s1[slotKey(0, 1)].aideId).toBe("a2");
    expect(out.s1[slotKey(1, 1)].aideId).toBe("a2");
  });

  it("手修正済みセルは上書きしない", () => {
    const cells = buildWeekCells([student()], [cls()]);
    cells.s1[slotKey(0, 1)] = { ...cells.s1[slotKey(0, 1)], aideId: "manual" };
    const out = applyRoster(cells, [student()], [{ aideId: "a1", studentIds: ["s1"], classIds: [] }]);
    expect(out.s1[slotKey(0, 1)].aideId).toBe("manual");
    expect(out.s1[slotKey(0, 2)].aideId).toBe("a1");
  });

  it("壊れた担当表でも落ちない", () => {
    const cells = buildWeekCells([student()], [cls()]);
    const out = applyRoster(cells, [student()], [null, { aideId: 1 }, { aideId: "a1", studentIds: "x" }] as unknown as []);
    expect(out.s1[slotKey(0, 1)].aideId).toBeNull();
  });
});

function weekWithRefs(): WeekPlan {
  return {
    id: "w",
    weekStart: "2026-09-07",
    cells: {
      s1: {
        "0-0": { place: "exchange", subject: "国語", content: "", teacher: "", aideId: "a1", classId: "c1" },
        "0-1": { place: "support", subject: "", content: "", teacher: "", aideId: "a1" },
      },
    },
    posts: [{ aideId: "a1", studentIds: ["s1"], classIds: [] }],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("detach", () => {
  it("児童削除でセルを除去", () => {
    const { weeks, changed } = detachStudentFromWeeks([weekWithRefs()], "s1");
    expect(changed).toBe(true);
    expect(weeks[0].cells.s1).toBeUndefined();
    expect(detachStudentFromWeeks([weekWithRefs()], "sx").changed).toBe(false);
  });

  it("介助員削除でセル・担当表を除去", () => {
    const { weeks, changed } = detachAideFromWeeks([weekWithRefs()], "a1");
    expect(changed).toBe(true);
    expect(weeks[0].cells.s1["0-0"].aideId).toBeNull();
    expect(weeks[0].posts).toEqual([]);
  });

  it("クラス削除で児童の交流設定をクリア", () => {
    const st: Student = { id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [{ day: 0, period: 1 }] };
    const { students, changed } = detachClassFromStudents([st], "c1");
    expect(changed).toBe(true);
    expect(students[0].exchangeClassId).toBeNull();
    expect(students[0].exchangeSlots).toEqual([]);
  });
});

describe("classOverviewTable", () => {
  function week(): WeekPlan {
    const cells = buildWeekCells([student()], [cls()]);
    cells.s1[slotKey(0, 1)].teacher = "田中";
    return {
      id: "w1",
      weekStart: "2026-09-14",
      cells,
      dayNotes: ["", "運動会予行", "", "", ""],
      createdAt: 1,
      updatedAt: 1,
    };
  }

  it("参考様式の行構成（日・曜日・予定・時限）になる", () => {
    const t = classOverviewTable({ week: week(), students: [student()], aides: [], classes: [{ ...cls(), morning: ["朝清掃", "", "", "", ""], notice: "水曜は掃除なし", dismissal: ["14:20", "", "", "", ""] }] });
    expect(t.header[0]).toBe("時限");
    expect(t.header[1]).toContain("3年2組");
    const firsts = t.rows.map((r) => r[0]);
    expect(firsts).toEqual(["日", "曜日", "予定", "朝活動", "1", "2", "3", "4", "5", "6", "連絡等", "下校時刻"]);
    // 予定・朝活動・連絡等・下校時刻が反映される
    expect(t.rows[2][1]).toBe("");
    expect(t.rows[3][1]).toBe("朝清掃");
    expect(t.rows.find((r) => r[0] === "連絡等")?.[1]).toBe("水曜は掃除なし");
    expect(t.rows.find((r) => r[0] === "下校時刻")?.[1]).toBe("14:20");
    // 担当が載る（教科＋担当）
    expect(t.rows[4][1]).toContain("国語");
    expect(t.rows[4][1]).toContain("田中");
  });

  it("空行（予定・朝活動など）は出さない", () => {
    const w = week();
    w.dayNotes = undefined;
    const t = classOverviewTable({ week: w, students: [student()], aides: [], classes: [cls()] });
    const firsts = t.rows.map((r) => r[0]);
    expect(firsts).toEqual(["日", "曜日", "1", "2", "3", "4", "5", "6"]);
  });

  it("交流のないクラスは列に出さない", () => {
    const other: ExchangeClass = { id: "c2", name: "4年1組", grade: "4年", timetable: emptyTimetable(), updatedAt: 1 };
    const t = classOverviewTable({ week: week(), students: [student()], aides: [], classes: [cls(), other] });
    expect(t.columns).toHaveLength(5);
    expect(t.header).toHaveLength(6);
  });

  it("曜日ブロックの列位置が分かる", () => {
    const c2: ExchangeClass = { id: "c2", name: "4年1組", grade: "4年", timetable: emptyTimetable(), updatedAt: 1 };
    const s2: Student = { id: "s2", name: "佐藤", exchangeClassId: "c2", exchangeSlots: [] };
    const t = classOverviewTable({ week: week(), students: [student(), s2], aides: [], classes: [cls(), c2] });
    // 2クラス×5曜日=10列。曜日ごとに開始列と終了列が分かる
    expect(t.columns).toHaveLength(10);
    const starts = t.columns.map((c, i) => (i > 0 && c.day !== t.columns[i - 1].day ? i + 1 : -1)).filter((i) => i > 0);
    const ends = t.columns.map((c, i) => (i === t.columns.length - 1 || t.columns[i + 1].day !== c.day ? i + 1 : -1)).filter((i) => i > 0);
    expect(starts).toEqual([3, 5, 7, 9]);
    expect(ends).toEqual([2, 4, 6, 8, 10]);
  });
});

describe("backup", () => {
  it("形式違い・空データは拒否し、正常データは受け入れる", () => {
    expect(importBackup({ app: "other" }).ok).toBe(false);
    expect(importBackup(null).ok).toBe(false);
    expect(importBackup({ app: "support-schedule", classes: [], students: [], aides: [], weeks: [] }).ok).toBe(false);
    const good = importBackup({ app: "support-schedule", version: 1, exportedAt: "2026-09-14", classes: [cls()], students: [student()], aides: [], weeks: [] });
    expect(good.ok).toBe(true);
    expect(good.counts).toMatchObject({ classes: 1, students: 1, aides: 0, weeks: 0 });
    const exported = exportBackup();
    expect(exported.app).toBe("support-schedule");
    expect(Array.isArray(exported.classes)).toBe(true);
  });
});
