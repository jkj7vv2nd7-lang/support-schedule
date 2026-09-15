import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/export/route";
import { extractTimetableJson } from "@/app/api/timetable/route";
import { emptyTimetable } from "@/lib/types";

function payload(layouts: unknown) {
  const tt = emptyTimetable();
  tt[0][0] = { subject: "国語", content: "" };
  return {
    format: "xlsx",
    data: {
      week: {
        id: "w",
        weekStart: "2026-09-14",
        cells: { s1: { "0-0": { place: "exchange", subject: "国語", content: "", teacher: "", aideId: null, classId: "c1" } } },
        createdAt: 1,
        updatedAt: 1,
      },
      students: [{ id: "s1", name: "山田", exchangeClassId: "c1", exchangeSlots: [{ day: 0, period: 1 }] }],
      aides: [],
      classes: [{ id: "c1", name: "3年2組", grade: "3年", timetable: tt, updatedAt: 1 }],
    },
    layouts,
  };
}

async function post(layouts: unknown) {
  const req = new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload(layouts)),
  });
  return POST(req);
}

describe("export route layouts", () => {
  it("新2種（クラス別・1枚表）だけの選択でも出力できる", async () => {
    const res = await post({ sheets: false, overview: false, exchange: false, aides: false, classDaily: true, classOverview: true });
    expect(res.status).toBe(200);
  });

  it("全未選択は400で案内文を返す", async () => {
    const res = await post({ sheets: false, overview: false, exchange: false, aides: false, classDaily: false, classOverview: false });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error ?? "").toContain("1つ以上");
  });
});

describe("timetable json", () => {
  it("前置き・フェンス付きでも取り出せる", () => {
    expect(extractTimetableJson('{"slots":[]}')).toEqual({ slots: [] });
    expect(extractTimetableJson('```json\n{"slots":[{"day":0}]}\n```')).toEqual({ slots: [{ day: 0 }] });
    expect(extractTimetableJson('読み取りました。{"slots":[]} 以上です')).toEqual({ slots: [] });
    expect(() => extractTimetableJson("読み取れませんでした")).toThrow();
  });
});
