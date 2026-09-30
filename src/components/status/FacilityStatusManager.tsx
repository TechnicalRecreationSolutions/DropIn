"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Clock, Plus, Trash2 } from "lucide-react";
import {
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  describeNoticeWindow,
  isNoticeFinished,
  isNoticeLive,
  isNoticeScheduled,
  sortNotices,
} from "@/lib/status/notices";
import type { StatusTemplate } from "@/lib/status/templates";
import type { FacilityNotice } from "@/types/app.types";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import StatusComposer, { type ComposerDepartment, type ComposerSpace } from "./StatusComposer";
import { SeverityDot } from "./SeverityDot";

/**
 * The staff side of facility status.
 *
 * ## One row per department
 *
 * The page opens on a board: the whole facility, then each department, and
 * what is live on each — or "All clear". That is the question someone opening
 * this at 6am is asking ("is anything wrong, and where?"), and it answers it
 * without reading a list. Each row has its own Post button, which opens the
 * composer already scoped to that department and offering only its statuses.
 *
 * A notice lands on a row by its `department_id` (migration 064), else by its
 * space's department, else on the whole-facility row — so notices posted
 * before 064 still sit where they belong.
 *
 * ## Everything else is folded away
 *
 * Posting happens in a side panel (`StatusComposer`), not a form that pushes
 * the board down. Drafts and scheduled notices only appear when there are
 * some. History is one collapsed row.
 *
 * ## Clearing is not deleting
 *
 * "Clear" sets `ends_at` and keeps the record. Delete is for a notice that
 * should never have existed, and says so.
 */

export interface FacilityStatusManagerProps {
  facilityId: string;
  departments: ComposerDepartment[];
  spaces: ComposerSpace[];
  notices: FacilityNotice[];
  templates: StatusTemplate[];
  /** False for a role (or an org policy) that may read this page but not write. */
  canWrite: boolean;
  /** Rendered instead of the Post buttons when the viewer can neither post nor report. */
  readOnlyReason?: string;
  /** May file a report for review (migration 063). Ignored when `canWrite`. */
  canReport?: boolean;
  /** Shows the "Edit the status list" link in the composer. */
  canManageLibrary?: boolean;
  /** Whether migration 064 is applied, so a notice can name its department. */
  departmentColumn?: boolean;
  /** user id → email, for "Reported by" on a waiting report. */
  reporters?: Record<string, string>;
  /**
   * Rendered straight under the board — the "People here" counter. A slot
   * rather than a prop list so the page owns the readings query.
   */
  afterBoard?: React.ReactNode;
}

