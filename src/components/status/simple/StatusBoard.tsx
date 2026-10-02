"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, CircleAlert, CircleCheck, Clock, Info, TriangleAlert } from "lucide-react";
import {
  describeNoticeWindow,
  isNoticeFinished,
  isNoticeLive,
  isNoticeScheduled,
  sortNotices,
} from "@/lib/status/notices";
import type { StatusTemplate } from "@/lib/status/templates";
import type { FacilityNotice, NoticeSeverity } from "@/types/app.types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import StatusComposer, { type ComposerDepartment, type ComposerSpace } from "../StatusComposer";

/**
 * Facility status, the simple version (design: "Facility status: simple",
 * 2026-10-01). Three things, top to bottom:
 *
 *   1. What's wrong right now — one banner per live notice, with the one action
 *      that ends it, and staff reports waiting to be published. Nothing wrong
 *      reads "All open".
 *   2. Areas — one plain row per area (the whole facility, then each
 *      department): its name and "Open" or what is posted. Tapping a row is how
 *      you post for that area.
 *   3. Anything not live yet, folded, and only when there is some.
 *
 * Posting itself is the existing StatusComposer side panel; clearing sets
 * `ends_at` and keeps the record (history lives in Analytics).
 */

export interface StatusBoardProps {
  facilityId: string;
  departments: ComposerDepartment[];
  spaces: ComposerSpace[];
  notices: FacilityNotice[];
  templates: StatusTemplate[];
  canWrite: boolean;
  canReport?: boolean;
  canManageLibrary?: boolean;
  departmentColumn?: boolean;
  reporters?: Record<string, string>;
  readOnlyReason?: string;
  /** Lifted so the page header's "Post a status" opens the same panel. */
  composer: { open: boolean; departmentId: string | null };
  onComposerChange: (next: { open: boolean; departmentId: string | null }) => void;
}

const BANNER: Record<NoticeSeverity, "error" | "warning" | "info"> = {
  closure: "error",
  caution: "warning",
  info: "info",
};
const ICON = { closure: CircleAlert, caution: TriangleAlert, info: Info } as const;
const TEXT: Record<NoticeSeverity, string> = {
  closure: "text-destructive",
  caution: "text-warning",
  info: "text-brand",
};

