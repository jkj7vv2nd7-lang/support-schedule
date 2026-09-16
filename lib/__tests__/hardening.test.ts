import { describe, expect, it } from "vitest";
import { POST as exportPost } from "@/app/api/export/route";
import { isBodyTooLarge } from "@/lib/api-guard";
import { applyRoster, autoAssignAides, buildWeekCells, dropGhostAides } from "@/lib/schedule";
import {
  isValidWeek,
  isValidWeekStart,
  normalizeAide,
  normalizeStudent,
  normalizeTimetable,
  normalizeWeek,
} from "@/lib/storage";
import { emptyTimetable, isValidCell, isValidSlot, type CellPlan } from "@/lib/types";

describe("slot/cell validation", () => {
  it("isValidSlotは範囲内のみ通す", () => {
    expect(isValidSlot({ day: 0, period: 1 })).toBe(true);
    expect(isValidSlot({ day: 4, period: 6 })).toBe(true);
    expect(isValidSlot(null)).toBe(false);
    expect(isValidSlot({ day: 5, period: 1 })).toBe(false);
    expect(isValidSlot({ day: 0, period: 7 })).toBe(false);
    expect(isValidSlot({ day: "0", period: 1 })).toBe(false);
  });

  it("isValidCellは壊れたセルを弾く", () => {
    expect(isValidCell({ place: "support", subject: "", content: "", teacher: "", aideId: null })).toBe(true);
    expect(isValidCell(null)).toBe(false);
    expect(isValidCell({ place: "other", subject: "", content: "", teacher: "", aideId: null })).toBe(false);
    expect(isValidCell({ place: "support", subject: 1, content: "", teacher: "", aideId: null })).toBe(false);
  });

  it("normalizeStudent/normalizeAideは不正コマを落とし重複を除く", () => {
    const st = normalizeStudent({
      id: "s",
      name: "山田",
      exchangeClassId: "c",
      exchangeSlots: [{ day: 0, period: 1 }, { day: 0, period: 1 }, { day: 9, period: 9 }, null] as unknown as { day: number; period: number }[],
    });
    expect(st.exchangeSlots).toEqual([{ day: 0, period: 1 }]);
    const aide = normalizeAide({ id: "a", name: "佐藤", offSlots: [null, { day: 1, period: 2 }] as unknown as { day: number; period: number }[] });
    expect(aide.offSlots).toEqual([{ day: 1, period: 2 }]);
  });
});

describe("week normalization", () => {
  it("isValidWeekStartは実在日のみ通す", () => {
    expect(isValidWeekStart("2026-09-14")).toBe(true);
    expect(isValidWeekStart("xxx")).toBe(false);
    expect(isValidWeekStart("2026-02-30")).toBe(false);
    expect(isValidWeekStart("2026-13-01")).toBe(false);
  });

  it("isValidWeekは不正な週開始日を弾く", () => {
    expect(isValidWeek({ id: "w", weekStart: "xxx", cells: {} })).toBe(false);
    expect(isValidWeek({ id: "w", weekStart: "2026-09-14", cells: {} })).toBe(true);
  });

  it("normalizeWeekは壊れたセル・欠席を落とし、担当表の形状を整える", () => {
    const w = normalizeWeek(
      {
        id: "w",
        weekStart: "2026-09-14",
        cells: {
          s1: {
            "0-1": { place: "support", subject: "国語", content: "", teacher: "", aideId: null },
            "0-2": null,
            "9-9": { place: "support", subject: "", content: "", teacher: "", aideId: null },
          },
        },
        absent: { s1: [0, 9, "x"], s2: "oops" },
        posts: [{ aideId: "a1", studentIds: ["s1"], classIds: [] }, null, { aideId: "", studentIds: [], classIds: [] }],
        createdAt: 1,
        updatedAt: 1,
      } as unknown as Parameters<typeof normalizeWeek>[0],
      [],
      [],
      [],
    );
    expect(Object.keys(w.cells.s1)).toEqual(["0-1"]);
    expect(w.absent).toEqual({ s1: [0] });
    expect(w.posts).toEqual([{ aideId: "a1", studentIds: ["s1"], classIds: [] }]);
  });
});

describe("broken data does not crash scheduling", () => {
  const students = [{ id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [null, { day: 0, period: 1 }] as unknown as { day: number; period: number }[] }];
  const classes = [{ id: "c1", name: "3年2組", grade: "3年", timetable: emptyTimetable(), updatedAt: 1 }];
  const aides = [{ id: "a1", name: "佐藤", offSlots: [null] as unknown as { day: number; period: number }[] }];

  it("buildWeekCellsは不正な交流スロット・温存セルを無視する", () => {
    const cells = buildWeekCells(students, classes, { s1: { "0-1": null } } as unknown as Record<string, Record<string, never>>);
    expect(cells.s1["0-1"].place).toBe("exchange");
    expect(cells.s1["0-2"].place).toBe("support");
  });

  it("applyRoster/autoAssignAidesは不正な勤務不可を無視する", () => {
    const cells = buildWeekCells(students, classes);
    expect(() => applyRoster(cells, students, [], undefined, aides)).not.toThrow();
    expect(() => autoAssignAides(cells, aides)).not.toThrow();
  });
});

