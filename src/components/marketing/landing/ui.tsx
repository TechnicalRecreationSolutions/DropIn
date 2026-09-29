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

/** A white card floating on a Panel. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-[#e4e4e7] bg-white shadow-[0_1px_2px_rgba(17,17,19,0.05)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Check({ className, color = ACCENT }: { className?: string; color?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", className)}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
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

/* ── Session blocks and the map view ─────────────────────────────────────── */

export type Tone = "blue" | "teal" | "orange" | "green" | "pink" | "reserved";

/** Fill and text colour per session kind. Text on each fill holds 4.5:1 or better. */
export const TONES: Record<Tone, string> = {
  blue: "bg-[#e6f0fa] text-[#004a94]",
  teal: "bg-[#e2f2ef] text-[#0b5a54]",
  orange: "bg-[#fcece2] text-[#9a3412]",
  green: "bg-[#e6f2e9] text-[#14532d]",
  pink: "bg-[#fbe7ef] text-[#9d174d]",
  reserved: "text-[#3f3f45]",
};

/** Diagonal hatching that marks a rental or reserved block. */
export const HATCH: CSSProperties = {
  background: "repeating-linear-gradient(135deg, #e7e7ea 0 8px, #f3f3f4 8px 16px)",
};

export interface MapBlock {
  /** First column, 0-based. */
  col: number;
  /** Columns covered. */
  span: number;
  /** Start and end, in hours on the view's clock (e.g. 18.5 = 6:30 PM). */
  start: number;
  end: number;
  tone: Tone;
  title: string;
  detail?: string;
}

/**
 * A miniature of the widget's Map layout: one column per space, time running
 * down. Positions are percentages, so the drawing scales with its container.
 */
export function MapView({
  title,
  subtitle,
  columns,
  start,
  end,
  ticks,
  blocks,
  bodyHeight = 320,
  header,
  footer,
  className,
}: {
  title: string;
  subtitle?: string;
  columns: string[];
  start: number;
  end: number;
  ticks: string[];
  blocks: MapBlock[];
  bodyHeight?: number;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const n = columns.length;
  const span = end - start;
  return (
    <Card className={cn("flex flex-col gap-4 p-5 sm:p-6", className)}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[17px] font-semibold tracking-[-0.02em] text-[#111113]">{title}</p>
          {subtitle && <p className="text-[13px] text-[#5d5d63]">{subtitle}</p>}
        </div>
        {header}
      </div>
      <div className="flex gap-2.5">
        {/* time axis */}
        <div className="relative w-11 shrink-0 text-[11px] text-[#5d5d63]" style={{ height: bodyHeight + 28 }}>
          {ticks.map((t, i) => (
            <span
              key={t + i}
              className="absolute right-0"
              style={{ top: 28 + (i * bodyHeight) / (ticks.length - 1) - 7 }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div
            className="grid h-[18px] text-center text-xs font-semibold text-[#111113]"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
          >
            {columns.map((c) => (
              <span key={c} className="truncate px-0.5">
                {c}
              </span>
            ))}
          </div>
          <div
            className="relative overflow-hidden rounded-xl border border-[#efeff1] bg-[#fafafa]"
            style={{ height: bodyHeight }}
          >
            <div
              aria-hidden
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            >
              {columns.map((c, i) => (
                <span key={c} className={i < n - 1 ? "border-r border-dashed border-[#e4e4e7]" : ""} />
              ))}
            </div>
            {blocks.map((b, i) => {
              const top = ((b.start - start) / span) * 100;
              const height = ((b.end - b.start) / span) * 100;
              const short = ((b.end - b.start) / span) * bodyHeight < 50;
              return (
                <div
                  key={i}
                  className={cn(
                    "absolute flex overflow-hidden rounded-[10px] px-2.5 py-2",
                    short ? "flex-row items-center gap-2" : "flex-col gap-0.5",
                    TONES[b.tone]
                  )}
                  style={{
                    left: `calc(${(b.col / n) * 100}% + 3px)`,
                    width: `calc(${(b.span / n) * 100}% - 6px)`,
                    top: `calc(${top}% + 3px)`,
                    height: `calc(${height}% - 6px)`,
                    ...(b.tone === "reserved" ? HATCH : {}),
                  }}
                >
                  <b className="truncate text-[13px] leading-[17px] font-semibold">{b.title}</b>
                  {b.detail && <span className="truncate text-[11.5px] leading-[15px]">{b.detail}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {footer}
    </Card>
  );
}

/** Legend swatches used under the map views. */
export function Legend({ items }: { items: { label: string; tone: Tone | "open" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[#efeff1] pt-4 text-xs text-[#5d5d63]">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2">
          <span
            className={cn(
              "size-3.5 rounded",
              it.tone === "open"
                ? "border border-[#e4e4e7] bg-[#fafafa]"
                : it.tone === "reserved"
                  ? ""
                  : TONES[it.tone].split(" ")[0]
            )}
            style={
              it.tone === "reserved"
                ? { background: "repeating-linear-gradient(135deg, #d9d9de 0 3px, #f6f6f7 3px 6px)" }
                : undefined
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
