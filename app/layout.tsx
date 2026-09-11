import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "支援週予定メーカー",
    template: "%s | 支援週予定メーカー",
  },
  description: "特別支援学級の週予定表づくりを時短するアプリです。",
};

const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/classes", label: "交流クラス" },
  { href: "/people", label: "児童・介助員" },
  { href: "/weeks", label: "週予定" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">
        <header className="no-print sticky top-0 z-20 bg-teal-700 text-white">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-teal-700">
                予
              </span>
              <span className="hidden min-w-0 truncate text-sm font-semibold sm:inline">
                支援週予定メーカー
              </span>
            </Link>
            <nav className="flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-x-auto">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6">{children}</main>
        <footer className="no-print border-t border-zinc-200 bg-white py-4 text-center text-xs text-zinc-400">
          支援週予定メーカー — 特別支援学級の週予定づくりを時短
        </footer>
      </body>
    </html>
  );
}
