"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Btn, Card, Field, Notice, Select, StepHeading } from "@/components/ui";
import {
  DAYS,
  PERIODS,
  slotKey,
  type Aide,
  type CellPlan,
  type ExchangeClass,
  type Student,
  type WeekPlan,
} from "@/lib/types";
import { addDays, autoAssignAides, buildWeekCells, formatWeek, mondayOf } from "@/lib/schedule";
import { K_AIDES, K_CLASSES, K_STUDENTS, K_WEEKS, loadAides, loadClasses, loadStudents, loadWeeks, makeId, saveWeeks } from "@/lib/storage";
import { refreshStored, useStored } from "@/lib/store";

function todayMonday(): string {
  return mondayOf(new Date());
}

export default function WeeksPage() {
  const weeks = useStored(K_WEEKS, loadWeeks) ?? [];
  const students = useStored(K_STUDENTS, loadStudents) ?? [];
  const classes = useStored(K_CLASSES, loadClasses) ?? [];
  const aides = useStored(K_AIDES, loadAides) ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(() => todayMonday());
  const [copyFrom, setCopyFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeStudent, setActiveStudent] = useState<string>("");
  const [sel, setSel] = useState<{ sid: string; key: string } | null>(null);

  const aideById = new Map(aides.map((a) => [a.id, a]));
  const studentById = new Map(students.map((s) => [s.id, s]));

  function persist(next: WeekPlan[]) {
    const sorted = [...next].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
    if (!saveWeeks(sorted)) {
      setError("保存に失敗しました");
      return;
    }
    setError(null);
    refreshStored(K_WEEKS, loadWeeks);
  }

  function createWeek() {
    if (students.length === 0) {
      setError("先に「児童・介助員」で支援児童を登録してください");
      return;
    }
    const now = Date.now();
    let cells: WeekPlan["cells"];
    if (copyFrom) {
      const src = weeks.find((w) => w.id === copyFrom);
      cells = src ? JSON.parse(JSON.stringify(src.cells)) : buildWeekCells(students, classes);
    } else {
      cells = buildWeekCells(students, classes);
    }
    const week: WeekPlan = { id: makeId(), weekStart: newDate, cells, createdAt: now, updatedAt: now };
    persist([week, ...weeks]);
    setOpenId(week.id);
    setActiveStudent(students[0]?.id ?? "");
    setSel(null);
  }

  function updateCells(weekId: string, fn: (cells: WeekPlan["cells"]) => WeekPlan["cells"]) {
    persist(
      weeks.map((w) => (w.id === weekId ? { ...w, cells: fn(w.cells), updatedAt: Date.now() } : w)),
    );
  }

  function refreshFromMaster(week: WeekPlan) {
    updateCells(week.id, (cells) => buildWeekCells(students, classes, cells));
  }

  function runAutoAssign(week: WeekPlan) {
    updateCells(week.id, (cells) => autoAssignAides(cells, aides));
  }

  function removeWeek(id: string) {
    if (!window.confirm("この週予定を削除しますか？")) return;
    persist(weeks.filter((w) => w.id !== id));
    if (openId === id) setOpenId(null);
  }

  function updateCell(weekId: string, sid: string, key: string, patch: Partial<CellPlan>) {
    updateCells(weekId, (cells) => ({
      ...cells,
      [sid]: { ...(cells[sid] ?? {}), [key]: { ...(cells[sid]?.[key] ?? { place: "support", subject: "", content: "", teacher: "", aideId: null }), ...patch } },
    }));
  }

  const open = weeks.find((w) => w.id === openId) ?? null;
  const openStudentId = activeStudent && studentById.has(activeStudent) ? activeStudent : (students[0]?.id ?? "");
  const selCell = open && sel ? open.cells[sel.sid]?.[sel.key] : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">週予定</h1>
        <p className="mt-1 text-sm text-zinc-500">週ごとに作成し、児童別シートと全体一覧を印刷できます。</p>
      </div>
      {error ? <Notice tone="red">{error}</Notice> : null}

      <Card>
        <StepHeading step="＋">新しい週予定</StepHeading>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">週（月曜）</label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">コピー元</label>
            <select
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">白紙から作る</option>
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.weekStart}（{formatWeek(w.weekStart)}）をコピー
                </option>
              ))}
            </select>
          </div>
          <Btn onClick={createWeek}>作成する</Btn>
        </div>
      </Card>

      {weeks.length === 0 ? (
        <Card className="py-10 text-center text-sm text-zinc-500">まだ週予定がありません。</Card>
      ) : null}

      {weeks.map((w) => {
        const isOpen = openId === w.id;
        return (
          <Card key={w.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-base font-bold">
                  {w.weekStart}（{formatWeek(w.weekStart)}）
                </p>
                <p className="text-xs text-zinc-400">対象児童 {Object.keys(w.cells).length}名</p>
              </div>
              <div className="no-print flex flex-wrap gap-2">
                <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => { setOpenId(isOpen ? null : w.id); setActiveStudent(students[0]?.id ?? ""); setSel(null); }}>
                  {isOpen ? "閉じる" : "編集・印刷"}
                </Btn>
                <Btn variant="danger" className="px-3 py-1.5 text-xs" onClick={() => removeWeek(w.id)}>削除</Btn>
              </div>
            </div>

            {isOpen && open ? (
              <div className="no-print mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => refreshFromMaster(open)}>
                    交流内容を再反映
                  </Btn>
                  <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => runAutoAssign(open)}>
                    介助員を自動割付
                  </Btn>
                  <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>
                    印刷（児童別・全体・交流別）
                  </Btn>
                </div>
                <div className="flex flex-wrap gap-2">
                  {students.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={openStudentId === s.id}
                      onClick={() => { setActiveStudent(s.id); setSel(null); }}
                      className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
                        openStudentId === s.id
                          ? "border-teal-600 bg-teal-50 text-teal-800"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                {openStudentId && studentById.has(openStudentId) ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="w-10 border border-zinc-200 bg-zinc-50 px-1 py-1">時限</th>
                          {DAYS.map((d) => (
                            <th key={d} className="border border-zinc-200 bg-zinc-50 px-1 py-1">{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERIODS.map((p) => (
                          <tr key={p}>
                            <td className="border border-zinc-200 bg-zinc-50 px-1 py-1 text-center font-bold">{p}</td>
                            {DAYS.map((_, d) => {
                              const key = slotKey(d, p);
                              const cell = open.cells[openStudentId]?.[key];
                              const active = sel?.sid === openStudentId && sel?.key === key;
                              return (
                                <td key={d} className="border border-zinc-200 p-0.5 align-top">
                                  <button
                                    type="button"
                                    onClick={() => setSel(active ? null : { sid: openStudentId, key })}
                                    className={`block w-full rounded-lg border p-1.5 text-left transition-colors ${
                                      active ? "border-teal-600 bg-teal-50" : "border-transparent hover:border-zinc-300"
                                    } ${cell?.place === "exchange" ? "bg-sky-50/60" : ""}`}
                                  >
                                    <span className={`inline-block rounded px-1 text-[10px] font-bold ${cell?.place === "exchange" ? "bg-sky-200 text-sky-900" : "bg-zinc-200 text-zinc-700"}`}>
                                      {cell?.place === "exchange" ? "交流" : "支援"}
                                    </span>
                                    <span className="mt-0.5 block truncate text-xs font-bold">{cell?.subject || "（未定）"}</span>
                                    <span className="block truncate text-[10px] text-zinc-500">
                                      {cell?.aideId ? aideById.get(cell.aideId)?.name ?? "" : ""}
                                    </span>
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {sel && selCell ? (
                  <Card className="border-teal-200 bg-teal-50/40">
                    <p className="text-sm font-bold">
                      {studentById.get(sel.sid)?.name} ／ {DAYS[Number(sel.key.split("-")[0])]}曜 {sel.key.split("-")[1]}時限
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="場所">
                        <Select
                          value={selCell.place}
                          onChange={(e) => updateCell(open.id, sel.sid, sel.key, { place: e.target.value as CellPlan["place"] })}
                        >
                          <option value="support">支援学級</option>
                          <option value="exchange">交流クラス</option>
                        </Select>
                      </Field>
                      <Field label="介助員">
                        <Select
                          value={selCell.aideId ?? ""}
                          onChange={(e) => updateCell(open.id, sel.sid, sel.key, { aideId: e.target.value || null })}
                        >
                          <option value="">なし</option>
                          {aides.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="教科">
                        <input
                          value={selCell.subject}
                          onChange={(e) => updateCell(open.id, sel.sid, sel.key, { subject: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                        />
                      </Field>
                      <Field label="担当の先生">
                        <input
                          value={selCell.teacher}
                          onChange={(e) => updateCell(open.id, sel.sid, sel.key, { teacher: e.target.value })}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="学習内容">
                          <input
                            value={selCell.content}
                            onChange={(e) => updateCell(open.id, sel.sid, sel.key, { content: e.target.value })}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                          />
                        </Field>
                      </div>
                    </div>
                  </Card>
                ) : null}
              </div>
            ) : null}

            {isOpen && open ? <WeekPrint weeks={[open]} students={students} aides={aides} classes={classes} /> : null}
          </Card>
        );
      })}
    </div>
  );
}

function WeekPrint({
  weeks,
  students,
  aides,
  classes,
}: {
  weeks: WeekPlan[];
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
}) {
  const aideById = new Map(aides.map((a) => [a.id, a.name]));
  return (
    <div className="hidden print:block">
      {weeks.map((w) => (
        <div key={w.id} className="break-after-page">
          <h2 className="text-lg font-bold">
            週予定表 {w.weekStart}（{formatWeek(w.weekStart)}）
          </h2>
          {students
            .filter((s) => w.cells[s.id])
            .map((s) => (
              <div key={s.id} className="mt-4">
                <h3 className="text-sm font-bold">{s.name}</h3>
                <table className="mt-1 w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="border px-1 py-1">時限</th>
                      {DAYS.map((d) => (
                        <th key={d} className="border px-1 py-1">{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERIODS.map((p) => (
                      <tr key={p}>
                        <td className="border px-1 py-1 text-center font-bold">{p}</td>
                        {DAYS.map((_, d) => {
                          const c = w.cells[s.id]?.[slotKey(d, p)];
                          return (
                            <td key={d} className="border px-1 py-1 align-top">
                              <span className="font-bold">[{c?.place === "exchange" ? "交流" : "支援"}] {c?.subject}</span>
                              {c?.content ? <span className="block">{c.content}</span> : null}
                              <span className="block text-zinc-500">
                                {[c?.teacher, c?.aideId ? aideById.get(c.aideId) : ""].filter(Boolean).join("・")}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          <h3 className="mt-6 text-sm font-bold">全体一覧（介助員）</h3>
          {DAYS.map((d, day) => (
            <div key={d} className="mt-2">
              <h4 className="text-xs font-bold">{d}曜日（{addDays(w.weekStart, day).slice(5).replace("-", "/")}）</h4>
              <table className="mt-1 w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border px-1 py-1">児童</th>
                    {PERIODS.map((p) => (
                      <th key={p} className="border px-1 py-1">{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students
                    .filter((s) => w.cells[s.id])
                    .map((s) => (
                      <tr key={s.id}>
                        <td className="border px-1 py-1 font-bold">{s.name}</td>
                        {PERIODS.map((p) => {
                          const c = w.cells[s.id]?.[slotKey(day, p)];
                          return (
                            <td key={p} className="border px-1 py-1">
                              {c?.place === "exchange" ? "交流" : ""}{c?.subject}
                              {c?.aideId ? `（${aideById.get(c.aideId) ?? ""}）` : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          <h3 className="mt-6 text-sm font-bold">交流クラス別一覧</h3>
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-12 border px-1 py-1">曜日</th>
                <th className="w-24 border px-1 py-1">クラス</th>
                {PERIODS.map((p) => (
                  <th key={p} className="border px-1 py-1">{p}時限</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.flatMap((d, day) => {
                const rows: { key: string; label: ReactNode; cells: (p: number) => ReactNode }[] = [
                  ...classes.map((cls) => ({
                    key: `c-${cls.id}`,
                    label: <span className="font-bold">{cls.name}</span>,
                    cells: (p: number) => {
                      const key = slotKey(day, p);
                      const inClass = students.filter((s) => {
                        const c = w.cells[s.id]?.[key];
                        if (!c || c.place !== "exchange") return false;
                        return (c.classId ?? s.exchangeClassId) === cls.id;
                      });
                      if (inClass.length === 0) return <span className="text-zinc-400">―</span>;
                      const slot = cls.timetable[day]?.[p - 1];
                      const subj = slot?.subject || inClass.map((s) => w.cells[s.id]?.[key]?.subject ?? "").find(Boolean) || "";
                      const cont = slot?.content || inClass.map((s) => w.cells[s.id]?.[key]?.content ?? "").find(Boolean) || "";
                      const staff = Array.from(
                        new Set(
                          inClass.flatMap((s) => {
                            const c = w.cells[s.id]?.[key];
                            return [c?.teacher ?? "", c?.aideId ? (aideById.get(c.aideId) ?? "") : ""];
                          }).filter(Boolean),
                        ),
                      ).join("・");
                      return (
                        <>
                          <span className="font-bold">{inClass.map((s) => s.name).join("・")}</span>
                          {subj ? <span className="block">{subj}{cont ? `：${cont}` : ""}</span> : null}
                          {staff ? <span className="block text-zinc-500">{staff}</span> : null}
                        </>
                      );
                    },
                  })),
                  {
                    key: "support",
                    label: <span className="font-bold">支援学級</span>,
                    cells: (p: number) => {
                      const key = slotKey(day, p);
                      const inRoom = students.filter((s) => {
                        const c = w.cells[s.id]?.[key];
                        return c && c.place !== "exchange";
                      });
                      if (inRoom.length === 0) return <span className="text-zinc-400">―</span>;
                      return (
                        <>
                          {inRoom.map((s) => {
                            const c = w.cells[s.id]?.[key];
                            return (
                              <span key={s.id} className="block">
                                <span className="font-bold">{s.name}</span>
                                {c?.subject ? `：${c.subject}` : ""}
                              </span>
                            );
                          })}
                        </>
                      );
                    },
                  },
                ];
                return rows.map((r, ri) => (
                  <tr key={`${day}-${r.key}`}>
                    {ri === 0 ? (
                      <td rowSpan={rows.length} className="border px-1 py-1 text-center font-bold">
                        {d}
                        <span className="block text-[10px] font-normal text-zinc-500">
                          {addDays(w.weekStart, day).slice(5).replace("-", "/")}
                        </span>
                      </td>
                    ) : null}
                    <td className="border px-1 py-1 align-top">{r.label}</td>
                    {PERIODS.map((p) => (
                      <td key={p} className="border px-1 py-1 align-top">
                        {r.cells(p)}
                      </td>
                    ))}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