export default function FacilityStatusManager({
  facilityId,
  departments,
  spaces,
  notices,
  templates,
  canWrite,
  readOnlyReason,
  canReport = false,
  canManageLibrary = false,
  departmentColumn = true,
  reporters = {},
  afterBoard,
}: FacilityStatusManagerProps) {
  const reporting = !canWrite && canReport;
  const canCompose = canWrite || reporting;
  const router = useRouter();
  const [composer, setComposer] = useState<{ open: boolean; departmentId: string | null }>({
    open: false,
    departmentId: null,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // One `now` per render, so a notice cannot be live in one list and finished
  // in the next because a second ticked over between two calls.
  const now = new Date();
  // Times render in the BROWSER only: describeNoticeWindow reads the runtime's
  // locale and zone, so the server's "22:27" (UTC on Vercel) and the phone's
  // "10:27 p.m." disagreed and React threw a hydration error whenever a notice
  // was live. Same idiom as HeadCountTool. Found by verify-be once counting
  // moved onto this page.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const windowOf = (n: FacilityNotice) => (hydrated ? describeNoticeWindow(n, now) : "…");
  const sorted = sortNotices(notices);
  const live = sorted.filter((n) => isNoticeLive(n, now));
  const reports = sorted.filter((n) => n.needs_review === true && !isNoticeFinished(n, now));
  const upcoming = sorted.filter(
    (n) =>
      n.needs_review !== true &&
      !isNoticeFinished(n, now) &&
      (!n.is_published || isNoticeScheduled(n, now))
  );
  const past = sorted.filter((n) => isNoticeFinished(n, now));

  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const spaceName = (id: string | null | undefined) => (id ? (spaceById.get(id)?.name ?? null) : null);
  const departmentOf = (n: FacilityNotice): string | null => {
    if (n.department_id && departments.some((d) => d.id === n.department_id)) return n.department_id;
    const fromSpace = n.space_id ? spaceById.get(n.space_id)?.department_id : null;
    return fromSpace && departments.some((d) => d.id === fromSpace) ? fromSpace : null;
  };

  const rows: { id: string | null; name: string }[] = [
    { id: null, name: "Whole facility" },
    ...departments,
  ];

  async function send(url: string, init: RequestInit, id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    router.refresh();
  }

  const clear = (n: FacilityNotice) =>
    send(
      `/api/facilities/${facilityId}/notices/${n.id}`,
      { method: "PATCH", body: JSON.stringify({ ends_at: new Date().toISOString() }) },
      n.id
    );
  const publish = (n: FacilityNotice, is_published: boolean) =>
    send(
      `/api/facilities/${facilityId}/notices/${n.id}`,
      { method: "PATCH", body: JSON.stringify({ is_published }) },
      n.id
    );
  const remove = (n: FacilityNotice) =>
    send(`/api/facilities/${facilityId}/notices/${n.id}`, { method: "DELETE" }, n.id);

  const openComposer = (departmentId: string | null) => {
    setSent(false);
    setComposer({ open: true, departmentId });
  };

  const where = (n: FacilityNotice) => {
    const dept = departmentOf(n);
    return spaceName(n.space_id) ?? (dept ? departments.find((d) => d.id === dept)?.name : null);
  };

  return (
    <div className="space-y-10">
      {error && <Banner variant="error">{error}</Banner>}
      {sent && (
        <Banner variant="success">
          Sent. It waits under &ldquo;Waiting for approval&rdquo; until a Manager publishes or
          dismisses it.
        </Banner>
      )}

      {/* ── Reports waiting for someone who can publish (063) ──────────── */}
      {reports.length > 0 && (
        <section>
          <h2 className="mb-3 text-heading text-foreground">Waiting for approval</h2>
          <ul className="space-y-2">
            {reports.map((n) => (
              <li
                key={n.id}
                className="flex flex-col gap-3 rounded-banner bg-warning-subtle px-4 py-3 text-warning sm:flex-row sm:items-start"
              >
                <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{n.headline}</p>
                  {n.body && <p className="mt-0.5 text-sm">{n.body}</p>}
                  <p className="mt-1 text-xs">
                    {[
                      SEVERITY_LABEL[n.severity],
                      where(n),
                      n.created_by && reporters[n.created_by]
                        ? `Reported by ${reporters[n.created_by]}`
                        : "Reported by staff",
                      windowOf(n),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {!canWrite && (
                    <p className="mt-1 text-xs">Patrons can&apos;t see this until a Manager publishes it.</p>
                  )}
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => publish(n, true)}
                      disabled={busyId === n.id}
                    >
                      {busyId === n.id ? "Saving…" : "Publish"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => clear(n)}
                      disabled={busyId === n.id}
                      title="Not needed, or already handled. Keeps the report in the record."
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── The board ───────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-heading text-foreground">Right now</h2>
          <p className="text-sm text-muted-foreground">
            {live.length === 0
              ? "Nothing posted"
              : `${live.length} live ${live.length === 1 ? "status" : "statuses"}`}
          </p>
        </div>

        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-card">
          {rows.map((row) => {
            const rowLive = live.filter((n) => departmentOf(n) === row.id);
            return (
              <li key={row.id ?? "facility"} className="flex flex-col gap-3 p-4 sm:flex-row sm:gap-6">
                <div className="flex items-center justify-between gap-3 sm:w-40 sm:shrink-0 sm:items-start">
                  <p className="text-sm font-semibold text-foreground">{row.name}</p>
                  {canCompose && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="-my-1 sm:hidden"
                      onClick={() => openComposer(row.id)}
                    >
                      <Plus className="size-4" aria-hidden />
                      {reporting ? "Report" : "Post"}
                    </Button>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {rowLive.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="size-4 shrink-0 text-success" aria-hidden />
                      All clear
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {rowLive.map((n) => (
                        <li key={n.id} className="flex items-start gap-3">
                          <span className="mt-1.5">
                            <SeverityDot severity={n.severity} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{n.headline}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {[SEVERITY_LABEL[n.severity], spaceName(n.space_id), windowOf(n)]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          {canWrite && (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => clear(n)}
                                disabled={busyId === n.id}
                              >
                                {busyId === n.id ? "Clearing…" : "Clear"}
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => remove(n)}
                                disabled={busyId === n.id}
                                aria-label="Delete this notice"
                                title="Posted by mistake? Delete removes it from the record. Use Clear when it was real and is over."
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {canCompose && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="hidden shrink-0 self-start sm:inline-flex"
                    onClick={() => openComposer(row.id)}
                    aria-label={`${reporting ? "Report a problem" : "Post a status"}: ${row.name}`}
                  >
                    <Plus className="size-4" aria-hidden />
                    {reporting ? "Report" : "Post"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {!canCompose && readOnlyReason && (
          <Banner variant="neutral" role={undefined} className="mt-3">
            {readOnlyReason}
          </Banner>
        )}
      </section>

      {afterBoard}

      {/* ── Not live yet: staff-only and scheduled, only when there are some ── */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-heading text-foreground">Not live yet</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
            {upcoming.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                <SeverityDot severity={n.severity} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{n.headline}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[where(n) ?? "Whole facility", windowOf(n)].join(" · ")}
                  </p>
                </div>
                <Badge variant={n.is_published ? "brand" : "default"}>
                  {n.is_published ? "Starts later" : "Staff only"}
                </Badge>
                {canWrite && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => publish(n, !n.is_published)}
                    disabled={busyId === n.id}
                    className="shrink-0"
                  >
                    {busyId === n.id ? "Saving…" : n.is_published ? "Unpublish" : "Publish"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── History, folded ─────────────────────────────────────────────── */}
      {past.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-card px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-heading text-foreground">History</span>
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              {past.length > 20 ? "Last 20" : past.length}
              <ChevronDown
                className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
              {past.slice(0, 20).map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                  <SeverityDot severity={n.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{n.headline}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        where(n) ?? "Whole facility",
                        CATEGORY_LABEL[n.category],
                        hydrated
                          ? new Date(n.starts_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : "…",
                      ].join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {canCompose && (
        <StatusComposer
          open={composer.open}
          onOpenChange={(open) => setComposer((c) => ({ ...c, open }))}
          facilityId={facilityId}
          departments={departments}
          spaces={spaces}
          templates={templates}
          initialDepartmentId={composer.departmentId}
          reporting={reporting}
          canManageLibrary={canManageLibrary}
          departmentColumn={departmentColumn}
          onPosted={() => {
            setComposer((c) => ({ ...c, open: false }));
            setSent(reporting);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** For `useSyncExternalStore`: a store that never changes, read only to tell server from client. */
function subscribeNever() {
  return () => {};
}
