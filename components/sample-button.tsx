"use client";

import { useState } from "react";
import { Btn } from "@/components/ui";
import { buildSampleData } from "@/lib/sample";
import {
  K_AIDES,
  K_CLASSES,
  K_STUDENTS,
  K_WEEKS,
  loadAides,
  loadClasses,
  loadStudents,
  loadWeeks,
  saveAides,
  saveClasses,
  saveStudents,
  saveWeeks,
} from "@/lib/storage";
import { refreshStored } from "@/lib/store";

// サンプルデータの読み込み（空の状態でのみ実行し、既存データを守る）
export default function SampleButton() {
  const [message, setMessage] = useState<string | null>(null);

  function seed() {
    setMessage(null);
    const existing = loadClasses().length + loadStudents().length + loadAides().length + loadWeeks().length;
    if (existing > 0) {
      setMessage("すでにデータがあるため追加できません。試す場合はバックアップ保存後にデータを削除してください");
      return;
    }
    if (!window.confirm("サンプルデータ（交流クラス2・児童3名・介助員2名・今週1週分）を読み込みますか？")) return;
    const s = buildSampleData();
    const ok = saveClasses(s.classes) && saveStudents(s.students) && saveAides(s.aides) && saveWeeks(s.weeks);
    if (!ok) {
      setMessage("保存に失敗しました（ブラウザの容量を確認してください）");
      return;
    }
    refreshStored(K_CLASSES, loadClasses);
    refreshStored(K_STUDENTS, loadStudents);
    refreshStored(K_AIDES, loadAides);
    refreshStored(K_WEEKS, loadWeeks);
    setMessage("サンプルを読み込みました。「週予定」から印刷・出力をお試しください");
  }

  return (
    <div className="mt-3">
      <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={seed}>
        サンプルデータで試す
      </Btn>
      {message ? <p className="mt-2 text-xs text-zinc-600">{message}</p> : null}
    </div>
  );
}
