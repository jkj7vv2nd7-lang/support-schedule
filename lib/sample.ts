import { applyRoster, autoAssignAides, buildWeekCells, mondayOf } from "@/lib/schedule";
import { makeId } from "@/lib/storage";
import { emptyTimetable } from "@/lib/types";
import type { Aide, ExchangeClass, Student, WeekPlan } from "@/lib/types";

// 全国の先生がすぐ試せるサンプル一式（2クラス・児童3名・介助員2名・今週1週分）。
// IDは毎回採番するため、空の状態でのみ読み込む運用とする。
export function buildSampleData(): { classes: ExchangeClass[]; students: Student[]; aides: Aide[]; weeks: WeekPlan[] } {
  const now = Date.now();
  const tt1 = emptyTimetable();
  const s1: [number, number, string, string][] = [
    [0, 1, "国語", "漢字ドリル"], [0, 2, "算数", "かけ算"], [0, 3, "理科", "植物の観察"], [0, 4, "音楽", "リコーダー"],
    [1, 1, "算数", "わり算"], [1, 2, "国語", "音読"], [1, 3, "体育", "マット運動"], [1, 4, "図工", "版画"],
    [2, 1, "社会", "地図記号"], [2, 2, "算数", "文章題"], [2, 3, "国語", "書写"], [2, 4, "総合", "調べ学習"],
    [3, 1, "理科", "実験"], [3, 2, "算数", "復習"], [3, 3, "国語", "読解"], [3, 4, "体育", "ボール運動"],
    [4, 1, "国語", "漢字テスト"], [4, 2, "算数", "まとめ"], [4, 3, "音楽", "合唱"], [4, 4, "学活", "振り返り"],
  ];
  for (const [d, p, subject, content] of s1) tt1[d][p - 1] = { subject, content };
  const tt2 = emptyTimetable();
  const s2: [number, number, string, string][] = [
    [0, 1, "算数", "たし算"], [0, 2, "国語", "ひらがな"], [1, 1, "国語", "音読"], [1, 3, "体育", "かけっこ"],
    [2, 2, "算数", "ひき算"], [3, 1, "理科", "生き物"], [3, 3, "国語", "書写"], [4, 2, "算数", "復習"],
  ];
  for (const [d, p, subject, content] of s2) tt2[d][p - 1] = { subject, content };

  const c1: ExchangeClass = {
    id: makeId(), name: "3年2組", grade: "3年", timetable: tt1,
    morning: ["朝読書", "朝読書", "運動タイム", "朝読書", "集会"],
    dismissal: ["14:20", "15:20", "14:20", "15:20", "14:20"],
    notice: "水曜は掃除なし", updatedAt: now,
  };
  const c2: ExchangeClass = {
    id: makeId(), name: "4年1組", grade: "4年", timetable: tt2,
    morning: ["", "", "", "", ""], dismissal: ["14:30", "15:30", "14:30", "15:30", "14:30"],
    updatedAt: now,
  };

  const st1: Student = {
    id: makeId(), name: "山田 太郎", exchangeClassId: c1.id,
    exchangeSlots: [{ day: 0, period: 1 }, { day: 0, period: 2 }, { day: 1, period: 3 }, { day: 3, period: 3 }],
  };
  const st2: Student = {
    id: makeId(), name: "佐藤 花子", exchangeClassId: c2.id,
    exchangeSlots: [{ day: 0, period: 1 }, { day: 1, period: 1 }, { day: 3, period: 1 }],
  };
  const st3: Student = {
    id: makeId(), name: "鈴木 次郎", exchangeClassId: null, exchangeSlots: [],
    notes: "ナッツアレルギーあり。初めての場所では緊張するため、短く具体的な声かけを。",
  };

  const a1: Aide = { id: makeId(), name: "田中 先生", offSlots: [{ day: 1, period: 3 }] };
  const a2: Aide = { id: makeId(), name: "山本 先生", offSlots: [{ day: 4, period: 6 }] };

  const classes = [c1, c2];
  const students = [st1, st2, st3];
  const aides = [a1, a2];
  const posts: WeekPlan["posts"] = [
    { aideId: a1.id, studentIds: [st1.id], classIds: [c1.id] },
    { aideId: a2.id, studentIds: [st2.id], classIds: [] },
  ];
  const cells = autoAssignAides(
    applyRoster(buildWeekCells(students, classes), students, posts, undefined, aides),
    aides,
  );
  const weeks: WeekPlan[] = [
    {
      id: makeId(), weekStart: mondayOf(new Date()), cells, posts,
      dayNotes: ["", "", "避難訓練", "", ""],
      createdAt: now, updatedAt: now,
    },
  ];
  return { classes, students, aides, weeks };
}
