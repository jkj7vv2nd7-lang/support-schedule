// 特別支援学級の週予定支援アプリの型定義
// 曜日: 0=月〜4=金 / 時限: 1〜6

export const DAYS = ["月", "火", "水", "木", "金"] as const;
export const PERIODS = [1, 2, 3, 4, 5, 6] as const;

export type DayIndex = 0 | 1 | 2 | 3 | 4;

export function slotKey(day: number, period: number): string {
  return `${day}-${period}`;
}

export type SlotContent = {
  subject: string;
  content: string;
};

// 交流クラスの時間割（写真取り込み or 手入力）
export type ExchangeClass = {
  id: string;
  name: string;
  grade: string;
  // timetable[day][period]（5日×6時限）
  timetable: SlotContent[][];
  updatedAt: number;
};

export type ExchangeSlot = { day: number; period: number };

// 支援児童
export type Student = {
  id: string;
  name: string;
  // 交流に行くクラス（なしも可）
  exchangeClassId: string | null;
  // 交流に行くコマ
  exchangeSlots: ExchangeSlot[];
};

// 介助員
export type Aide = {
  id: string;
  name: string;
  // 勤務不可コマ
  offSlots: ExchangeSlot[];
};

// 週予定の1セル
export type CellPlan = {
  place: "support" | "exchange";
  subject: string;
  content: string;
  teacher: string;
  aideId: string | null;
  // 交流先クラス（交流セルのみ）
  classId?: string | null;
};

// 週ごとの介助員担当（毎週変えられる）
export type WeekAidePost = {
  aideId: string;
  studentIds: string[];
  classIds: string[];
};

// 週予定（cells[studentId][slotKey]）
export type WeekPlan = {
  id: string;
  weekStart: string; // YYYY-MM-DD（月曜）
  cells: Record<string, Record<string, CellPlan>>;
  // 今週の介助員担当（任意）
  posts?: WeekAidePost[];
  createdAt: number;
  updatedAt: number;
};

export function emptyTimetable(): SlotContent[][] {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 6 }, () => ({ subject: "", content: "" })),
  );
}

export function blankCell(place: "support" | "exchange" = "support"): CellPlan {
  return { place, subject: "", content: "", teacher: "", aideId: null };
}
