"use client";

import { useState } from "react";
import { Btn } from "@/components/ui";
import type { WeekExportLayouts } from "@/lib/export";
import type { Aide, ExchangeClass, Student, WeekPlan } from "@/lib/types";

export default function ExportButtons({
  week,
  students,
  aides,
  classes,
  layouts,
  layoutsOn,
  onError,
  onSuccess,
}: {
  week: WeekPlan;
  students: Student[];
  aides: Aide[];
  classes: ExchangeClass[];
  layouts: WeekExportLayouts;
  layoutsOn: boolean;
  onError: (msg: string | null) => void;
  onSuccess?: (format: "pdf" | "xlsx" | "docx") => void;
}) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | "docx" | null>(null);

  async function download(format: "pdf" | "xlsx" | "docx") {
    onError(null);
    setBusy(format);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, data: { week, students, aides, classes }, layouts }),
      });
      if (!res.ok) {
        const json: { error?: string } | null = await res.json().catch(() => null);
        throw new Error(json?.error ?? "エクスポートに失敗しました");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `週予定表${week.weekStart}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      onSuccess?.(format);
    } catch (err) {
      onError(err instanceof Error ? err.message : "エクスポートに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Btn variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy !== null || !layoutsOn} onClick={() => download("pdf")}>
        {busy === "pdf" ? "作成中…" : "PDFで保存"}
      </Btn>
      <Btn variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy !== null || !layoutsOn} onClick={() => download("xlsx")}>
        {busy === "xlsx" ? "作成中…" : "Excelで保存"}
      </Btn>
      <Btn variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy !== null || !layoutsOn} onClick={() => download("docx")}>
        {busy === "docx" ? "作成中…" : "Wordで保存"}
      </Btn>
    </>
  );
}
