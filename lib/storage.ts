import { sanitizePosts } from "@/lib/schedule";
import { emptyTimetable, isValidCell, isValidSlot } from "@/lib/types";
import type { Aide, ExchangeClass, SlotContent, Student, WeekPlan } from "@/lib/types";

export const K_CLASSES = "support-schedule:classes:v1";
export const K_STUDENTS = "support-schedule:students:v1";
export const K_AIDES = "support-schedule:aides:v1";
export const K_WEEKS = "support-schedule:weeks:v1";
export const K_SETTINGS = "support-schedule:settings:v1";

// 全校共通の設定（学校名は印刷・出力の表題に使う）
export type Settings = {
  schoolName: string;
};

export function normalizeSettings(x: unknown): Settings {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const raw = typeof o.schoolName === "string" ? o.schoolName.trim() : "";
  return { schoolName: raw.slice(0, 60) };
}

function loadSettingsRaw(): Settings {
  if (!isBrowser()) return { schoolName: "" };
  try {
    const raw = window.localStorage.getItem(K_SETTINGS);
    if (!raw) return { schoolName: "" };
    return normalizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return { schoolName: "" };
  }
}

function saveSettingsRaw(v: Settings): boolean {
  if (!isBrowser()) return true;
  try {
    window.localStorage.setItem(K_SETTINGS, JSON.stringify(normalizeSettings(v)));
    return true;
  } catch {
    return false;
  }
}

export const loadSettings = () => loadSettingsRaw();
export const saveSettings = (v: Settings) => saveSettingsRaw(v);

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

