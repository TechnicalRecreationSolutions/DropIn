"use client";

import { useEffect, useState } from "react";
import { Droplet, Thermometer, Users } from "lucide-react";
import {
  LEVEL_LABEL,
  METRICS,
  formatReading,
  formatRecordedAt,
  isFresh,
} from "@/lib/conditions/readings";
import type { ConditionReading, ConditionsResponse } from "@/lib/conditions/types";

/**
 * "27.5 °C in the water, about 40 people, as of 2:15 PM."
 *
 * The live half of facility status. Its sibling — notices — is server-rendered
 * because a closure has to be in the HTML; this is a client component because
 * a head count in a server cache is a stale number wearing a fresh timestamp.
 * See the route it reads for the full argument.
 *
 * ## A number always carries its age, and a stale one changes its claim
 *
 * Fresh: **"About 40 people · 2:15 PM"**. Stale, with history behind it:
 * **"Usually about 35 at this time"** — a different sentence about a different
 * thing, because "40 people (four hours ago)" is read as "40 people". Stale
 * with no history: the metric is dropped rather than hedged.
 *
 * ## Nothing renders when there is nothing to say
 *
 * No block, no heading, no "conditions unavailable". A facility that does not
 * publish these, or has not recorded anything today, looks exactly as it did
 * before this feature existed — and a failed fetch does too, because a visitor
 * cannot act on our fetch failing and the schedule below is the thing they
 * came for.
 *
 * ## ⚠️ It fetches for itself, and must keep doing so
 *
 * No TanStack Query here, although both host surfaces use it elsewhere. The
 * embedded widget mounts its `QueryClientProvider` INSIDE
 * `WidgetScheduleClient` — the widget page is deliberately self-contained —
 * so a `useQuery` in a sibling throws at render and takes the whole embed
 * down. Hoisting that provider to fix one small poller would trade a
 * documented boundary for a convenience. One endpoint, one interval, nothing
 * else reads it: a hook of its own is the smaller thing.
 */

export interface FacilityConditionsProps {
  facilityId: string;
  /** The widget renders on someone else's page; see NoticeBanner's header. */
  variant?: "tokens" | "light" | "dark";
}

const PALETTES = {
  tokens: { card: "border-border bg-card", strong: "text-foreground", muted: "text-muted-foreground" },
  light: { card: "border-gray-200 bg-gray-50", strong: "text-gray-900", muted: "text-gray-600" },
  dark: { card: "border-gray-700 bg-gray-800/60", strong: "text-white", muted: "text-gray-300" },
} as const;

export default function FacilityConditions({
  facilityId,
  variant = "tokens",
}: FacilityConditionsProps) {
  const data = useConditions(facilityId);

  const now = new Date();
  const items = (data?.readings ?? [])
    .map((r) => describe(r, now))
    .filter((d): d is Described => d !== null);

  // No skeleton and no empty state. Most facilities publish none of this, and
  // a placeholder above the schedule on every one of them would be a worse
  // page than no block at all.
  if (items.length === 0) return null;

  const palette = PALETTES[variant];

  return (
    <div
      className={`mb-6 flex flex-wrap gap-x-6 gap-y-3 rounded-xl border px-4 py-3 ${palette.card}`}
      role="region"
      aria-label="Current conditions"
    >
      {items.map((item) => (
        <div key={item.key} className="flex items-start gap-2.5">
          <item.Icon className={`mt-0.5 size-4 shrink-0 ${palette.muted}`} aria-hidden />
          <div>
            <p className={`text-sm font-semibold ${palette.strong}`}>{item.headline}</p>
            <p className={`text-xs ${palette.muted}`}>{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Poll the conditions endpoint, and stop while nobody is looking.
 *
 * Sixty seconds against a thirty-second edge cache, so most polls are free.
 * The `visibilitychange` pause is not an optimisation: a schedule left open on
 * a lobby screen or a forgotten tab would otherwise spend all night consuming
 * the `facilityConditions` rate limit for an audience of nobody, and come back
 * throttled at the moment someone looks.
 *
 * A failed request keeps whatever was last shown rather than clearing the
 * block. The number is still labelled with the time it was taken, so a stale
 * render degrades to an older honest reading instead of a hole in the page.
 */
function useConditions(facilityId: string): ConditionsResponse | null {
  const [data, setData] = useState<ConditionsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/public/v1/facility/${facilityId}/conditions`);
        if (!res.ok) return;
        const body: ConditionsResponse = await res.json();
        if (!cancelled) setData(body);
      } catch {
        // Keep the last good answer. See above.
      }
    }

    load();
    const timer = setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [facilityId]);

  return data;
}

interface Described {
  key: string;
  Icon: typeof Users;
  headline: string;
  detail: string;
}

/**
 * One reading as two lines, or `null` when it has nothing honest to say.
 *
 * All four branches are here rather than in JSX because the rule — what a
 * stale number is allowed to claim — is the whole design of this component,
 * and it should be readable in one place.
 */
function describe(r: ConditionReading, now: Date): Described | null {
  const where = r.spaceName ? `${r.spaceName} · ` : "";
  const key = `${r.spaceId ?? "facility"}-${r.metric}`;
  const fresh = isFresh(r.metric, r.recordedAt, now);

  if (r.metric === "headcount") {
    // `level` mode: a band, and no number anywhere. The exact count was never
    // sent — see facility_public_conditions().
    if (r.level) {
      if (!fresh) return null;
      return {
        key,
        Icon: Users,
        headline: LEVEL_LABEL[r.level],
        detail: `${where}as of ${formatRecordedAt(r.recordedAt, now)}`,
      };
    }

    if (r.value == null) return null;

    if (fresh) {
      return {
        key,
        Icon: Users,
        // "About", because a head count is a count made by eye from a deck.
        headline: `About ${Math.round(r.value)} here`,
        detail: `${where}counted at ${formatRecordedAt(r.recordedAt, now)}`,
      };
    }

    // Stale, but there is history. A DIFFERENT claim, and worded as one.
    if (r.typicalValue != null) {
      return {
        key,
        Icon: Users,
        headline: `Usually about ${Math.round(r.typicalValue)} at this time`,
        detail: `${where}from the last eight weeks`,
      };
    }

    // Stale with nothing behind it. Say nothing.
    return null;
  }

  // Temperatures. No typical fallback: a "usual" water temperature is a
  // setpoint, not an observation, and quoting one would tell a patron the pool
  // is 28° on the day the boiler failed.
  if (r.value == null || !fresh) return null;

  return {
    key,
    Icon: r.metric === "water_temp_c" ? Droplet : Thermometer,
    headline: `${METRICS[r.metric].publicLabel} ${formatReading(r.metric, r.value)}`,
    detail: `${where}at ${formatRecordedAt(r.recordedAt, now)}`,
  };
}
