"use client";

import { useState, useSyncExternalStore } from "react";
import type { NoticeSeverity } from "@/types/app.types";
import { SeverityDot } from "@/components/status/SeverityDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The list half of Analytics › Status history. A client component only so the
 * dates render in the reader's locale and zone (server and phone disagree,
 * and a mismatch is a hydration error), and so a long period can page.
 */

export interface NoticeHistoryRow {
  id: string;
  headline: string;
  severity: NoticeSeverity;
  category: string;
  facility: string;
  where: string;
  startsAt: string;
  endsAt: string | null;
  minutes: number;
  /** Decided on the server at render time, so the list itself stays pure. */
  state: "scheduled" | "up" | "ended";
}

const PAGE = 25;

export default function NoticeHistoryList({
  rows,
  showFacility,
}: {
  rows: NoticeHistoryRow[];
  showFacility: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  const when = (iso: string) =>
    hydrated
      ? new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "…";

  return (
    <div className="space-y-2">
      <Card className="gap-0 overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {rows.slice(0, shown).map((n) => {
            return (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-1.5">
                  <SeverityDot severity={n.severity} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{n.headline}</p>
                  <p className="text-xs text-muted-foreground">
                    {[showFacility ? n.facility : null, n.where, n.category].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {when(n.startsAt)}
                    {n.endsAt && n.state === "ended" ? ` – ${when(n.endsAt)} · ${formatDuration(n.minutes)}` : ""}
                  </p>
                </div>
                {n.state === "scheduled" ? (
                  <Badge variant="outline" className="shrink-0">Scheduled</Badge>
                ) : n.state === "up" ? (
                  <Badge variant="outline" className="shrink-0">Up now</Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      {rows.length > shown && (
        <Button type="button" variant="outline" onClick={() => setShown((n) => n + PAGE * 2)}>
          Show more ({rows.length - shown} left)
        </Button>
      )}
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} days`;
}

/** For `useSyncExternalStore`: a store that never changes, read only to tell server from client. */
function subscribeNever() {
  return () => {};
}
