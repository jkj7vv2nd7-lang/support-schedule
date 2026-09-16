import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

export function StepHeading({ step, children }: { step: string; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
        {step}
      </span>
      {children}
    </h2>
  );
}

const inputBase =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-zinc-100";

export function TextInput({ inputRef, ...props }: InputHTMLAttributes<HTMLInputElement> & { inputRef?: Ref<HTMLInputElement> }) {
  return <input ref={inputRef} {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputBase} ${props.className ?? ""}`}>
      {props.children}
    </select>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

export function Btn({ variant = "primary", className = "", ...props }: BtnProps) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-500",
    secondary: "border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:border-zinc-400 hover:bg-zinc-50",
    danger: "bg-red-500 text-white hover:bg-red-400",
  } as const;
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}

export function Notice({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "amber" | "red" | "blue" }) {
  const tones = {
    zinc: "border-zinc-200 bg-zinc-100/70 text-zinc-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  };
  // エラーはスクリーンリーダーに即時通知する
  return <div role={tone === "red" ? "alert" : undefined} className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-400">{hint}</span> : null}
    </label>
  );
}
