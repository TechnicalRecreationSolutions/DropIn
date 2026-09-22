import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils/cn";

export interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  /**
   * What this number counts and what it cannot count, behind the (i).
   *
   * Required, not optional. Every number on this page is a proxy for
   * something — "views" is page loads, not people; "visitors" is hashed IPs
   * within one day — and a proxy presented without its definition is how a
   * dashboard ends up quoted in a budget request meaning something it never
   * measured.
   */
  info: React.ReactNode;
  /** A second line under the value, e.g. "of 1,204 views". */
  detail?: string;
  /** Change against the previous period, as a ratio (0.12 = +12%). */
  change?: number | null;
  /**
   * Which direction is good news. "down" for quick-exit rate, where a fall is
   * an improvement; "neutral" when the metric has no better direction and the
   * arrow should stay uncoloured.
   */
  goodDirection?: "up" | "down" | "neutral";
}

function formatChange(change: number): string {
  const pct = Math.abs(change) * 100;
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return (change > 0 ? "+" : change < 0 ? "−" : "") + rounded + "%";
}

/**
 * One tile in the analytics stat grid: a number, what it means, and whether
 * it is moving.
 *
 * Distinct from the overview's `StatCard`, which is a bare label and value.
 * These carry a definition and a comparison, and a tile that showed a delta
 * without saying what it was measured against would be worse than no delta.
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  info,
  detail,
  change,
  goodDirection = "up",
}: MetricCardProps) {
  const hasChange = change !== null && change !== undefined && Number.isFinite(change);
  const flat = hasChange && Math.abs(change) < 0.005;
  const good = hasChange && !flat && goodDirection !== "neutral" && change > 0 === (goodDirection === "up");
  const ChangeIcon = !hasChange || flat ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="px-4 py-3.5 gap-1.5">
      <div className="flex items-start gap-1.5">
        <Icon className="size-4 shrink-0 text-muted-foreground mt-px" aria-hidden />
        {/* Wraps rather than truncates. Five of these labels are two words or
            more, and at a fifth of the row's width every one of them came
            back as "REGISTRATION…" — a tile whose name is cut off is a tile
            nobody can act on. */}
        <p className="flex-1 text-xs font-semibold uppercase tracking-wide leading-4 text-muted-foreground">
          {label}
        </p>
        <InfoTip label={label + " — what this counts"} className="mt-px">
          {info}
        </InfoTip>
      </div>

      <p className="text-2xl font-bold text-foreground tabular-nums leading-tight">{value}</p>

      {hasChange && (
        <p
          className={cn(
            "flex items-center gap-1 text-xs font-medium tabular-nums",
            flat || goodDirection === "neutral"
              ? "text-muted-foreground"
              : good
                ? "text-green-700 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
          )}
        >
          {/* The arrow is never the only signal — the sign is spelled out
              beside it, so the tile still reads without color. */}
          <ChangeIcon className="size-3.5 shrink-0" aria-hidden />
          {flat ? "No change" : formatChange(change)}
          <span className="text-muted-foreground font-normal">vs. previous</span>
        </p>
      )}

      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </Card>
  );
}
