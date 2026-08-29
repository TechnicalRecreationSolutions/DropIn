"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface TickerStat {
  label: string;
  value: string;
}

/** Rotates through a handful of live stats, one at a time — replaces the
 *  overview's old dead-end "Widget views (30d)" tile. Links to the full
 *  analytics dashboard. */
export function AnalyticsTicker({ stats }: { stats: TickerStat[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (stats.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % stats.length), 3500);
    return () => clearInterval(id);
  }, [stats.length]);

  const current = stats[index] ?? { label: "Analytics", value: "—" };

  return (
    <Link href="/dashboard/analytics" className="block rounded-xl transition-opacity hover:opacity-80">
      <Card className="px-5 py-4 gap-2">
        <BarChart3 className="size-6 text-muted-foreground" />
        <p
          key={current.label}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground animate-in fade-in duration-300"
        >
          {current.label}
        </p>
        <p key={current.value + current.label} className="text-2xl font-bold text-foreground tabular-nums animate-in fade-in duration-300">
          {current.value}
        </p>
      </Card>
    </Link>
  );
}
