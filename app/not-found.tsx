import Link from "next/link";
import { Btn, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="py-10 text-center">
      <p className="text-base font-bold">ページが見つかりませんでした</p>
      <p className="mt-2 text-sm text-zinc-500">URLを確認するか、ホームから操作を続けてください。</p>
      <div className="mt-4 flex justify-center">
        <Link href="/">
          <Btn variant="secondary">ホームに戻る</Btn>
        </Link>
      </div>
    </Card>
  );
}
