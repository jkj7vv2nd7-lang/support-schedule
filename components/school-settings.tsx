"use client";

import { useEffect, useState } from "react";
import { Btn, TextInput } from "@/components/ui";
import { loadSettings, saveSettings } from "@/lib/storage";

// 学校名の設定（印刷・PDF・Excel・Wordの表題に表示される）
export default function SchoolSettings() {
  // localStorageはクライアントでのみ読む（SSR時は空文字）
  const [name, setName] = useState(() => loadSettings().schoolName);
  const [message, setMessage] = useState<string | null>(null);

  // バックアップ復元で設定が上書きされたら表示を追随させる
  useEffect(() => {
    const sync = () => {
      setName(loadSettings().schoolName);
      setMessage(null);
    };
    window.addEventListener("support-schedule:settings-changed", sync);
    return () => window.removeEventListener("support-schedule:settings-changed", sync);
  }, []);

  function save() {
    if (!saveSettings({ schoolName: name })) {
      setMessage("保存に失敗しました");
      return;
    }
    setMessage("学校名を保存しました。印刷・出力の表題に表示されます");
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMessage(null);
            }}
            placeholder="例：さくら小学校"
            aria-label="学校名"
            maxLength={60}
          />
        </div>
        <Btn variant="secondary" className="px-3 py-1.5 text-xs" onClick={save}>
          保存する
        </Btn>
      </div>
      {message ? <p className="mt-2 text-xs text-zinc-600">{message}</p> : null}
    </div>
  );
}
