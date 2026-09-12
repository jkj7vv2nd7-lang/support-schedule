import Link from "next/link";
import { Card } from "@/components/ui";

const STEPS = [
  {
    href: "/classes",
    no: "1",
    title: "交流クラスの時間割を登録",
    description: "紙の時間割を写真で取り込むか、手入力します。一度登録すれば毎週使い回せます。",
  },
  {
    href: "/people",
    no: "2",
    title: "児童・介助員を登録",
    description: "支援児童の交流先・交流コマと、介助員の勤務不可コマを登録します。",
  },
  {
    href: "/weeks",
    no: "3",
    title: "週予定を作成・印刷",
    description: "交流内容を自動引用し、介助員を自動提案。児童別シートと全体一覧を印刷・配布できます。",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-600 p-8 text-white shadow-lg sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-300/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-teal-200/20 blur-3xl" />
        <h1 className="relative text-2xl font-bold leading-snug sm:text-3xl">
          特別支援学級の週予定づくりを時短
        </h1>
        <p className="relative mt-3 max-w-2xl text-sm leading-relaxed text-teal-50/90 sm:text-base">
          交流クラスの時間割をもとに、支援児童ごとの週予定表をすばやく作成・印刷できます。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <p className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
                {s.no}
              </p>
              <h2 className="mt-2 text-base font-bold">{s.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">{s.description}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <h2 className="text-sm font-bold">先週コピーでさらに時短</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600">
          週の大半は変わりません。「先週コピー」で複写し、変更点だけ直す運用ができます。
          データはこのブラウザに保存されます。
        </p>
      </Card>
    </div>
  );
}
