"use client";

import { useRef, useState } from "react";
import { Btn, Card, Field, Notice, StepHeading, TextInput } from "@/components/ui";
import { DAYS, PERIODS, emptyTimetable, type ExchangeClass, type SlotContent } from "@/lib/types";
import { K_CLASSES, loadClasses, makeId, saveClasses } from "@/lib/storage";
import { refreshStored, useStored } from "@/lib/store";

async function downscale(file: File, maxDim = 1600): Promise<File> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      if (scale >= 1 && file.size <= 1024 * 1024) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) return file;
      const name = file.name.replace(/\.[a-zA-Z0-9]+$/, "") || "timetable";
      return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

export default function ClassesPage() {
  const items = useStored(K_CLASSES, loadClasses) ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [table, setTable] = useState<SlotContent[][]>(() => emptyTimetable());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function persist(next: ExchangeClass[]) {
    if (!saveClasses(next)) {
      setError("保存に失敗しました（ブラウザの容量を確認してください）");
      return;
    }
    refreshStored(K_CLASSES, loadClasses);
  }

  function startNew() {
    setEditingId("new");
    setName("");
    setGrade("");
    setTable(emptyTimetable());
    setError(null);
    setMessage(null);
  }

  function startEdit(item: ExchangeClass) {
    setEditingId(item.id);
    setName(item.name);
    setGrade(item.grade);
    setTable(item.timetable.map((row) => row.map((c) => ({ ...c }))));
    setError(null);
    setMessage(null);
  }

  function setCell(day: number, period: number, field: "subject" | "content", value: string) {
    setTable((prev) => prev.map((row, d) => (d === day ? row.map((c, p) => (p === period - 1 ? { ...c, [field]: value } : c)) : row)));
  }

  function save() {
    if (!name.trim()) {
      setError("クラス名を入力してください");
      return;
    }
    const now = Date.now();
    if (editingId === "new") {
      persist([{ id: makeId(), name: name.trim(), grade: grade.trim(), timetable: table, updatedAt: now }, ...items]);
    } else if (editingId) {
      persist(items.map((x) => (x.id === editingId ? { ...x, name: name.trim(), grade: grade.trim(), timetable: table, updatedAt: now } : x)));
    }
    setEditingId(null);
    setMessage("保存しました");
  }

  function remove(id: string) {
    if (!window.confirm("このクラスを削除しますか？")) return;
    persist(items.filter((x) => x.id !== id));
    if (editingId === id) setEditingId(null);
  }

  async function ingest(file: File) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const small = await downscale(file);
      const form = new FormData();
      form.append("image", small, small.name);
      const res = await fetch("/api/timetable", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; timetable?: SlotContent[][]; error?: string };
      if (!json.ok || !json.timetable) throw new Error(json.error || "読み取りに失敗しました");
      setTable(json.timetable);
      setMessage("時間割を読み取りました。内容を確認・修正してください");
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み取りに失敗しました");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">交流クラスの時間割</h1>
          <p className="mt-1 text-sm text-zinc-500">写真で取り込むか、手入力します。登録後は毎週使い回せます。</p>
        </div>
        <Btn variant="secondary" onClick={startNew}>＋ 新しいクラス</Btn>
      </div>

      {items.length === 0 && editingId === null ? (
        <Card className="py-10 text-center text-sm text-zinc-500">
          まだ登録がありません。「新しいクラス」から始めましょう。
        </Card>
      ) : null}

      <div className="grid gap-3">
        {items.map((item) => (
          <Card key={item.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{item.name} <span className="ml-1 font-normal text-zinc-500">{item.grade}</span></p>
              <p className="mt-0.5 text-xs text-zinc-400">
                最終更新 {new Date(item.updatedAt).toLocaleDateString("ja-JP")}
              </p>
            </div>
            <div className="flex gap-2">
              <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => startEdit(item)}>編集</Btn>
              <Btn variant="danger" className="px-3 py-1.5 text-xs" onClick={() => remove(item.id)}>削除</Btn>
            </div>
          </Card>
        ))}
      </div>

      {editingId !== null ? (
        <Card>
          <StepHeading step={editingId === "new" ? "＋" : "✎"}>クラスの時間割</StepHeading>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="クラス名">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例：3年2組" />
            </Field>
            <Field label="学年・備考">
              <TextInput value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="例：3年" />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={() => {
                const f = fileRef.current?.files?.[0];
                if (f) ingest(f);
              }}
            />
            <Btn variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "読込中…" : "時間割の写真から読む"}
            </Btn>
            {busy ? <span className="text-xs text-teal-700">AIが読み取っています…</span> : null}
          </div>
          {error ? <div className="mt-3"><Notice tone="red">{error}</Notice></div> : null}
          {message ? <div className="mt-3"><Notice tone="teal">{message}</Notice></div> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-12 border border-zinc-200 bg-zinc-50 px-1 py-1.5 text-xs">時限</th>
                  {DAYS.map((d) => (
                    <th key={d} className="border border-zinc-200 bg-zinc-50 px-1 py-1.5 text-xs">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((p) => (
                  <tr key={p}>
                    <td className="border border-zinc-200 bg-zinc-50 px-1 py-1 text-center text-xs font-bold">{p}</td>
                    {DAYS.map((_, d) => (
                      <td key={d} className="border border-zinc-200 p-1 align-top">
                        <input
                          value={table[d][p - 1].subject}
                          onChange={(e) => setCell(d, p, "subject", e.target.value)}
                          placeholder="教科"
                          className="w-full rounded border border-transparent px-1 py-0.5 text-xs font-bold focus:border-teal-500 focus:outline-none"
                        />
                        <input
                          value={table[d][p - 1].content}
                          onChange={(e) => setCell(d, p, "content", e.target.value)}
                          placeholder="内容"
                          className="mt-0.5 w-full rounded border border-transparent px-1 py-0.5 text-[11px] text-zinc-500 focus:border-teal-500 focus:outline-none"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={save}>保存する</Btn>
            <Btn variant="secondary" onClick={() => setEditingId(null)}>キャンセル</Btn>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
