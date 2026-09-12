import { blankCell, slotKey, DAYS, PERIODS, type Aide, type CellPlan, type ExchangeClass, type Student, type WeekAidePost, type WeekPlan } from "@/lib/types";

// 児童・交流時間割から週のセル雛形を作る（既存セルがあれば温存）
export function buildWeekCells(
  students: Student[],
  classes: ExchangeClass[],
  prev?: Record<string, Record<string, CellPlan>>,
): Record<string, Record<string, CellPlan>> {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const out: Record<string, Record<string, CellPlan>> = {};
  for (const st of students) {
    const cls = st.exchangeClassId ? classById.get(st.exchangeClassId) : undefined;
    const exchangeKeys = new Set(st.exchangeSlots.map((s) => slotKey(s.day, s.period)));
    const cur: Record<string, CellPlan> = {};
    for (let day = 0; day < 5; day++) {
      for (let period = 1; period <= 6; period++) {
        const key = slotKey(day, period);
        const kept = prev?.[st.id]?.[key];
        if (kept) {
          cur[key] = kept;
          continue;
        }
        if (exchangeKeys.has(key) && cls) {
          const src = cls.timetable[day]?.[period - 1];
          cur[key] = {
            place: "exchange",
            subject: src?.subject ?? "",
            content: src?.content ?? "",
            teacher: "",
            aideId: null,
            classId: cls.id,
          };
        } else {
          cur[key] = blankCell("support");
        }
      }
    }
    out[st.id] = cur;
  }
  return out;
}

// 週の担当表を空きセルに反映する（児童指定＞クラス指定）。手修正済みセルは温存。
export function applyRoster(
  cells: Record<string, Record<string, CellPlan>>,
  students: Student[],
  posts: WeekAidePost[] | undefined,
  absent?: Record<string, number[]>,
): Record<string, Record<string, CellPlan>> {
  const list = Array.isArray(posts) ? posts : [];
  const clean = list
    .filter((p) => !!p && typeof p === "object")
    .map((p) => p as unknown as Record<string, unknown>)
    .filter((o) => typeof o.aideId === "string" && o.aideId.length > 0)
    .map((o) => ({
      aideId: o.aideId as string,
      studentIds: Array.isArray(o.studentIds) ? o.studentIds.filter((x): x is string => typeof x === "string") : [],
      classIds: Array.isArray(o.classIds) ? o.classIds.filter((x): x is string => typeof x === "string") : [],
    }));
  if (clean.length === 0) return cells;
  const byStudent = new Map<string, string>();
  const byClass = new Map<string, string>();
  for (const p of clean) {
    for (const sid of p.studentIds) {
      if (!byStudent.has(sid)) byStudent.set(sid, p.aideId);
    }
    for (const cid of p.classIds) {
      if (!byClass.has(cid)) byClass.set(cid, p.aideId);
    }
  }
  const classOf = new Map(students.map((s) => [s.id, s.exchangeClassId]));
  const out: Record<string, Record<string, CellPlan>> = {};
  for (const [sid, bySlot] of Object.entries(cells)) {
    const offDays = Array.isArray(absent?.[sid]) ? (absent as Record<string, number[]>)[sid] : [];
    const next: Record<string, CellPlan> = {};
    for (const [key, cell] of Object.entries(bySlot)) {
      if (cell.aideId || offDays.includes(Number(key.split("-")[0]))) {
        next[key] = cell;
        continue;
      }
      const cid = cell.classId ?? classOf.get(sid) ?? null;
      // クラス指定は交流セルのみ。児童指定は全セル
      const aide = byStudent.get(sid) ?? (cell.place === "exchange" && cid ? byClass.get(cid) : undefined) ?? null;
      next[key] = aide ? { ...cell, aideId: aide } : cell;
    }
    out[sid] = next;
  }
  return out;
}
export function autoAssignAides(
  cells: Record<string, Record<string, CellPlan>>,
  aides: Aide[],
  absent?: Record<string, number[]>,
): Record<string, Record<string, CellPlan>> {
  if (aides.length === 0) return cells;
  const absentKey = (sid: string, key: string): boolean => {
    const days = absent?.[sid];
    if (!Array.isArray(days)) return false;
    return days.includes(Number(key.split("-")[0]));
  };
  const off = new Set<string>();
  for (const a of aides) {
    for (const s of a.offSlots) off.add(`${a.id}@${slotKey(s.day, s.period)}`);
  }
  const load = new Map<string, number>(aides.map((a) => [a.id, 0]));
  // 既存割付を負荷に計上
  for (const bySlot of Object.values(cells)) {
    for (const cell of Object.values(bySlot)) {
      if (cell.aideId && load.has(cell.aideId)) load.set(cell.aideId, (load.get(cell.aideId) ?? 0) + 1);
    }
  }
  const out: Record<string, Record<string, CellPlan>> = {};
  for (const [sid, bySlot] of Object.entries(cells)) {
    const next: Record<string, CellPlan> = {};
    for (const [key, cell] of Object.entries(bySlot)) {
      if (cell.aideId || absentKey(sid, key)) {
        next[key] = cell;
        continue;
      }
      const cands = aides
        .filter((a) => !off.has(`${a.id}@${key}`))
        .sort((x, y) => (load.get(x.id) ?? 0) - (load.get(y.id) ?? 0));
      if (cands.length === 0) {
        next[key] = cell;
        continue;
      }
      const pick = cands[0];
      load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
      next[key] = { ...cell, aideId: pick.id };
    }
    out[sid] = next;
  }
  return out;
}

