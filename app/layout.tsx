import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Nav from "@/components/nav";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#1e40af",
};

export const metadata: Metadata = {
  title: {
    default: "支援週予定メーカー",
    template: "%s | 支援週予定メーカー",
  },
  description: "特別支援学級の週予定表づくりを時短するアプリです。交流時間割の取り込み・介助員配置・印刷・PDF/Excel/Word出力に対応。",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "支援週予定メーカー",
    description: "特別支援学級の週予定表づくりを時短するアプリです。",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "支援週予定メーカー",
    description: "特別支援学級の週予定表づくりを時短するアプリです。",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[#f4f6f4] text-zinc-900">
        <header className="no-print sticky top-0 z-20 bg-gradient-to-r from-blue-800 via-blue-700 to-indigo-600 text-white shadow-md">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-blue-700 shadow">
                予
              </span>
              <span className="hidden min-w-0 truncate text-sm font-semibold tracking-wide sm:inline">
                支援週予定メーカー
              </span>
            </Link>
            <Nav />
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
