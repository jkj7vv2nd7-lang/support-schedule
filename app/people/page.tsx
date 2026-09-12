"use client";

import { useState } from "react";
import { Btn, Card, Field, Notice, Select, StepHeading, TextInput } from "@/components/ui";
import { DAYS, PERIODS, slotKey, type Aide, type ExchangeSlot, type Student } from "@/lib/types";
import { K_AIDES, K_CLASSES, K_STUDENTS, K_WEEKS, loadAides, loadClasses, loadStudents, loadWeeks, makeId, saveAides, saveStudents, saveWeeks } from "@/lib/storage";
import { detachAideFromWeeks, detachStudentFromWeeks } from "@/lib/schedule";
import { refreshStored, useStored } from "@/lib/store";

function toggleSlot(list: ExchangeSlot[], day: number, period: number): ExchangeSlot[] {
  const key = slotKey(day, period);
  if (list.some((s) => slotKey(s.day, s.period) === key)) {
    return list.filter((s) => slotKey(s.day, s.period) !== key);
  }
  return [...list, { day, period }];
}

function SlotGrid({
  selected,
  onToggle,
  hint,
}: {
  selected: ExchangeSlot[];
  onToggle: (day: number, period: number) => void;
  hint?: (day: number, period: number) => string;
}) {
  const set = new Set(selected.map((s) => slotKey(s.day, s.period)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr>
            <th className="w-10" />
            {DAYS.map((d) => (
              <th key={d} className="px-1 py-1 text-center text-xs text-zinc-500">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((p) => (
            <tr key={p}>
              <td className="px-1 py-1 text-center text-xs font-bold text-zinc-500">{p}</td>
              {DAYS.map((_, d) => {
                const on = set.has(slotKey(d, p));
                const h = hint?.(d, p) ?? "";
                return (
                  <td key={d} className="p-0.5">
                    <button
                      type="button"
                      aria-pressed={on}
                      title={h || `${DAYS[d]}曜${p}時限`}
                      onClick={() => onToggle(d, p)}
                      className={`flex h-9 w-full flex-col items-center justify-center rounded-lg border text-[10px] leading-tight transition-colors ${
                        on
                          ? "border-teal-600 bg-teal-50 font-bold text-teal-800"
                          : "border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300"
                      }`}
                    >
                      <span>{on ? "●" : ""}</span>
                      {h ? <span className="max-w-full truncate px-0.5">{h}</span> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PeoplePage() {
  const students = useStored(K_STUDENTS, loadStudents) ?? [];
  const aides = useStored(K_AIDES, loadAides) ?? [];
  const classes = useStored(K_CLASSES, loadClasses) ?? [];
  const [error, setError] = useState<string | null>(null);

  const [sName, setSName] = useState("");
  const [sClassId, setSClassId] = useState("");
  const [sSlots, setSSlots] = useState<ExchangeSlot[]>([]);
  const [editingStudent, setEditingStudent] = useState<string | null>(null);

  const [aName, setAName] = useState("");
  const [aOff, setAOff] = useState<ExchangeSlot[]>([]);
  const [editingAide, setEditingAide] = useState<string | null>(null);

  function persistStudents(next: Student[]) {
    if (!saveStudents(next)) {
      setError("保存に失敗しました");
      return;
    }
    refreshStored(K_STUDENTS, loadStudents);
  }

  function removeStudent(st: Student) {
    if (!window.confirm(`${st.name}を削除しますか？`)) return;
    persistStudents(students.filter((x) => x.id !== st.id));
    const detached = detachStudentFromWeeks(loadWeeks(), st.id);
    if (detached.changed) {
      saveWeeks(detached.weeks);
      refreshStored(K_WEEKS, loadWeeks);
    }
  }

  function removeAide(a: Aide) {
    if (!window.confirm(`${a.name}を削除しますか？`)) return;
    persistAides(aides.filter((x) => x.id !== a.id));
    const detached = detachAideFromWeeks(loadWeeks(), a.id);
    if (detached.changed) {
      saveWeeks(detached.weeks);
      refreshStored(K_WEEKS, loadWeeks);
    }
  }

  function persistAides(next: Aide[]) {
    if (!saveAides(next)) {
      setError("保存に失敗しました");
      return;
    }
    refreshStored(K_AIDES, loadAides);
  }

  function resetStudentForm() {
    setEditingStudent(null);
    setSName("");
    setSClassId("");
    setSSlots([]);
  }

  function editStudent(st: Student) {
    setEditingStudent(st.id);
    setSName(st.name);
    setSClassId(st.exchangeClassId ?? "");
    setSSlots(st.exchangeSlots);
  }

  function saveStudent() {
    if (!sName.trim()) {
      setError("児童名を入力してください");
      return;
    }
    setError(null);
    if (editingStudent) {
      persistStudents(
        students.map((x) =>
          x.id === editingStudent
            ? { ...x, name: sName.trim(), exchangeClassId: sClassId || null, exchangeSlots: sSlots }
            : x,
        ),
      );
    } else {
      persistStudents([
        { id: makeId(), name: sName.trim(), exchangeClassId: sClassId || null, exchangeSlots: sSlots },
        ...students,
      ]);
    }
    resetStudentForm();
  }

  function resetAideForm() {
    setEditingAide(null);
    setAName("");
    setAOff([]);
  }

  function saveAide() {
    if (!aName.trim()) {
      setError("介助員名を入力してください");
      return;
    }
    setError(null);
    if (editingAide) {
      persistAides(aides.map((x) => (x.id === editingAide ? { ...x, name: aName.trim(), offSlots: aOff } : x)));
    } else {
      persistAides([{ id: makeId(), name: aName.trim(), offSlots: aOff }, ...aides]);
    }
    resetAideForm();
  }

  const classById = new Map(classes.map((c) => [c.id, c]));
  const hintFor = (day: number, period: number) => {
    const cls = sClassId ? classById.get(sClassId) : undefined;
    return cls?.timetable[day]?.[period - 1]?.subject ?? "";
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">児童・介助員</h1>
        <p className="mt-1 text-sm text-zinc-500">支援児童の交流先と、介助員の勤務不可コマを登録します。</p>
      </div>
      {error ? <Notice tone="red">{error}</Notice> : null}

      <Card>
        <StepHeading step="児">支援児童</StepHeading>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="児童名">
            <TextInput value={sName} onChange={(e) => setSName(e.target.value)} placeholder="例：山田 太郎" />
          </Field>
          <Field label="交流クラス">
            <Select value={sClassId} onChange={(e) => { setSClassId(e.target.value); setSSlots([]); }}>
              <option value="">交流なし（支援学級のみ）</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.grade}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {sClassId ? (
          <div className="mt-3">
            <p className="mb-1.5 text-sm font-medium text-zinc-700">交流に行くコマ（タップで切替）</p>
            <SlotGrid selected={sSlots} onToggle={(d, p) => setSSlots((prev) => toggleSlot(prev, d, p))} hint={hintFor} />
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Btn onClick={saveStudent}>{editingStudent ? "更新する" : "登録する"}</Btn>
          {editingStudent ? <Btn variant="secondary" onClick={resetStudentForm}>キャンセル</Btn> : null}
        </div>
        <ul className="mt-4 space-y-2">
          {students.map((st) => {
            const cls = st.exchangeClassId ? classById.get(st.exchangeClassId) : undefined;
            return (
              <li key={st.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2">
                <div className="text-sm">
                  <span className="font-bold">{st.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {cls ? `${cls.name}・交流${st.exchangeSlots.length}コマ` : "交流なし"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => editStudent(st)}>編集</Btn>
                  <Btn
                    variant="danger"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => {
                      if (window.confirm(`${st.name}を削除しますか？`)) removeStudent(st);
                    }}
                  >
                    削除
                  </Btn>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <StepHeading step="介">介助員</StepHeading>
        <div className="mt-4">
          <Field label="介助員名">
            <TextInput value={aName} onChange={(e) => setAName(e.target.value)} placeholder="例：佐藤 先生" />
          </Field>
          <div className="mt-3">
            <p className="mb-1.5 text-sm font-medium text-zinc-700">勤務不可コマ（タップで切替）</p>
            <SlotGrid selected={aOff} onToggle={(d, p) => setAOff((prev) => toggleSlot(prev, d, p))} />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Btn onClick={saveAide}>{editingAide ? "更新する" : "登録する"}</Btn>
          {editingAide ? <Btn variant="secondary" onClick={resetAideForm}>キャンセル</Btn> : null}
        </div>
        <ul className="mt-4 space-y-2">
          {aides.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2">
              <div className="text-sm">
                <span className="font-bold">{a.name}</span>
                <span className="ml-2 text-xs text-zinc-500">不可{a.offSlots.length}コマ</span>
              </div>
              <div className="flex gap-2">
                <Btn
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => {
                    setEditingAide(a.id);
                    setAName(a.name);
                    setAOff(a.offSlots);
                  }}
                >
                  編集
                </Btn>
                <Btn
                  variant="danger"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => {
                    if (window.confirm(`${a.name}を削除しますか？`)) removeAide(a);
                  }}
                >
                  削除
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
