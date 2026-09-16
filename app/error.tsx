"use client";

import Link from "next/link";
import { Btn, Card } from "@/components/ui";

// 画面単位の異常時は真っ白にせず、復旧導線を出す
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="py-10 text-center">
      <p className="text-base font-bold">画面の表示中にエラーが発生しました</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        データはブラウザに保存されているため、再読み込みで直る場合があります。直らない場合はバックアップ保存のうえ、ブラウザの再読み込み（Ctrl+F5）をお試しください。
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Btn onClick={reset}>再試行する</Btn>
        <Link href="/">
          <Btn variant="secondary">ホームに戻る</Btn>
        </Link>
      </div>
    </Card>
  );
}
