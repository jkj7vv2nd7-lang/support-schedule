"use client";

import { useRef, useState } from "react";
import { Btn } from "@/components/ui";
import { K_AIDES, K_CLASSES, K_STUDENTS, K_WEEKS, exportBackup, importBackup, loadAides, loadClasses, loadStudents, loadWeeks } from "@/lib/storage";
import { refreshStored } from "@/lib/store";

// データの受け渡し（複数教員での共用・機種変更用）: 全データをJSONで保存・復元する
export default function BackupButtons() {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function download() {
    setIsError(false);
    setMessage(null);
    try {
      const data = exportBackup();
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `support-schedule-backup-${data.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      const n = data.classes.length + data.students.length + data.aides.length + data.weeks.length;
      setMessage(`バックアップを保存しました（${n}件）`);
    } catch {
      setIsError(true);
      setMessage("バックアップの保存に失敗しました");
    }
  }

  async function onFile(file: File | undefined) {
    setIsError(false);
    setMessage(null);
    if (!file) return;
    if (!window.confirm("現在のデータを上書きして復元しますか？")) return;
    try {
      const text = await file.text();
      const result = importBackup(JSON.parse(text) as unknown);
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error ?? "復元に失敗しました");
        return;
      }
      const c = result.counts ?? { classes: 0, students: 0, aides: 0, weeks: 0 };
      // 復元後は各画面のキャッシュを更新し、全画面に反映させる
      refreshStored(K_CLASSES, loadClasses);
      refreshStored(K_STUDENTS, loadStudents);
      refreshStored(K_AIDES, loadAides);
      refreshStored(K_WEEKS, loadWeeks);
      // 学校名設定の表示（ホーム）にも復元を反映させる
      window.dispatchEvent(new CustomEvent("support-schedule:settings-changed"));
      setMessage(
        `復元しました（クラス${c.classes}・児童${c.students}・介助員${c.aides}・週${c.weeks}）。現在の入力は上書きされました`,
      );
    } catch {
      setIsError(true);
      setMessage("ファイルの読み込みに失敗しました");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={download}>
          バックアップ保存
        </Btn>
        <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
          バックアップ復元
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {message ? (
        <p className={`mt-2 text-xs ${isError ? "font-bold text-red-600" : "text-zinc-600"}`}>{message}</p>
      ) : null}
    </div>
  );
}
