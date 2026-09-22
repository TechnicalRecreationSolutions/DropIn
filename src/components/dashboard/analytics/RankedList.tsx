import Link from "next/link";

export interface RankedItem {
  id: string;
  label: string;
  count: number;
  /** Optional link to the thing itself, so a name on this list is a way in. */
  href?: string;
}

interface RankedListProps {
  items: RankedItem[];
  /** Denominator for the share text — total views or total clicks. */
  total: number;
  emptyMessage: string;
  /** What one unit is, for the share label, e.g. "of views". */
  unitLabel: string;
}

/**
 * A ranked leaderboard with the magnitude drawn behind the name.
 *
 * The bar is a background fill on the row rather than a separate column: at
 * this width a name, a count, a share and a bar side by side leaves the bar
 * too short to read, and the row tint carries the same comparison for free.
 */
export function RankedList({ items, total, emptyMessage, unitLabel }: RankedListProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground/70 text-center py-6 px-5">{emptyMessage}</p>;
  }

  const peak = Math.max(...items.map((i) => i.count), 1);

  return (
    <ol className="divide-y divide-border">
      {items.map((item, index) => {
        const share = total > 0 ? Math.round((item.count / total) * 100) : 0;
        const content = (
          <>
            <span
              className="absolute inset-y-0 left-0 bg-accent/10"
              style={{ width: `${(item.count / peak) * 100}%` }}
              aria-hidden
            />
            <span className="relative flex w-full items-center gap-3">
              <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="flex-1 truncate text-foreground">{item.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {share}% {unitLabel}
              </span>
              <span className="w-10 shrink-0 text-right font-medium text-foreground tabular-nums">{item.count}</span>
            </span>
          </>
        );

        return (
          <li key={item.id} className="relative">
            {item.href ? (
              <Link href={item.href} className="relative flex px-5 py-3 text-sm hover:bg-muted/50 transition-colors">
                {content}
              </Link>
            ) : (
              <div className="relative flex px-5 py-3 text-sm">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