// コマ指定の正規化（不正値の除外＋重複除去）
function cleanSlots(list: unknown): { day: number; period: number }[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: { day: number; period: number }[] = [];
  for (const s of list) {
    if (!isValidSlot(s)) continue;
    const k = `${s.day}-${s.period}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ day: s.day, period: s.period });
  }
  return out;
}

function cleanCells(cells: unknown): Record<string, Record<string, import("@/lib/types").CellPlan>> {
  if (!cells || typeof cells !== "object") return {};
  const out: Record<string, Record<string, import("@/lib/types").CellPlan>> = {};
  for (const [sid, bySlot] of Object.entries(cells as Record<string, unknown>)) {
    if (!bySlot || typeof bySlot !== "object") continue;
    const next: Record<string, import("@/lib/types").CellPlan> = {};
    for (const [key, cell] of Object.entries(bySlot as Record<string, unknown>)) {
      if (!/^[0-4]-[1-6]$/.test(key)) continue;
      if (isValidCell(cell)) next[key] = cell;
    }
    out[sid] = next;
  }
  return out;
}

// 週開始日の形式検証（YYYY-MM-DD・実在日）。不正な週は描画・出力が NaN になるため受け入れない
export function isValidWeekStart(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const [y, m, d] = x.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
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

// AI取り込み結果などの時間割を5日×6時限に正規化する（不正形状での描画クラッシュ・保存後消失を防ぐ）
export function normalizeTimetable(input: unknown): SlotContent[][] {
  const base = emptyTimetable();
  if (!Array.isArray(input)) return base;
  for (let d = 0; d < 5; d++) {
    const row: unknown = input[d];
    if (!Array.isArray(row)) continue;
    for (let p = 0; p < 6; p++) {
      const c: unknown = row[p];
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      base[d][p] = {
        subject: typeof o.subject === "string" ? o.subject.slice(0, 30) : "",
        content: typeof o.content === "string" ? o.content.slice(0, 100) : "",
      };
    }
  }
  return base;
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

export function normalizeStudent(x: Student): Student {
  return {
    ...x,
    exchangeClassId: typeof x.exchangeClassId === "string" ? x.exchangeClassId : null,
    exchangeSlots: cleanSlots(x.exchangeSlots),
    notes: typeof x.notes === "string" ? x.notes : undefined,
  };
}

export function isValidAide(x: unknown): x is Aide {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return isStr(o.id) && o.id.length > 0 && isStr(o.name) && Array.isArray(o.offSlots);
}

export function normalizeAide(x: Aide): Aide {
  return { ...x, offSlots: cleanSlots(x.offSlots) };
}

export function isValidWeek(x: unknown): x is WeekPlan {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return isStr(o.id) && o.id.length > 0 && isValidWeekStart(o.weekStart) && !!o.cells && typeof o.cells === "object";
}

// 週データの正規化。壊れたセル・欠席・行事メモ・担当表参照を落とし、下流の例外を防ぐ
export function normalizeWeek(w: WeekPlan, students: Student[], aides: Aide[], classes: ExchangeClass[]): WeekPlan {
  const cells = cleanCells(w.cells);
  let absent: WeekPlan["absent"];
  if (w.absent && typeof w.absent === "object") {
    const a: Record<string, number[]> = {};
    for (const [sid, days] of Object.entries(w.absent as Record<string, unknown>)) {
      if (!Array.isArray(days)) continue;
      const ds = days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 4);
      if (ds.length > 0) a[sid] = [...new Set(ds)].sort();
    }
    if (Object.keys(a).length > 0) absent = a;
  }
  let dayNotes: WeekPlan["dayNotes"];
  if (Array.isArray(w.dayNotes)) {
    const dn = Array.from({ length: 5 }, (_, i) => (typeof w.dayNotes?.[i] === "string" ? (w.dayNotes as string[])[i] : ""));
    if (dn.some((v) => v)) dayNotes = dn;
  }
  // 他マスタが渡されたときだけ担当表の参照整理を行う（load時はマスタ未確定のため軽量検証のみ）
  const posts = students.length + aides.length + classes.length > 0
    ? sanitizePosts(w.posts, students, aides, classes)
    : cleanPosts(w.posts);
  return { ...w, cells, absent, dayNotes, posts };
}

// 担当表の軽量検証（マスタ照合なし。形状が壊れた posts での例外を防ぐ）
function cleanPosts(posts: unknown): WeekPlan["posts"] {
  if (!Array.isArray(posts)) return [];
  const out: NonNullable<WeekPlan["posts"]> = [];
  for (const p of posts) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (!isStr(o.aideId) || !o.aideId) continue;
    const studentIds = Array.isArray(o.studentIds) ? o.studentIds.filter(isStr) : [];
    const classIds = Array.isArray(o.classIds) ? o.classIds.filter(isStr) : [];
    if (studentIds.length === 0 && classIds.length === 0) continue;
    out.push({ aideId: o.aideId, studentIds, classIds });
  }
  return out;
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
export const loadStudents = () => load(K_STUDENTS, isValidStudent).map(normalizeStudent);
export const loadAides = () => load(K_AIDES, isValidAide).map(normalizeAide);
export const loadWeeks = () => {
  const weeks = load(K_WEEKS, isValidWeek);
  // 担当表の参照整理には他マスタが必要なため、ここではセル・欠席・メモのみ正規化する
  return weeks.map((w) => normalizeWeek(w, [], [], []));
};
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
  const students = (o.students as unknown[]).filter(isValidStudent).map(normalizeStudent);
  const aides = (o.aides as unknown[]).filter(isValidAide).map(normalizeAide);
  const weeks = (o.weeks as unknown[]).filter(isValidWeek).map((w) => normalizeWeek(w, students, aides, classes));
  if (classes.length + students.length + aides.length + weeks.length === 0) {
    return { ok: false, error: "有効なデータがありませんでした" };
  }
  // 保存の成否を確認する（一部だけ保存される不整合を防ぐ）
  const saved = saveClasses(classes) && saveStudents(students) && saveAides(aides) && saveWeeks(weeks);
  if (!saved) {
    return { ok: false, error: "保存に失敗しました（ブラウザの容量を確認してください）。データが一部だけ書き換わった可能性があります" };
  }
  return { ok: true, counts: { classes: classes.length, students: students.length, aides: aides.length, weeks: weeks.length } };
}
