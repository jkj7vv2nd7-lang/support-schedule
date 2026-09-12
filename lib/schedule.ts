import { blankCell, slotKey, type Aide, type CellPlan, type ExchangeClass, type Student, type WeekAidePost, type WeekPlan } from "@/lib/types";

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
