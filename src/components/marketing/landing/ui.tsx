import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Shared pieces for the public landing page.
 *
 * The landing page deliberately does not use the dashboard's shadcn tokens: it
 * is a light-only marketing surface with its own palette (near-black ink, one
 * blue accent, soft grey panels), so the values live here as named constants
 * rather than as hex literals scattered through every section.
 */

export const INK = "#111113";
export const MUTED = "#5d5d63";
export const ACCENT = "#0066cc";
export const TEAL = "#0f766e";

export const btnDark =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#111113] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#2a2a2e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc]";

export const btnLine =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#d9d9de] bg-white px-6 text-[15px] font-semibold text-[#111113] transition-colors hover:border-[#111113] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc]";

export const h2Class =
  "text-[34px] leading-[1.1] font-semibold tracking-[-0.035em] text-[#111113] sm:text-[48px] sm:leading-[52px]";

export const leadClass = "text-[17px] leading-[1.65] text-[#5d5d63] sm:text-lg";

/** A handwritten margin note. Decorative: the point it makes is always in the copy too. */
export function Hand({
  children,
  tone = "blue",
  className,
  style,
}: {
  children: ReactNode;
  tone?: "blue" | "teal" | "orange";
  className?: string;
  style?: CSSProperties;
}) {
  const color =
    tone === "blue" ? "text-[#0066cc]" : tone === "teal" ? "text-[#0f766e]" : "text-[#9a3412]";
  return (
    <span
      aria-hidden
      style={style}
      className={cn("font-hand text-2xl leading-none font-semibold", color, className)}
    >
      {children}
    </span>
  );
}

/** The soft grey rounded panel every product picture sits on. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative rounded-[32px] bg-[#f4f4f5]", className)}>{children}</div>;
}

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