export function mondayOf(date: Date): string {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const mm = `${dt.getMonth() + 1}`.padStart(2, "0");
  const dd = `${dt.getDate()}`.padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function formatWeek(weekStart: string): string {
  const end = addDays(weekStart, 4);
  const f = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  return `${f(weekStart)}〜${f(end)}の週`;
}

export function aideName(aides: Aide[], id: string | null): string {
  if (!id) return "";
  return aides.find((a) => a.id === id)?.name ?? "";
}

function absentDaysOf(week: WeekPlan, sid: string): number[] {
  const days = week.absent?.[sid];
  return Array.isArray(days) ? days.filter((d): d is number => typeof d === "number") : [];
}

// 交流クラス別ブロック（参考様式準拠）
export type ExchangeCell = { subject: string; content: string; staff: string; names: string };
export type ExchangeClassBlock = {
  classId: string;
  className: string;
  grade: string;
  studentNames: string[];
  dates: string[];
  weekdays: string[];
  morning: string[];
  notice: string;
  cells: ExchangeCell[][]; // [day][period]
};

export type WeekBlockInput = {
  week: WeekPlan;
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
};

function exchangeCell(input: WeekBlockInput, cls: ExchangeClass, day: number, p: number): ExchangeCell & { names: string } {
  const key = slotKey(day, p);
  const inClass = input.students.filter((s) => {
    if (absentDaysOf(input.week, s.id).includes(day)) return false;
    const c = input.week.cells[s.id]?.[key];
    if (!c || c.place !== "exchange") return false;
    return (c.classId ?? s.exchangeClassId) === cls.id;
  });
  if (inClass.length === 0) return { subject: "", content: "", staff: "", names: "" };
  const slot = cls.timetable[day]?.[p - 1];
  const subj = slot?.subject || inClass.map((s) => input.week.cells[s.id]?.[key]?.subject ?? "").find(Boolean) || "";
  const cont = slot?.content || inClass.map((s) => input.week.cells[s.id]?.[key]?.content ?? "").find(Boolean) || "";
  const staff = Array.from(
    new Set(
      inClass.flatMap((s) => {
        const c = input.week.cells[s.id]?.[key];
        return [c?.teacher ?? "", aideName(input.aides, c?.aideId ?? null)];
      }).filter(Boolean),
    ),
  ).join("・");
  return { subject: subj, content: cont, staff, names: inClass.map((s) => s.name).join("・") };
}

export function classBlocks(input: WeekBlockInput): ExchangeClassBlock[] {
  return input.classes.map((cls) => ({
    classId: cls.id,
    className: cls.name,
    grade: cls.grade ?? "",
    studentNames: input.students
      .filter((s) =>
        Object.entries(input.week.cells[s.id] ?? {}).some(([, c]) => {
          if (!c || c.place !== "exchange") return false;
          return (c.classId ?? s.exchangeClassId) === cls.id;
        }),
      )
      .map((s) => s.name),
    dates: DAYS.map((_, day) => addDays(input.week.weekStart, day).slice(5).replace("-", "/")),
    weekdays: [...DAYS],
    morning: Array.from({ length: 5 }, (_, day) => (Array.isArray(cls.morning) ? cls.morning[day] ?? "" : "")),
    notice: typeof cls.notice === "string" ? cls.notice : "",
    cells: DAYS.map((_, day) => PERIODS.map((p) => exchangeCell(input, cls, day, p))),
  }));
}

// クラス別ブロックの印刷用テーブル（参考様式準拠：日付・曜日・朝活動・時限×教科/内容/担当・連絡等）
export type ClassBlockTable = { title: string; header: string[]; rows: string[][] };

export function classBlockTables(input: WeekBlockInput): ClassBlockTable[] {
  return classBlocks(input).map((b) => {
    const header = ["", ...b.dates];
    const rows: string[][] = [
      ["曜日", ...b.weekdays],
      ...(b.morning.some(Boolean) ? [["朝活動", ...b.morning]] : []),
    ];
    PERIODS.forEach((p, pi) => {
      rows.push([`${p} 教科`, ...b.cells.map((day) => day[pi].subject)]);
      rows.push([`${p} 内容`, ...b.cells.map((day) => day[pi].content)]);
      rows.push([`${p} 担当`, ...b.cells.map((day) => day[pi].staff)]);
    });
    if (b.notice) rows.push(["連絡等", b.notice, "", "", "", ""]);
    return { title: `${b.className}（${b.studentNames.join("・")}）`, header, rows };
  });
}

// 削除時の参照整理。壊れた参照を落とし、現行データを守る。
export function detachClassFromStudents(students: Student[], classId: string): { students: Student[]; changed: boolean } {
  let changed = false;
  const next = students.map((s) => {
    if (s.exchangeClassId !== classId) return s;
    changed = true;
    return { ...s, exchangeClassId: null, exchangeSlots: [] };
  });
  return { students: next, changed };
}

export function detachStudentFromWeeks(weeks: WeekPlan[], studentId: string): { weeks: WeekPlan[]; changed: boolean } {
  let changed = false;
  const next = weeks.map((w) => {
    if (!w.cells[studentId]) return w;
    changed = true;
    const cells = { ...w.cells };
    delete cells[studentId];
    return { ...w, cells, updatedAt: Date.now() };
  });
  return { weeks: next, changed };
}

export function detachAideFromWeeks(weeks: WeekPlan[], aideId: string): { weeks: WeekPlan[]; changed: boolean } {
  let changed = false;
  const next = weeks.map((w) => {
    let cells = w.cells;
    let posts = w.posts;
    let touched = false;
    const nc: WeekPlan["cells"] = {};
    for (const [sid, bySlot] of Object.entries(cells)) {
      const nb: Record<string, CellPlan> = {};
      for (const [key, cell] of Object.entries(bySlot)) {
        if (cell.aideId === aideId) {
          touched = true;
          nb[key] = { ...cell, aideId: null };
        } else {
          nb[key] = cell;
        }
      }
      nc[sid] = nb;
    }
    if (touched) cells = nc;
    if (Array.isArray(posts)) {
      const np = posts.filter((p) => p && typeof p === "object" && (p as { aideId?: unknown }).aideId !== aideId);
      if (np.length !== posts.length) {
        touched = true;
        posts = np as WeekPlan["posts"];
      }
    }
    if (!touched) return w;
    changed = true;
    return { ...w, cells, posts, updatedAt: Date.now() };
  });
  return { weeks: next, changed };
}
