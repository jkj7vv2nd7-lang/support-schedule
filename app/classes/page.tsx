"use client";

import { useEffect, useRef, useState } from "react";
import { Btn, Card, Field, Notice, StepHeading, TextInput } from "@/components/ui";
import { DAYS, PERIODS, emptyTimetable, type ExchangeClass, type SlotContent } from "@/lib/types";
import { K_CLASSES, K_STUDENTS, loadClasses, loadStudents, makeId, normalizeTimetable, saveClasses, saveStudents, validateDismissal } from "@/lib/storage";
import { detachClassFromStudents } from "@/lib/schedule";
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
      // 透過PNGはJPEG化で黒背景になるため白で下塗りする
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  const itemsRaw = useStored(K_CLASSES, loadClasses);
  // SSR直後はundefinedのため「まだ登録がありません」と誤表示しない
  const items = itemsRaw ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [morning, setMorning] = useState<string[]>(["", "", "", "", ""]);
  const [dismissal, setDismissal] = useState<string[]>(["", "", "", "", ""]);
  const [notice, setNotice] = useState("");
  const [table, setTable] = useState<SlotContent[][]>(() => emptyTimetable());
  const [busy, setBusy] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI取り込みの利用可否（GEMINI_API_KEY設定状態）を死活確認APIで取得
  useEffect(() => {
    let alive = true;
    fetch("/api/timetable")
      .then((r) => r.json() as Promise<{ configured?: boolean }>)
      .then((j) => {
        if (alive) setAiReady(j.configured === true);
      })
      .catch(() => {
        if (alive) setAiReady(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 保存完了メッセージは編集カードの外（一覧側）でも見えるよう、数秒で自動的に消す
  useEffect(() => {
    if (!savedNotice) return;
    const t = setTimeout(() => setSavedNotice(null), 3000);
    return () => clearTimeout(t);
  }, [savedNotice]);

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
    setMorning(["", "", "", "", ""]);
    setDismissal(["", "", "", "", ""]);
    setNotice("");
    setTable(emptyTimetable());
    setError(null);
    setMessage(null);
  }

  function startEdit(item: ExchangeClass) {
    setEditingId(item.id);
    setName(item.name);
    setGrade(item.grade);
    setMorning(
      Array.from({ length: 5 }, (_, i) => (Array.isArray(item.morning) ? item.morning[i] ?? "" : "")),
    );
    setDismissal(
      Array.from({ length: 5 }, (_, i) => (Array.isArray(item.dismissal) ? item.dismissal[i] ?? "" : "")),
    );
    setNotice(typeof item.notice === "string" ? item.notice : "");
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
    const morningClean = morning.map((m) => m.trim());
    const dismissalClean = dismissal.map((m) => m.trim());
    const dismissalErrors = validateDismissal(dismissalClean);
    if (dismissalErrors.length > 0) {
      setError(dismissalErrors[0]);
      return;
    }
    const noticeClean = notice.trim() || undefined;
    if (editingId === "new") {
      persist([{ id: makeId(), name: name.trim(), grade: grade.trim(), timetable: table, morning: morningClean, dismissal: dismissalClean, notice: noticeClean, updatedAt: now }, ...items]);
    } else if (editingId) {
      persist(items.map((x) => (x.id === editingId ? { ...x, name: name.trim(), grade: grade.trim(), timetable: table, morning: morningClean, dismissal: dismissalClean, notice: noticeClean, updatedAt: now } : x)));
    }
    setEditingId(null);
    setSavedNotice(editingId === "new" ? "登録しました" : "更新しました");
  }

  function remove(id: string) {
    if (!window.confirm("このクラスを削除しますか？")) return;
    persist(items.filter((x) => x.id !== id));
    // 参照する児童の交流設定をクリア
    const detached = detachClassFromStudents(loadStudents(), id);
    if (detached.changed) {
      saveStudents(detached.students);
      refreshStored(K_STUDENTS, loadStudents);
    }
    if (editingId === id) setEditingId(null);
    setSavedNotice("削除しました");
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
      const json = (await res.json()) as { ok: boolean; timetable?: SlotContent[][]; empty?: boolean; error?: string };
      if (!json.ok || !json.timetable) throw new Error(json.error || "読み取りに失敗しました");
      // 不正形状（5x6でない等）は正規化して描画クラッシュ・保存後消失を防ぐ
      setTable(normalizeTimetable(json.timetable));
      setMessage(
        json.empty
          ? "読み取り結果が空でした。写真を明るく・正面から撮り直すか、手入力してください"
          : "時間割を読み取りました。内容を確認・修正してください",
      );
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

      {savedNotice ? <Notice tone="blue">{savedNotice}</Notice> : null}

      {itemsRaw === undefined ? (
        <Card className="py-10 text-center text-sm text-zinc-500">読み込み中…</Card>
      ) : items.length === 0 && editingId === null ? (
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
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-zinc-700">朝活動（曜日別・任意）</span>
              <div className="grid grid-cols-5 gap-1">
                {DAYS.map((d, i) => (
                  <input
                    key={d}
                    value={morning[i] ?? ""}
                    onChange={(e) => setMorning((prev) => prev.map((m, j) => (j === i ? e.target.value : m)))}
                    placeholder={d}
                    aria-label={`朝活動（${d}曜）`}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-1 py-2 text-center text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                ))}
              </div>
            </div>
            <Field label="連絡等（任意）">
              <TextInput value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="例：水曜は掃除なし" />
            </Field>
          </div>
          <div className="mt-4">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">下校時刻（曜日別・任意）</span>
            <div className="grid grid-cols-5 gap-1">
              {DAYS.map((d, i) => (
                <input
                  key={d}
                  value={dismissal[i] ?? ""}
                  onChange={(e) => setDismissal((prev) => prev.map((m, j) => (j === i ? e.target.value : m)))}
                  placeholder="例：14:20"
                  aria-label={`下校時刻（${d}曜）`}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-1 py-2 text-center text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              ))}
            </div>
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
            {busy ? <span className="text-xs text-blue-700">AIが読み取っています…</span> : null}
            {aiReady === true ? (
              <span className="text-xs text-zinc-500">AI取り込み利用可</span>
            ) : aiReady === false ? (
              <span className="text-xs text-amber-700">
                AI取り込み未設定（GEMINI_API_KEY未設定）。Vercel本番は Environment Variables、手入力でも登録できます
              </span>
            ) : null}
          </div>
          {error ? <div className="mt-3"><Notice tone="red">{error}</Notice></div> : null}
          {message ? <div className="mt-3"><Notice tone="blue">{message}</Notice></div> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="w-12 border border-zinc-200 bg-zinc-50 px-1 py-1.5 text-xs">時限</th>
                  {DAYS.map((d) => (
                    <th scope="col" key={d} className="border border-zinc-200 bg-zinc-50 px-1 py-1.5 text-xs">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((p) => (
                  <tr key={p}>
                    <th scope="row" className="border border-zinc-200 bg-zinc-50 px-1 py-1 text-center text-xs font-bold">{p}</th>
                    {DAYS.map((_, d) => (
                      <td key={d} className="border border-zinc-200 p-1 align-top">
                        <input
                          value={table[d][p - 1].subject}
                          onChange={(e) => setCell(d, p, "subject", e.target.value)}
                          placeholder="教科"
                          aria-label={`${DAYS[d]}曜${p}時限の教科`}
                          className="w-full rounded border border-transparent px-1 py-0.5 text-xs font-bold focus:border-blue-500 focus:outline-none"
                        />
                        <input
                          value={table[d][p - 1].content}
                          onChange={(e) => setCell(d, p, "content", e.target.value)}
                          placeholder="内容"
                          aria-label={`${DAYS[d]}曜${p}時限の内容`}
                          className="mt-0.5 w-full rounded border border-transparent px-1 py-0.5 text-[11px] text-zinc-500 focus:border-blue-500 focus:outline-none"
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
