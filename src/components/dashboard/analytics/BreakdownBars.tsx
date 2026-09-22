import type { CountedLabel } from "@/lib/analytics/queries";

/**
 * A labelled horizontal bar per row — the page's workhorse breakdown.
 *
 * One component for templates, devices, surfaces, traffic sources and visit
 * lengths, because they are the same chart with different color jobs, and
 * five near-identical files would drift apart within a month.
 *
 * Every row carries its label and its count as text. That is not decoration:
 * three of the light-mode categorical slots sit below 3:1 against the card,
 * and the validator's rule for that is relief through visible labels. It also
 * means the breakdown still reads in greyscale, and for anyone who cannot
 * separate the hues.
 */

/** Fixed categorical order — a key's color never changes as counts move. */
const CATEGORICAL = ["var(--viz-cat-1)", "var(--viz-cat-2)", "var(--viz-cat-3)", "var(--viz-cat-4)", "var(--viz-cat-5)"];

const ORDINAL = [
  "var(--viz-ord-1)",
  "var(--viz-ord-2)",
  "var(--viz-ord-3)",
  "var(--viz-ord-4)",
  "var(--viz-ord-5)",
  "var(--viz-ord-6)",
];

export type BreakdownVariant = "categorical" | "single" | "ordinal";

interface BreakdownBarsProps {
  data: CountedLabel[];
  /**
   * How color earns its place here:
   *   categorical — the rows are different *things* (grid vs. map vs. list)
   *   single      — the rows are one thing at different magnitudes (referrers)
   *   ordinal     — the rows are an ordered scale (visit length buckets)
   */
  variant?: BreakdownVariant;
  /**
   * The fixed key order for `categorical`. Pass every key the breakdown can
   * ever contain, in order, so slot 3 belongs to "Map" whether or not anyone
   * opened the map this month.
   */
  keyOrder?: string[];
  emptyMessage?: string;
}

export function BreakdownBars({
  data,
  variant = "single",
  keyOrder,
  emptyMessage = "Nothing recorded yet.",
}: BreakdownBarsProps) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground/70 py-6 text-center">{emptyMessage}</p>;
  }

  // Bars are scaled against the largest row, not against the total: a
  // breakdown where the leader holds 12% would otherwise be a column of
  // slivers with no readable shape.
  const peak = Math.max(...data.map((d) => d.count), 1);

  function colorFor(row: CountedLabel, index: number): string {
    if (variant === "single") return "var(--viz-cat-1)";
    if (variant === "ordinal") return ORDINAL[Math.min(index, ORDINAL.length - 1)];
    const slot = keyOrder ? keyOrder.indexOf(row.key) : index;
    return CATEGORICAL[(slot >= 0 ? slot : index) % CATEGORICAL.length];
  }

  return (
    <ul className="space-y-2.5">
      {data.map((row, index) => (
        <li key={row.key} className="flex items-center gap-3 text-sm">
          {/* Widens once there is room: "Direct / no referrer" and "Embedded
              widget" are the two longest labels here and both lose their
              distinguishing half at 6rem. */}
          <span className="w-24 sm:w-36 shrink-0 truncate text-muted-foreground" title={row.label}>
            {row.label}
          </span>
          <span className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max((row.count / peak) * 100, row.count > 0 ? 2 : 0)}%`, backgroundColor: colorFor(row, index) }}
            />
          </span>
          <span className="w-9 shrink-0 text-right font-medium text-foreground tabular-nums">{row.count}</span>
          <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {Math.round(row.share * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
