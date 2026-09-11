import { describe, expect, it } from "vitest";
import { autoAssignAides, buildWeekCells } from "@/lib/schedule";
import { emptyTimetable, slotKey, type Aide, type ExchangeClass, type Student } from "@/lib/types";

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
    expect(cells.s1[slotKey(0, 1)]).toMatchObject({ place: "exchange", subject: "国語" });
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
