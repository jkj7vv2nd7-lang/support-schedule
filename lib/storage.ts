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
  if (isCellArray(x.timetable)) return x;
  return { ...x, timetable: emptyTimetable() };
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

export const loadClasses = () => load(K_CLASSES, isValidClass).map(normalizeClass);
export const loadStudents = () => load(K_STUDENTS, isValidStudent);
export const loadAides = () => load(K_AIDES, isValidAide);
export const loadWeeks = () => load(K_WEEKS, isValidWeek);
export const saveClasses = (v: ExchangeClass[]) => save(K_CLASSES, v);
export const saveStudents = (v: Student[]) => save(K_STUDENTS, v);
export const saveAides = (v: Aide[]) => save(K_AIDES, v);
export const saveWeeks = (v: WeekPlan[]) => save(K_WEEKS, v);
