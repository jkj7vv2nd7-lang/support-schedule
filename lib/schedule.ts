import { blankCell, slotKey, type Aide, type CellPlan, type ExchangeClass, type Student } from "@/lib/types";

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

// 介助員を自動割付する（負荷均等・勤務不可を尊重）。手修正前提の提案。
export function autoAssignAides(
  cells: Record<string, Record<string, CellPlan>>,
  aides: Aide[],
): Record<string, Record<string, CellPlan>> {
  if (aides.length === 0) return cells;
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
      if (cell.aideId) {
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
