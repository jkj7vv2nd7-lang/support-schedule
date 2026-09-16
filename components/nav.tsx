"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/classes", label: "交流クラス" },
  { href: "/people", label: "児童・介助員" },
  { href: "/weeks", label: "週予定" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="メインナビ" className="flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-x-auto">
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
              active ? "bg-white/20 text-white" : "text-white/85 hover:bg-white/10 hover:text-white"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
