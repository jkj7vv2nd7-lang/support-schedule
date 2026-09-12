import { describe, expect, it } from "vitest";
import { applyRoster, autoAssignAides, buildWeekCells } from "@/lib/schedule";
import { slotKey, type ExchangeClass, type Student } from "@/lib/types";

// 全マスが識別可能な時間割
function bigClass(): ExchangeClass {
  return {
    id: "c1",
    name: "3年2組",
    grade: "3年",
    timetable: Array.from({ length: 5 }, (_, d) =>
      Array.from({ length: 6 }, (_, p) => ({ subject: `教科${d}-${p + 1}`, content: `内容${d}-${p + 1}` })),
    ),
    updatedAt: 1,
  };
}

describe("入出力の正対", () => {
  it("全30マスが正しい曜日・時限の値を引用する", () => {
    const st: Student = {
      id: "s1",
      name: "山田",
      exchangeClassId: "c1",
      exchangeSlots: Array.from({ length: 5 }, (_, d) => ({ day: d, period: 1 })).concat([{ day: 2, period: 3 }]),
    };
    const cells = buildWeekCells([st], [bigClass()]);
    for (let d = 0; d < 5; d++) {
      for (let p = 1; p <= 6; p++) {
        const c = cells.s1[slotKey(d, p)];
        const isEx = (d !== 2 && p === 1) || (d === 2 && (p === 1 || p === 3));
        if (isEx) {
          expect(c.place).toBe("exchange");
          expect(c.subject).toBe(`教科${d}-${p}`);
          expect(c.content).toBe(`内容${d}-${p}`);
          expect(c.classId).toBe("c1");
        } else {
          expect(c.place).toBe("support");
          expect(c.subject).toBe("");
        }
      }
    }
  });

  it("勤務不可コマを避けて全セル埋まる", () => {
    const st: Student = { id: "s1", name: "山田", exchangeClassId: null, exchangeSlots: [] };
    const aides = [
      { id: "a1", name: "A", offSlots: [{ day: 0, period: 1 }] },
      { id: "a2", name: "B", offSlots: [] },
    ];
    const out = autoAssignAides(buildWeekCells([st], []), aides);
    expect(out.s1[slotKey(0, 1)].aideId).toBe("a2");
    for (let d = 0; d < 5; d++) {
      for (let p = 1; p <= 6; p++) {
        expect(out.s1[slotKey(d, p)].aideId).not.toBeNull();
      }
    }
  });

  it("担当表の児童・クラスが正しいセルに反映される", () => {
    const st: Student = { id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [{ day: 1, period: 2 }] };
    const cells = buildWeekCells([st], [bigClass()]);
    // クラス指定のみ：交流セルだけ埋まる
    const byClass = applyRoster(cells, [st], [{ aideId: "a9", studentIds: [], classIds: ["c1"] }]);
    expect(byClass.s1[slotKey(1, 2)].aideId).toBe("a9");
    expect(byClass.s1[slotKey(0, 1)].aideId).toBeNull();
    // 児童指定：全部埋まる
    const byStudent = applyRoster(cells, [st], [{ aideId: "a8", studentIds: ["s1"], classIds: [] }]);
    expect(byStudent.s1[slotKey(0, 1)].aideId).toBe("a8");
    expect(byStudent.s1[slotKey(3, 5)].aideId).toBe("a8");
  });

  it("欠席日は割付も担当反映もされない", () => {
    const st: Student = { id: "s1", name: "山田", exchangeClassId: null, exchangeSlots: [] };
    const aides = [{ id: "a1", name: "A", offSlots: [] as { day: number; period: number }[] }];
    const cells = buildWeekCells([st], []);
    const rostered = applyRoster(cells, [st], [{ aideId: "a1", studentIds: ["s1"], classIds: [] }], { s1: [2] });
    for (let p = 1; p <= 6; p++) {
      expect(rostered.s1[slotKey(2, p)].aideId).toBeNull();
      expect(rostered.s1[slotKey(1, p)].aideId).toBe("a1");
    }
    const auto = autoAssignAides(rostered, aides, { s1: [2] });
    for (let p = 1; p <= 6; p++) {
      expect(auto.s1[slotKey(2, p)].aideId).toBeNull();
    }
  });
});
