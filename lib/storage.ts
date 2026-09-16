import { sanitizePosts } from "@/lib/schedule";
import { emptyTimetable } from "@/lib/types";
import type { Aide, ExchangeClass, Student, WeekPlan } from "@/lib/types";

export const K_CLASSES = "support-schedule:classes:v1";
export const K_STUDENTS = "support-schedule:students:v1";
export const K_AIDES = "support-schedule:aides:v1";
export const K_WEEKS = "support-schedule:weeks:v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function makeId(): string {
  if (isBrowser() && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function load<T>(key: string, validate: (x: unknown) => x is T): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(validate);
  } catch {
    return [];
  }
}

function save(key: string, items: unknown[]): boolean {
  if (!isBrowser()) return true;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function isStr(x: unknown): x is string {
  return typeof x === "string";
}

function isCellArray(x: unknown): boolean {
  return (
    Array.isArray(x) &&
    x.length === 5 &&
    x.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 6 &&
        row.every(
          (c) => !!c && typeof c === "object" && isStr((c as Record<string, unknown>).subject),
        ),
    )
  );
}

export function isValidClass(x: unknown): x is ExchangeClass {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    isStr(o.id) && o.id.length > 0 &&
    isStr(o.name) &&
    isStr(o.grade) &&
    isCellArray(o.timetable)
  );
}

export function normalizeClass(x: ExchangeClass): ExchangeClass {
  const base = isCellArray(x.timetable) ? x : { ...x, timetable: emptyTimetable() };
  const morning = Array.isArray(base.morning) ? base.morning.map((m) => (typeof m === "string" ? m : "")) : [];
  while (morning.length < 5) morning.push("");
  const dismissal = Array.isArray(base.dismissal) ? base.dismissal.map((m) => (typeof m === "string" ? m : "")) : [];
  while (dismissal.length < 5) dismissal.push("");
  const notice = typeof base.notice === "string" && base.notice ? base.notice : undefined;
  return { ...base, morning: morning.slice(0, 5), dismissal: dismissal.slice(0, 5), notice };
}

export function isValidStudent(x: unknown): x is Student {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    isStr(o.id) && o.id.length > 0 &&
    isStr(o.name) &&
    (o.exchangeClassId == null || isStr(o.exchangeClassId)) &&
    Array.isArray(o.exchangeSlots)
  );
}

export function isValidAide(x: unknown): x is Aide {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return isStr(o.id) && o.id.length > 0 && isStr(o.name) && Array.isArray(o.offSlots);
}

export function isValidWeek(x: unknown): x is WeekPlan {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return isStr(o.id) && o.id.length > 0 && isStr(o.weekStart) && !!o.cells && typeof o.cells === "object";
}

// 下校時刻の形式チェック。空欄は可、入力があれば HH:MM 形式のみ許可。エラーメッセージの配列を返す
export function validateDismissal(values: unknown): string[] {
  const days = ["月曜", "火曜", "水曜", "木曜", "金曜"];
  const list = Array.isArray(values) ? values : [];
  const errors: string[] = [];
  list.slice(0, 5).forEach((v, i) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      errors.push(`${days[i] ?? `${i + 1}日目`}の下校時刻は「14:20」のような時刻で入力してください`);
    }
  });
  return errors;
}

export const loadClasses = () => load(K_CLASSES, isValidClass).map(normalizeClass);
export const loadStudents = () => load(K_STUDENTS, isValidStudent);
export const loadAides = () => load(K_AIDES, isValidAide);
export const loadWeeks = () => load(K_WEEKS, isValidWeek);
export const saveClasses = (v: ExchangeClass[]) => save(K_CLASSES, v);
export const saveStudents = (v: Student[]) => save(K_STUDENTS, v);
export const saveAides = (v: Aide[]) => save(K_AIDES, v);
export const saveWeeks = (v: WeekPlan[]) => save(K_WEEKS, v);

// バックアップ（複数教員での受け渡し用）: 全データを1つのJSONにまとめる
export type BackupData = {
  app: "support-schedule";
  version: 1;
  exportedAt: string;
  classes: ExchangeClass[];
  students: Student[];
  aides: Aide[];
  weeks: WeekPlan[];
};

export function exportBackup(): BackupData {
  return {
    app: "support-schedule",
    version: 1,
    exportedAt: new Date().toISOString(),
    classes: loadClasses(),
    students: loadStudents(),
    aides: loadAides(),
    weeks: loadWeeks(),
  };
}

export function importBackup(data: unknown): { ok: boolean; counts?: { classes: number; students: number; aides: number; weeks: number }; error?: string } {
  if (!data || typeof data !== "object") return { ok: false, error: "ファイルの形式が不正です" };
  const o = data as Record<string, unknown>;
  if (o.app !== "support-schedule") return { ok: false, error: "このアプリのバックアップではありません" };
  if (!Array.isArray(o.classes) || !Array.isArray(o.students) || !Array.isArray(o.aides) || !Array.isArray(o.weeks)) {
    return { ok: false, error: "ファイルの形式が不正です" };
  }
  const classes = (o.classes as unknown[]).filter(isValidClass).map(normalizeClass);
  const students = (o.students as unknown[]).filter(isValidStudent);
  const aides = (o.aides as unknown[]).filter(isValidAide);
  const weeks = (o.weeks as unknown[]).filter(isValidWeek).map((w) => ({ ...w, posts: sanitizePosts(w.posts, students, aides, classes) }));
  if (classes.length + students.length + aides.length + weeks.length === 0) {
    return { ok: false, error: "有効なデータがありませんでした" };
  }
  saveClasses(classes);
  saveStudents(students);
  saveAides(aides);
  saveWeeks(weeks);
  return { ok: true, counts: { classes: classes.length, students: students.length, aides: aides.length, weeks: weeks.length } };
}