describe("buildWeekCells refreshExchange", () => {
  const tt = emptyTimetable();
  tt[0][0] = { subject: "算数", content: "ドリル" };
  tt[0][1] = { subject: "理科", content: "" };
  tt[0][2] = { subject: "音楽", content: "" };
  const students = [
    {
      id: "s1",
      name: "山田",
      exchangeClassId: "c1",
      exchangeSlots: [
        { day: 0, period: 1 },
        { day: 0, period: 2 },
        { day: 0, period: 3 },
      ],
    },
  ];
  const classes = [{ id: "c1", name: "3年2組", grade: "3年", timetable: tt, updatedAt: 1 }];
  const prev: Record<string, Record<string, CellPlan>> = {
    s1: {
      "0-1": { place: "exchange", subject: "国語", content: "旧内容", teacher: "田中", aideId: "a1", classId: "c1" },
      "0-2": { place: "support", subject: "自習", content: "手入力", teacher: "", aideId: null },
      "0-3": { place: "support", subject: "", content: "", teacher: "", aideId: null },
    },
  };

  it("通常は既存セルを温存する", () => {
    const cells = buildWeekCells(students, classes, prev);
    expect(cells.s1["0-1"].subject).toBe("国語");
  });

  it("再反映は交流セルの教科・内容だけ更新し担当は保持する", () => {
    const cells = buildWeekCells(students, classes, prev, { refreshExchange: true });
    const c = cells.s1["0-1"];
    expect(c.subject).toBe("算数");
    expect(c.content).toBe("ドリル");
    expect(c.teacher).toBe("田中");
    expect(c.aideId).toBe("a1");
    expect(c.place).toBe("exchange");
  });

  it("手入力のある支援セルは温存し、空セルは交流に起こす", () => {
    const cells = buildWeekCells(students, classes, prev, { refreshExchange: true });
    expect(cells.s1["0-2"]).toMatchObject({ place: "support", subject: "自習" });
    expect(cells.s1["0-3"]).toMatchObject({ place: "exchange", subject: "音楽" });
  });
});

describe("dropGhostAides", () => {
  it("存在しない介助員参照だけ外す", () => {
    const cells = {
      s1: {
        "0-1": { place: "support", subject: "", content: "", teacher: "", aideId: "ghost" },
        "0-2": { place: "support", subject: "", content: "", teacher: "", aideId: "a1" },
      },
    } as unknown as Parameters<typeof dropGhostAides>[0];
    const out = dropGhostAides(cells, [{ id: "a1", name: "佐藤", offSlots: [] }]);
    expect(out.s1["0-1"].aideId).toBeNull();
    expect(out.s1["0-2"].aideId).toBe("a1");
  });
});

describe("normalizeTimetable", () => {
  it("部分的な入力を5x6に補完する", () => {
    const t = normalizeTimetable([[{ subject: "国語", content: "" }]]);
    expect(t.length).toBe(5);
    expect(t[0].length).toBe(6);
    expect(t[0][0]).toEqual({ subject: "国語", content: "" });
    expect(t[4][5]).toEqual({ subject: "", content: "" });
    expect(normalizeTimetable(null)[2][3]).toEqual({ subject: "", content: "" });
  });
});

describe("isBodyTooLarge", () => {
  it("ラップされたエラーでも413判定できる", async () => {
    const { BodyTooLargeError } = await import("@/lib/api-guard");
    expect(isBodyTooLarge(new BodyTooLargeError(10))).toBe(true);
    expect(isBodyTooLarge({ name: "BodyTooLargeError", cause: { name: "BodyTooLargeError" } })).toBe(true);
    expect(isBodyTooLarge(new Error("nope"))).toBe(false);
  });
});

function baseData(weekStart: string) {
  const tt = emptyTimetable();
  return {
    week: { id: "w", weekStart, cells: {}, createdAt: 1, updatedAt: 1 },
    students: [{ id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [{ day: 0, period: 1 }] }],
    aides: [],
    classes: [{ id: "c1", name: "3年2組", grade: "3年", timetable: tt, updatedAt: 1 }],
  };
}

describe("export route guards", () => {
  it("不正な週開始日は400で拒否する", async () => {
    const req = new Request("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "xlsx", data: baseData("not-a-date"), layouts: { sheets: true } }),
    });
    const res = await exportPost(req);
    expect(res.status).toBe(400);
  });

  it("交流11クラス超の1枚表は400で案内する", async () => {
    const tt = emptyTimetable();
    const students = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      name: `児童${i}`,
      exchangeClassId: `c${i}`,
      exchangeSlots: [{ day: 0, period: 1 }],
    }));
    const classes = Array.from({ length: 11 }, (_, i) => ({
      id: `c${i}`,
      name: `${i + 1}年1組`,
      grade: `${i + 1}年`,
      timetable: tt,
      updatedAt: 1,
    }));
    const req = new Request("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "xlsx",
        data: { week: { id: "w", weekStart: "2026-09-14", cells: {}, createdAt: 1, updatedAt: 1 }, students, aides: [], classes },
        layouts: { sheets: false, overview: false, exchange: false, aides: false, classDaily: false, classOverview: true },
      }),
    });
    const res = await exportPost(req);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error ?? "").toContain("クラス別");
  });
});