export default function StatusBoard({
  facilityId,
  departments,
  spaces,
  notices,
  templates,
  canWrite,
  canReport = false,
  canManageLibrary = false,
  departmentColumn = true,
  reporters = {},
  readOnlyReason,
  composer,
  onComposerChange,
}: StatusBoardProps) {
  const router = useRouter();
  const reporting = !canWrite && canReport;
  const canCompose = canWrite || reporting;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const now = new Date();
  // Times in the browser only: describeNoticeWindow reads the runtime's zone,
  // and the server's (UTC) disagrees with the phone's.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const windowOf = (n: FacilityNotice) => (hydrated ? describeNoticeWindow(n, now) : "");

  const sorted = sortNotices(notices);
  const live = sorted.filter((n) => isNoticeLive(n, now));
  const reports = sorted.filter((n) => n.needs_review === true && !isNoticeFinished(n, now));
  const notLive = sorted.filter(
    (n) => n.needs_review !== true && !isNoticeFinished(n, now) && (!n.is_published || isNoticeScheduled(n, now))
  );

  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const spaceName = (id: string | null | undefined) => (id ? (spaceById.get(id)?.name ?? null) : null);
  const departmentOf = (n: FacilityNotice): string | null => {
    if (n.department_id && departments.some((d) => d.id === n.department_id)) return n.department_id;
    const fromSpace = n.space_id ? spaceById.get(n.space_id)?.department_id : null;
    return fromSpace && departments.some((d) => d.id === fromSpace) ? fromSpace : null;
  };
  const where = (n: FacilityNotice) =>
    spaceName(n.space_id) ?? departments.find((d) => d.id === departmentOf(n))?.name ?? "Whole facility";

  async function patch(n: FacilityNotice, body: object) {
    setBusyId(n.id);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/notices/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "That didn't save. Try again.");
      return;
    }
    router.refresh();
  }
  const end = (n: FacilityNotice) => patch(n, { ends_at: new Date().toISOString() });

  const openFor = (departmentId: string | null) => {
    setSent(false);
    onComposerChange({ open: true, departmentId });
  };

  const rows: { id: string | null; name: string }[] = [{ id: null, name: "Whole facility" }, ...departments];

  return (
    <div className="space-y-8">
      {/* ── 1. What's wrong right now ─────────────────────────────────────── */}
      <section aria-label="Right now" className="space-y-2.5">
        {error && <Banner variant="error">{error}</Banner>}
        {sent && <Banner variant="success">Sent. A manager will publish or dismiss it.</Banner>}

        {reports.map((n) => (
          <Banner
            key={n.id}
            variant="warning"
            icon={<Clock aria-hidden className="mt-0.5 size-4 shrink-0" />}
            title={`${n.headline} · ${where(n)}`}
            actions={
              canWrite && (
                <>
                  <Button size="sm" variant="outline" disabled={busyId === n.id} onClick={() => patch(n, { is_published: true })}>
                    Publish
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyId === n.id} onClick={() => end(n)}>
                    Dismiss
                  </Button>
                </>
              )
            }
          >
            {n.created_by && reporters[n.created_by] ? `Reported by ${reporters[n.created_by]}` : "Reported by staff"}
            {" · "}
            {canWrite ? "patrons can't see it yet" : "waiting for a manager"}
          </Banner>
        ))}

        {live.map((n) => {
          const Icon = ICON[n.severity];
          return (
            <Banner
              key={n.id}
              variant={BANNER[n.severity]}
              icon={<Icon aria-hidden className="mt-0.5 size-4 shrink-0" />}
              title={n.headline}
              actions={
                canWrite && (
                  <Button size="sm" variant="outline" disabled={busyId === n.id} onClick={() => end(n)}>
                    {n.severity === "closure" ? "Reopen" : "Clear"}
                  </Button>
                )
              }
            >
              {[where(n), windowOf(n), "patrons can see this"].filter(Boolean).join(" · ")}
            </Banner>
          );
        })}

        {live.length === 0 && reports.length === 0 && (
          <Banner variant="success" icon={<CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />}>
            All open. Nothing is posted.
          </Banner>
        )}
      </section>

      {/* ── 2. Areas ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="status-areas">
        <h2 id="status-areas" className="mb-2 text-heading text-foreground">
          Areas
        </h2>
        <ul className="overflow-hidden rounded-card border border-border bg-card shadow-card">
          {rows.map((row) => {
            const top = live.find((n) => departmentOf(n) === row.id) ?? null;
            const state = top ? (
              <span className={cn("truncate text-caption font-semibold", TEXT[top.severity])}>
                {spaceName(top.space_id) ? `${spaceName(top.space_id)}: ` : ""}
                {top.headline}
              </span>
            ) : (
              <span className="text-caption text-muted-foreground">Open</span>
            );
            const inner = (
              <>
                <span className="shrink-0 text-body font-medium text-foreground">{row.name}</span>
                <span className="ml-auto flex min-w-0 justify-end">{state}</span>
                {canCompose && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              </>
            );
            return (
              <li key={row.id ?? "facility"} className="border-t border-border first:border-t-0">
                {canCompose ? (
                  <button
                    type="button"
                    onClick={() => openFor(row.id)}
                    aria-label={`${row.name}: ${top ? top.headline : "open"}. ${reporting ? "Report a problem" : "Post a status"}`}
                    className="flex min-h-13 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="flex min-h-13 items-center gap-3 px-4 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
        {!canCompose && readOnlyReason && <p className="mt-2 text-caption text-muted-foreground">{readOnlyReason}</p>}
      </section>

      {/* ── 3. Not live yet, folded ──────────────────────────────────────── */}
      {notLive.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-caption font-medium text-brand hover:underline underline-offset-4">
            {notLive.length} not live yet
          </summary>
          <ul className="mt-2 overflow-hidden rounded-card border border-border bg-card">
            {notLive.map((n) => (
              <li key={n.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">{n.headline}</p>
                  <p className="truncate text-caption text-muted-foreground">
                    {[where(n), n.is_published ? windowOf(n) : "Staff only"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {canWrite && (
                  <Button size="sm" variant="ghost" disabled={busyId === n.id} onClick={() => patch(n, { is_published: !n.is_published })}>
                    {n.is_published ? "Unpublish" : "Publish"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canCompose && (
        <StatusComposer
          open={composer.open}
          onOpenChange={(open) => onComposerChange({ ...composer, open })}
          facilityId={facilityId}
          departments={departments}
          spaces={spaces}
          templates={templates}
          initialDepartmentId={composer.departmentId}
          reporting={reporting}
          canManageLibrary={canManageLibrary}
          departmentColumn={departmentColumn}
          onPosted={() => {
            onComposerChange({ ...composer, open: false });
            setSent(reporting);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function subscribeNever() {
  return () => {};
}
