"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { NEEDS_YOU_KEY } from "@/hooks/useNeedsYouCount";
import { CalendarClock, CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { cn } from "@/lib/utils/cn";
import LocalTime from "./LocalTime";

/**
 * "Needs you": the top of the Overview. Every row names one thing that is
 * waiting on this person and offers one action — a report from staff to
 * publish or dismiss, a conflict by name, a week that patrons cannot see yet.
 * Empty means a plain "All clear", never an empty box (rubric A4/A5).
 *
 * Rows arrive already ordered and already permission-filtered from the page;
 * this component only runs the two in-place actions (publish/dismiss a report,
 * allow a conflict) and links everything else to where it is fixed.
 */

export type NeedsYouTone = "urgent" | "warning" | "info";

export type NeedsYouAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "publish-report"; label: string; facilityId: string; noticeId: string }
  | { kind: "dismiss-report"; label: string; facilityId: string; noticeId: string }
  | { kind: "allow-conflict"; label: string; sessionAId: string; sessionBId: string };

export interface NeedsYouItem {
  id: string;
  tone: NeedsYouTone;
  icon: "report" | "conflict" | "week";
  title: string;
  meta: string;
  /** An instant shown after the meta line in the viewer's zone ("· 2:14 pm"). */
  metaTime?: string;
  primary: NeedsYouAction;
  secondary?: NeedsYouAction;
}

const ICONS: Record<NeedsYouItem["icon"], LucideIcon> = {
  report: CircleAlert,
  conflict: TriangleAlert,
  week: CalendarClock,
};

const TONE_CLASS: Record<NeedsYouTone, string> = {
  urgent: "text-destructive",
  warning: "text-warning",
  info: "text-brand",
};

async function run(action: NeedsYouAction): Promise<void> {
  let res: Response;
  switch (action.kind) {
    case "publish-report":
      res = await fetch(`/api/facilities/${action.facilityId}/notices/${action.noticeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: true }),
      });
      break;
    case "dismiss-report":
      res = await fetch(`/api/facilities/${action.facilityId}/notices/${action.noticeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ends_at: new Date().toISOString() }),
      });
      break;
    case "allow-conflict":
      res = await fetch(`/api/conflicts/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionAId: action.sessionAId, sessionBId: action.sessionBId }),
      });
      break;
    default:
      return;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "That didn't save. Try again.");
  }
}

function ActionButton({
  action,
  variant,
  busy,
  onRun,
}: {
  action: NeedsYouAction;
  variant: "outline" | "ghost";
  busy: boolean;
  onRun: (a: NeedsYouAction) => void;
}) {
  // 32px on a laptop, 44px on a phone: these are tapped on a pool deck.
  const size = "h-11 sm:h-8 sm:px-3 sm:text-[0.8125rem]";
  if (action.kind === "link") {
    return (
      <Button asChild variant={variant} className={size}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} className={size} disabled={busy} onClick={() => onRun(action)}>
      {action.label}
    </Button>
  );
}

export default function NeedsYou({ items, checkedAt }: { items: NeedsYouItem[]; checkedAt: string }) {
  // checkedAt is an ISO instant; see LocalTime.
  const router = useRouter();
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = items.filter((i) => !hidden.has(i.id));
  const urgent = visible.filter((i) => i.tone === "urgent").length;

  const handle = (item: NeedsYouItem) => async (action: NeedsYouAction) => {
    setBusyId(item.id);
    setError(null);
    try {
      await run(action);
      setHidden((prev) => new Set(prev).add(item.id));
      // Keep the sidebar's count in step with the list.
      queryClient.invalidateQueries({ queryKey: [NEEDS_YOU_KEY] });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="needs-you-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="needs-you-heading" className="text-heading text-foreground">
          Needs you
        </h2>
        <span className="text-caption text-muted-foreground tabular-nums">
          {visible.length === 0
            ? <>Checked <LocalTime iso={checkedAt} /></>
            : `${visible.length} ${visible.length === 1 ? "thing" : "things"}${urgent ? ` · ${urgent} urgent` : ""}`}
        </span>
      </div>

      {error && (
        <Banner variant="error" className="mb-3">
          {error}
        </Banner>
      )}

      {visible.length === 0 ? (
        <Banner variant="success" icon={<CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />} title="All clear">
          Nothing is waiting on you. Staff reports, conflicts and weeks to approve show up here.
        </Banner>
      ) : (
        <ul className="overflow-hidden rounded-card border border-border bg-card shadow-card">
          {visible.map((item) => {
            const Icon = ICONS[item.icon];
            const busy = busyId === item.id;
            return (
              <li
                key={item.id}
                className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-t border-border px-4 py-3.5 first:border-t-0 sm:grid-cols-[16px_minmax(0,1fr)_auto]"
              >
                <Icon aria-hidden className={cn("mt-0.5 size-4", TONE_CLASS[item.tone])} />
                <div className="min-w-0">
                  <p className="text-body font-semibold text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {item.meta}
                    {item.metaTime && (
                      <>
                        {" · "}
                        <LocalTime iso={item.metaTime} />
                      </>
                    )}
                  </p>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3">
                  <ActionButton action={item.primary} variant="outline" busy={busy} onRun={handle(item)} />
                  {item.secondary && (
                    <ActionButton action={item.secondary} variant="ghost" busy={busy} onRun={handle(item)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
