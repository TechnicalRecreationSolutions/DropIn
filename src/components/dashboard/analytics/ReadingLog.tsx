"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { METRICS, formatReading } from "@/lib/conditions/readings";
import type { ReadingMetric } from "@/types/app.types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Every head count and temperature in the period, newest first — the history
 * that used to be "Recent entries" under People here on the status page
 * (moved 2026-10-01, the user's call: the status page is for now, history is
 * analysis).
 *
 * Delete came with it. It is for the typo that would otherwise sit in every
 * average on this page — 400 instead of 40 — and follows the 061 delete
 * policy: your own entries, or anyone's for an owner or manager. The server
 * still decides; this only hides the button that would be refused.
 */

export interface ReadingLogRow {
  id: string;
  facilityId: string;
  metric: ReadingMetric;
  value: number;
  recordedAt: string;
  recordedBy: string | null;
  /** Display name from org_memberships, resolved on the server. */
  recordedByName: string;
  facility: string;
  space: string;
  session: string | null;
}

const PAGE = 25;

export default function ReadingLog({
  rows,
  viewerId,
  canManage,
  canWrite,
  showFacility,
}: {
  rows: ReadingLogRow[];
  viewerId: string;
  /** May delete other people's entries (owner/manager). */
  canManage: boolean;
  /** Holds `reading:write` at all. */
  canWrite: boolean;
  /** More than one facility in view, so each row names its own. */
  showFacility: boolean;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Times in the browser only — the server's locale and zone are not the
  // reader's, and a mismatch is a hydration error. Same idiom as HeadCountTool.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  async function remove(row: ReadingLogRow) {
    setBusy(row.id);
    setError(null);
    const res = await fetch(`/api/facilities/${row.facilityId}/readings/${row.id}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete that.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && <Banner variant="error">{error}</Banner>}
      <Card className="gap-0 overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {rows.slice(0, shown).map((r) => {
            const mine = r.recordedBy === viewerId;
            return (
              <li key={r.id} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
                <span className="w-16 shrink-0 font-semibold tabular-nums">
                  {formatReading(r.metric, r.value)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-foreground">
                    {[
                      r.metric === "headcount" ? null : METRICS[r.metric].label,
                      showFacility ? r.facility : null,
                      r.space,
                      r.session,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {hydrated
                      ? new Date(r.recordedAt).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "…"}
                    {" · "}
                    {mine ? "you" : r.recordedByName}
                  </span>
                </span>
                {canWrite && (mine || canManage) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(r)}
                    disabled={busy === r.id}
                    aria-label="Delete this entry"
                    title="For a typo. A count that was right at the time should stay."
                    className="-mr-2 size-11 shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
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

/** For `useSyncExternalStore`: a store that never changes, read only to tell server from client. */
function subscribeNever() {
  return () => {};
}
