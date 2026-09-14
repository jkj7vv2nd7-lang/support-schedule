"use client";

import { useEffect, useState } from "react";
import { Btn, Card, Field, Notice, Select, StepHeading } from "@/components/ui";
import {
  DAYS,
  PERIODS,
  isAbsent,
  slotKey,
  type Aide,
  type CellPlan,
  type ExchangeClass,
  type Student,
  type WeekPlan,
} from "@/lib/types";
import { addDays, applyRoster, autoAssignAides, buildWeekCells, classOverviewTable, daySections, formatWeek, mondayOf } from "@/lib/schedule";
import { K_AIDES, K_CLASSES, K_STUDENTS, K_WEEKS, loadAides, loadClasses, loadStudents, loadWeeks, makeId, saveWeeks } from "@/lib/storage";
import { refreshStored, useStored } from "@/lib/store";
import ExportButtons from "@/components/export-buttons";

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
  const [layouts, setLayouts] = useState({ sheets: true, overview: true, exchange: true, aides: true, classDaily: false, classOverview: false });
  const layoutsOn = layouts.sheets || layouts.overview || layouts.exchange || layouts.aides || layouts.classDaily || layouts.classOverview;
  // 「クラス別(日ごと)」はPDF/Excel/Wordのみ対応（ブラウザ印刷ビューは未対応）なので、印刷ボタンの活性判定には含めない
  const printLayoutsOn = layouts.sheets || layouts.overview || layouts.exchange || layouts.aides || layouts.classOverview;
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  function toggleLayout(key: "sheets" | "overview" | "exchange" | "aides" | "classDaily" | "classOverview") {
    setLayouts((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || Number.isNaN(new Date(`${newDate}T00:00:00`).getTime())) {
      setError("週（月曜）の日付が正しくありません");
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
      weeks.map((w) =>
        w.id === weekId ? { ...w, cells: fn(buildWeekCells(students, classes, w.cells)), updatedAt: Date.now() } : w,
      ),
    );
  }

  function refreshFromMaster(week: WeekPlan) {
    updateCells(week.id, (cells) => buildWeekCells(students, classes, cells));
    setNotice("交流クラスの時間割を反映しました");
  }

  function runAutoAssign(week: WeekPlan) {
    updateCells(week.id, (cells) => autoAssignAides(applyRoster(cells, students, week.posts, week.absent), aides, week.absent));
    setNotice("介助員を自動割付しました");
  }

  function setPost(weekId: string, aideId: string, kind: "studentIds" | "classIds", id: string, on: boolean) {
    persist(
      weeks.map((w) => {
        if (w.id !== weekId) return w;
        const posts = [...(w.posts ?? [])];
        const idx = posts.findIndex((p) => p.aideId === aideId);
        const cur = idx >= 0 ? posts[idx] : { aideId, studentIds: [], classIds: [] };
        const list = on
          ? cur[kind].includes(id)
            ? cur[kind]
            : [...cur[kind], id]
          : cur[kind].filter((x) => x !== id);
        const next = { ...cur, [kind]: list };
        if (idx >= 0) {
          if (next.studentIds.length === 0 && next.classIds.length === 0) posts.splice(idx, 1);
          else posts[idx] = next;
        } else if (next.studentIds.length > 0 || next.classIds.length > 0) {
          posts.push(next);
        }
        return { ...w, posts, updatedAt: Date.now() };
      }),
    );
  }

  // 欠席トグル。欠席にした曜日は介助員を外して空ける
  function toggleAbsent(weekId: string, sid: string, day: number) {
    persist(
      weeks.map((w) => {
        if (w.id !== weekId) return w;
        const merged = buildWeekCells(students, classes, w.cells);
        if (!merged[sid]) return w;
        const days = [...(w.absent?.[sid] ?? [])];
        const idx = days.indexOf(day);
        if (idx >= 0) days.splice(idx, 1);
        else days.push(day);
        const absent = { ...(w.absent ?? {}) };
        if (days.length > 0) absent[sid] = days.sort();
        else delete absent[sid];
        const bySlot = { ...merged[sid] };
        for (const [key, cell] of Object.entries(bySlot)) {
          if (Number(key.split("-")[0]) === day && cell.aideId) {
            bySlot[key] = { ...cell, aideId: null };
          }
        }
        return { ...w, absent, cells: { ...merged, [sid]: bySlot }, updatedAt: Date.now() };
      }),
    );
  }

  function removeWeek(id: string) {
    if (!window.confirm("この週予定を削除しますか？")) return;
    persist(weeks.filter((w) => w.id !== id));
    if (openId === id) setOpenId(null);
  }

  // 今週だけの行事・予定メモ（曜日別）
  function setDayNote(weekId: string, day: number, value: string) {
    persist(
      weeks.map((w) => {
        if (w.id !== weekId) return w;
        const dayNotes = Array.from({ length: 5 }, (_, i) => (i === day ? value : w.dayNotes?.[i] ?? ""));
        return { ...w, dayNotes, updatedAt: Date.now() };
      }),
    );
  }

  function updateCell(weekId: string, sid: string, key: string, patch: Partial<CellPlan>) {
    updateCells(weekId, (cells) => ({
      ...cells,
      [sid]: { ...(cells[sid] ?? {}), [key]: { ...(cells[sid]?.[key] ?? { place: "support", subject: "", content: "", teacher: "", aideId: null }), ...patch } },
    }));
  }

  const openRaw = weeks.find((w) => w.id === openId) ?? null;
  // 後から登録された児童などのセル欠落を表示時に補完する（保存は編集時に行われる）
  const open = openRaw ? { ...openRaw, cells: buildWeekCells(students, classes, openRaw.cells) } : null;
  const openStudentId = activeStudent && studentById.has(activeStudent) ? activeStudent : (students[0]?.id ?? "");
  const selCell = open && sel ? open.cells[sel.sid]?.[sel.key] : undefined;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <h1 className="text-xl font-bold">週予定</h1>
        <p className="mt-1 text-sm text-zinc-500">週ごとに作成し、児童別シートと全体一覧を印刷できます。</p>
      </div>
      {error ? (
        <div className="no-print">
          <Notice tone="red">{error}</Notice>
        </div>
      ) : null}
      {notice ? (
        <div className="no-print">
          <Notice tone="blue">{notice}</Notice>
        </div>
      ) : null}

      <Card className="no-print">
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
            <div className="no-print flex flex-wrap items-center justify-between gap-2">
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
                  <Btn variant="secondary" className="px-3 py-1.5 text-xs" disabled={!printLayoutsOn} onClick={() => window.print()}>
                    印刷する
                  </Btn>
                  <ExportButtons week={open} students={students} aides={aides} classes={classes} layouts={layouts} layoutsOn={layoutsOn} onError={setError} onSuccess={(format) => setNotice(`${{ pdf: "PDF", xlsx: "Excel", docx: "Word" }[format]}をダウンロードしました`)} />
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                  <p className="text-sm font-bold">今週の予定（曜日別・任意）</p>
                  <p className="mt-0.5 text-xs text-zinc-400">学校行事など、その週だけのメモです（毎週入力し直します）。</p>
                  <div className="mt-2 grid grid-cols-5 gap-1">
                    {DAYS.map((d, i) => (
                      <input
                        key={d}
                        defaultValue={open.dayNotes?.[i] ?? ""}
                        onBlur={(e) => setDayNote(open.id, i, e.target.value)}
                        placeholder={d}
                        aria-label={`今週の予定（${d}曜）`}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-1 py-2 text-center text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                  <p className="text-sm font-bold">今週の介助員担当（毎週変更可）</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    担当にした児童・クラスは、新規セルや「介助員を自動割付」に反映されます。セル単位の手修正も可能です。
                  </p>
                  {aides.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-400">介助員が未登録です。「児童・介助員」で登録してください。</p>
                  ) : null}
                  {aides.map((a) => {
                    const post = open.posts?.find((p) => p.aideId === a.id);
                    return (
                      <div key={a.id} className="mt-2 border-t border-zinc-100 pt-2">
                        <p className="text-xs font-bold">{a.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-zinc-400">児童：</span>
                          {students.map((s) => (
                            <label key={s.id} className="flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs has-checked:border-blue-600 has-checked:bg-blue-50">
                              <input
                                type="checkbox"
                                checked={post?.studentIds.includes(s.id) ?? false}
                                onChange={(e) => setPost(open.id, a.id, "studentIds", s.id, e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600/20"
                              />
                              {s.name}
                            </label>
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-zinc-400">交流：</span>
                          {classes.map((c) => (
                            <label key={c.id} className="flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs has-checked:border-blue-600 has-checked:bg-blue-50">
                              <input
                                type="checkbox"
                                checked={post?.classIds.includes(c.id) ?? false}
                                onChange={(e) => setPost(open.id, a.id, "classIds", c.id, e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600/20"
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-zinc-600">出力する表：</span>
                  {(
                    [
                      { key: "sheets", label: "児童別" },
                      { key: "overview", label: "全体一覧" },
                      { key: "exchange", label: "交流クラス別" },
                      { key: "aides", label: "介助員別" },
                      { key: "classDaily", label: "クラス別(日ごと)" },
                      { key: "classOverview", label: "クラス×曜日 一覧(1枚)" },
                    ] as const
                  ).map((l) => (
                    <label key={l.key} className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-700">
                      <input
                        type="checkbox"
                        checked={layouts[l.key]}
                        onChange={() => toggleLayout(l.key)}
                        className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-600/20"
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
                {layouts.classDaily ? (
                  <p className="text-xs text-zinc-400">※「クラス別(日ごと)」はPDF・Excel・Wordの書き出しのみ対応です（画面の印刷ボタンには反映されません）</p>
                ) : null}
                {layouts.classOverview ? (
                  <p className="text-xs text-zinc-400">※「クラス×曜日 一覧(1枚)」は児童名なしでA4横1枚に収まります（印刷ボタン・PDF対応。参考様式の主表と同じ構成です）</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {students.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={openStudentId === s.id}
                      onClick={() => { setActiveStudent(s.id); setSel(null); }}
                      className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
                        openStudentId === s.id
                          ? "border-blue-600 bg-blue-50 text-blue-800"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                {openStudentId && studentById.has(openStudentId) ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-zinc-600">
                      {studentById.get(openStudentId)?.name}の欠席：
                    </span>
                    {DAYS.map((d, day) => {
                      const off = (open.absent?.[openStudentId] ?? []).includes(day);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={off}
                          title={`${d}曜日を欠席にする`}
                          onClick={() => toggleAbsent(open.id, openStudentId, day)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                            off
                              ? "border-red-500 bg-red-50 text-red-700"
                              : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300"
                          }`}
                        >
                          {d}{off ? "休" : ""}
                        </button>
                      );
                    })}
                    <span className="text-[11px] text-zinc-400">欠席日は介助員を外し、印刷では「欠席」と表示</span>
                  </div>
                ) : null}
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
                              const absent = isAbsent(open, openStudentId, d);
                              return (
                                <td key={d} className="border border-zinc-200 p-0.5 align-top">
                                  <button
                                    type="button"
                                    onClick={() => setSel(active ? null : { sid: openStudentId, key })}
                                    className={`block w-full rounded-lg border p-1.5 text-left transition-colors ${
                                      active ? "border-blue-600 bg-blue-50" : "border-transparent hover:border-zinc-300"
                                    } ${absent ? "bg-zinc-100" : cell?.place === "exchange" ? "bg-sky-50/60" : ""}`}
                                  >
                                    {absent ? (
                                      <span className="inline-block rounded bg-zinc-300 px-1 text-[10px] font-bold text-zinc-600">
                                        欠席
                                      </span>
                                    ) : (
                                      <span className={`inline-block rounded px-1 text-[10px] font-bold ${cell?.place === "exchange" ? "bg-sky-200 text-sky-900" : "bg-zinc-200 text-zinc-700"}`}>
                                        {cell?.place === "exchange" ? "交流" : "支援"}
                                      </span>
                                    )}
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
                  <Card className="border-blue-200 bg-blue-50/40">
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

            {isOpen && open ? <WeekPrint weeks={[open]} students={students} aides={aides} classes={classes} layouts={layouts} /> : null}
          </Card>
        );
      })}
    </div>
  );
}

export type PrintLayouts = { sheets: boolean; overview: boolean; exchange: boolean; aides: boolean; classDaily?: boolean; classOverview?: boolean };

function WeekPrint({
  weeks,
  students,
  aides,
  classes,
  layouts,
}: {
  weeks: WeekPlan[];
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
  layouts: PrintLayouts;
}) {
  const aideById = new Map(aides.map((a) => [a.id, a.name]));
  const laterAfterSheets = (hasMoreSheets: boolean) => hasMoreSheets || layouts.overview || layouts.exchange;
  return (
    <div className="hidden print:block">
      {weeks.map((w) => {
        const sheetStudents = students.filter((s) => w.cells[s.id]);
        const overview = layouts.classOverview ? classOverviewTable({ week: w, students, aides, classes }) : null;
        return (
          <div key={w.id}>
            {overview && overview.columns.length > 0 ? (
              <div className={layouts.sheets || layouts.overview || layouts.exchange || layouts.aides ? "break-after-page" : undefined}>
                <h2 className="text-lg font-bold">
                  週予定表 {w.weekStart}（{formatWeek(w.weekStart)}）
                </h2>
                <h3 className="mt-2 text-sm font-bold">クラス×曜日 一覧</h3>
                <table className="onepage-table mt-1 w-full border-collapse">
                  <thead>
                    <tr>
                      {overview.header.map((h, hi) => (
                        <th key={hi} className={hi === 0 ? "w-10 border px-1 py-1" : "border px-1 py-1"}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={ci === 0 ? "border px-1 py-1 text-center font-bold" : "border px-1 py-1 align-top"}>
                            {cell.split("\n").map((line, li) => (
                              <span key={li} className="block">{line || " "}</span>
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {layouts.sheets
              ? sheetStudents.map((s, si) => (
                  <div key={s.id} className={laterAfterSheets(si < sheetStudents.length - 1) ? "break-after-page" : undefined}>
                {si === 0 && !overview ? (
                  <h2 className="text-lg font-bold">
                    週予定表 {w.weekStart}（{formatWeek(w.weekStart)}）
                  </h2>
                ) : null}
                <h3 className="mt-4 text-sm font-bold">{s.name}</h3>
                <table className="mt-1 w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="w-14 border px-1 py-1">曜日</th>
                      {PERIODS.map((p) => (
                        <th key={p} className="border px-1 py-1">{p}時限</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((d, day) => (
                      <tr key={d}>
                        <td className="border px-1 py-1 text-center font-bold">
                          {d}
                          <span className="block text-[10px] font-normal text-zinc-500">
                            {addDays(w.weekStart, day).slice(5).replace("-", "/")}
                          </span>
                        </td>
                        {PERIODS.map((p) => {
                          const c = w.cells[s.id]?.[slotKey(day, p)];
                          const absent = isAbsent(w, s.id, day);
                          return (
                            <td key={p} className="border px-1 py-1 align-top">
                              {absent ? (
                                <span className="font-bold">欠席</span>
                              ) : (
                                <>
                                  <span className="font-bold">[{c?.place === "exchange" ? "交流" : "支援"}] {c?.subject}</span>
                                  {c?.content ? <span className="block">{c.content}</span> : null}
                                  <span className="block text-zinc-500">
                                    {[c?.teacher, c?.aideId ? aideById.get(c.aideId) : ""].filter(Boolean).join("・")}
                                  </span>
                                </>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.notes ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed">
                    <span className="font-bold">〔配慮メモ・引き継ぎ〕</span>
                    <span className="whitespace-pre-wrap">{s.notes}</span>
                  </div>
                ) : null}
              </div>
            ))
          : null}
          {layouts.overview ? (
            <div className={layouts.exchange ? "break-after-page" : undefined}>
            <h3 className="mt-6 text-sm font-bold">全体一覧（介助員）</h3>
            <table className="mt-1 w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="w-14 border px-1 py-1">曜日</th>
                  <th className="w-20 border px-1 py-1">児童</th>
                  {PERIODS.map((p) => (
                    <th key={p} className="border px-1 py-1">{p}時限</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.flatMap((d, day) => {
                  const rows = students.filter((s) => w.cells[s.id]);
                  return rows.map((s, ri) => (
                    <tr key={`${day}-${s.id}`}>
                      {ri === 0 ? (
                        <td rowSpan={rows.length} className="border px-1 py-1 text-center font-bold">
                          {d}
                          <span className="block text-[10px] font-normal text-zinc-500">
                            {addDays(w.weekStart, day).slice(5).replace("-", "/")}
                          </span>
                        </td>
                      ) : null}
                      <td className="border px-1 py-1 font-bold">{s.name}</td>
                      {PERIODS.map((p) => {
                        const c = w.cells[s.id]?.[slotKey(day, p)];
                        const absent = isAbsent(w, s.id, day);
                        return (
                          <td key={p} className="border px-1 py-1">
                            {absent ? (
                              "欠席"
                            ) : (
                              <>
                                {c?.place === "exchange" ? "交流" : ""}{c?.subject}
                                {c?.aideId ? `（${aideById.get(c.aideId) ?? ""}）` : ""}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          ) : null}
          {layouts.exchange
            ? daySections({ week: w, students, aides, classes }).map((sec, si, arr) => (
                <div key={si} className={si < arr.length - 1 ? "break-after-page" : undefined}>
                  <h3 className="mt-6 text-sm font-bold">交流クラス別一覧</h3>
                  <p className="mt-1 text-sm font-bold">{sec.weekday}（{sec.date}）</p>
                  <table className="mt-1 w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        {["クラス", ...PERIODS.map((p) => `${p}時限`)].map((h, hi) => (
                          <th key={hi} className="border px-1 py-1">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map((row, ri) => (
                        <tr key={ri}>
                          <td className="border px-1 py-1 align-top font-bold">{row.label}</td>
                          {row.cells.map((cell, ci) => (
                            <td key={ci} className="border px-1 py-1 align-top">
                              {cell.split("\n").map((line, li) => (
                                <span key={li} className="block">{line || " "}</span>
                              ))}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            : null}
          {layouts.aides
            ? aides.map((a, ai) => {
                const moreAfter = aides.slice(ai + 1).length > 0;
                return (
                  <div key={a.id} className={moreAfter ? "break-after-page" : undefined}>
                    <h3 className="mt-6 text-sm font-bold">{a.name}（介助）</h3>
                    <table className="mt-1 w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="w-14 border px-1 py-1">曜日</th>
                          {PERIODS.map((p) => (
                            <th key={p} className="border px-1 py-1">{p}時限</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map((d, day) => (
                          <tr key={d}>
                            <td className="border px-1 py-1 text-center font-bold">
                              {d}
                              <span className="block text-[10px] font-normal text-zinc-500">
                                {addDays(w.weekStart, day).slice(5).replace("-", "/")}
                              </span>
                            </td>
                            {PERIODS.map((p) => {
                              const key = slotKey(day, p);
                              const assigned = students.filter((s) => w.cells[s.id]?.[key]?.aideId === a.id && !isAbsent(w, s.id, day));
                              return (
                                <td key={p} className="border px-1 py-1 align-top">
                                  {assigned.length === 0 ? (
                                    <span className="text-zinc-400">―</span>
                                  ) : (
                                    assigned.map((s) => {
                                      const c = w.cells[s.id]?.[key];
                                      return (
                                        <span key={s.id} className="block">
                                          <span className="font-bold">{s.name}</span>
                                          {c ? `：${c.place === "exchange" ? "交流" : "支援"}${c.subject ?? ""}` : ""}
                                          {c?.content ? <span className="block text-zinc-500">{c.content}</span> : null}
                                        </span>
                                      );
                                    })
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })
            : null}
        </div>
      );
    })}
    </div>
  );
}
