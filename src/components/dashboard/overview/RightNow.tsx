import Link from "next/link";
import { Thermometer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { NoticeSeverity } from "@/types/app.types";
import LocalTime from "./LocalTime";

export interface RightNowNotice {
  id: string;
  severity: NoticeSeverity;
  headline: string;
  where: string | null;
}

export interface RightNowReading {
  /** Space name, or null for the whole building. */
  where: string | null;
  headcount: number | null;
  waterTempC: number | null;
  airTempC: number | null;
  /** ISO instant of the newest reading in this row. */
  at: string;
}

const SEVERITY: Record<NoticeSeverity, { label: string; variant: "destructive" | "warning" | "brand" }> = {
  closure: { label: "Closed", variant: "destructive" },
  caution: { label: "Caution", variant: "warning" },
  info: { label: "Notice", variant: "brand" },
};

/**
 * "Right now": what a patron would see if they looked, and the two questions
 * the front desk is asked on the phone all day (how busy, how warm) — from
 * live notices (060) and today's readings (061). Nothing here is a count of
 * records; every line is a fact about the building at a time.
 */
export default function RightNow({
  now,
  notices,
  readings,
  statusHref,
  headingId = "right-now-heading",
}: {
  /** ISO instant the page was rendered. */
  now: string;
  notices: RightNowNotice[];
  readings: RightNowReading[];
  statusHref: string;
  /** The page renders this twice (phone and rail); each needs its own id. */
  headingId?: string;
}) {
  const empty = notices.length === 0 && readings.length === 0;
  return (
    <section aria-labelledby={headingId} className="rounded-card border border-border bg-card shadow-card">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-1">
        <h2 id={headingId} className="text-card-title text-foreground">
          Right now
        </h2>
        <span className="text-caption text-muted-foreground tabular-nums"><LocalTime iso={now} /></span>
      </div>
      <ul>
        {notices.map((n) => (
          <li key={n.id} className="flex items-start gap-2.5 border-t border-border px-4 py-3 first:border-t-0">
            <Badge variant={SEVERITY[n.severity].variant} className="shrink-0">
              {SEVERITY[n.severity].label}
            </Badge>
            <div className="min-w-0">
              <p className="text-body font-semibold text-foreground">{n.headline}</p>
              {n.where && <p className="text-caption text-muted-foreground">{n.where} · patrons can see this</p>}
            </div>
          </li>
        ))}
        {readings.map((r) => {
          const parts = [
            r.headcount !== null ? `${r.headcount} ${r.headcount === 1 ? "person" : "people"}` : null,
            r.waterTempC !== null ? `water ${r.waterTempC.toFixed(1)} °C` : null,
            r.airTempC !== null ? `air ${r.airTempC.toFixed(1)} °C` : null,
          ].filter(Boolean);
          return (
            <li key={r.where ?? "building"} className="border-t border-border px-4 py-3 first:border-t-0">
              <p className="text-body font-semibold text-foreground">{r.where ?? "Whole building"}</p>
              <p className="text-caption text-muted-foreground tabular-nums">
                {parts.join(" · ")} · logged <LocalTime iso={r.at} />
              </p>
            </li>
          );
        })}
        {empty && (
          <li className="px-4 py-3 text-caption text-muted-foreground">
            No notices are up, and nobody has logged a count or temperature today.
          </li>
        )}
      </ul>
      <div className="px-2 pb-2">
        <Link
          href={statusHref}
          className="flex h-11 items-center gap-2.5 rounded-control px-3 text-body font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Thermometer aria-hidden className="size-4 text-muted-foreground" />
          Log a count or temperature
        </Link>
      </div>
    </section>
  );
}
