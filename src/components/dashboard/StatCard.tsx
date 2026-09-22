import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  /** One short line under the value — what the number means, or what to do. */
  hint?: string;
  /** A sparkline, meter or similar. Sits to the right of the number. */
  visual?: React.ReactNode;
  /** Makes the whole tile a link. A tile that leads nowhere is a dead end. */
  href?: string;
  className?: string;
}

/**
 * One tile in the Overview's stat row.
 *
 * Half the height of the tile it replaces, and the icon has moved onto the
 * label's line rather than occupying a row of its own — the first fold belongs
 * to today's schedule, and a tile spending 120px on one integer was taking it.
 *
 * `value` is tabular-nums so a number that ticks does not shuffle the layout
 * beside it.
 */
export function StatTile({ icon: Icon, label, value, hint, visual, href, className }: StatTileProps) {
  const body = (
    <Card
      className={cn(
        "h-full gap-1 px-4 py-3",
        href && "transition-colors hover:bg-muted/50",
        className
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-2xl font-bold leading-none text-foreground tabular-nums">{value}</p>
        {visual && <div className="min-w-0 flex-1">{visual}</div>}
      </div>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  );
}
