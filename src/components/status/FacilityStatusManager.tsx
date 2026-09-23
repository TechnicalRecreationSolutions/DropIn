"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, AlertTriangle, Check, Info, Plus, Trash2, X } from "lucide-react";
import {
  CATEGORY_LABEL,
  NOTICE_CATEGORIES,
  NOTICE_SEVERITIES,
  SEVERITY_LABEL,
  describeNoticeWindow,
  isNoticeFinished,
  isNoticeLive,
  isNoticeScheduled,
  sortNotices,
} from "@/lib/status/notices";
import { NOTICE_PRESETS, type NoticePreset } from "@/lib/status/notice-presets";
import type { FacilityNotice, NoticeCategory, NoticeSeverity } from "@/types/app.types";

/**
 * The staff side of facility status.
 *
 * ## The shape of the page is the shape of the job
 *
 * Almost every visit is one of two things: *something just happened, tell
 * people* or *it's fixed, take it down*. Those are the top two blocks, in that
 * order, and neither needs a scroll. Everything else — drafts, scheduled
 * notices, what happened last month — is below them, because it is never the
 * reason someone opened this page at 6am.
 *
 * ## Posting is one tap and one confirm
 *
 * A preset fills the form; the form is already open when you pick one. The
 * alternative — an empty form with eight fields and a category dropdown —
 * loses to the whiteboard by the front desk, which is what this replaces.
 *
 * ## Clearing is not deleting
 *
 * "Reopen" sets `ends_at`. The row stays, because the history of why a
 * facility keeps closing is worth more than a tidy list, and because a patron
 * who saw the closure is owed the record that it was real. Delete is there for
 * the other case — posted by mistake, wrong space — and says so.
 */

interface Space {
  id: string;
  name: string;
}

export interface FacilityStatusManagerProps {
  facilityId: string;
  spaces: Space[];
  notices: FacilityNotice[];
  /** False for a role (or an org policy) that may read this page but not write. */
  canWrite: boolean;
  /**
   * Why they cannot write, when they cannot. Rendered instead of the composer,
   * because "the button is missing" is not an explanation an aux staffer can
   * act on — and the fix (a Manager flips one setting) is worth naming.
   */
  readOnlyReason?: string;
}

type Draft = {
  presetId: string;
  category: NoticeCategory;
  severity: NoticeSeverity;
  headline: string;
  body: string;
  spaceId: string;
  /** "" means no end — the common case. Otherwise a datetime-local value. */
  endsAt: string;
  isPublished: boolean;
};

function draftFromPreset(preset: NoticePreset): Draft {
  return {
    presetId: preset.id,
    category: preset.category,
    severity: preset.severity,
    headline: preset.headline,
    body: preset.body,
    spaceId: "",
    endsAt: "",
    // Published by default. An unpublished notice helps nobody standing in the
    // car park, and the one case that wants a draft — writing it before it is
    // true — is served by the checkbox being right there.
    isPublished: true,
  };
}

const SEVERITY_ICON = { closure: AlertOctagon, caution: AlertTriangle, info: Info } as const;

export default function FacilityStatusManager({
  facilityId,
  spaces,
  notices,
  canWrite,
  readOnlyReason,
}: FacilityStatusManagerProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `now` is captured once per render rather than read inside each predicate,
  // so a notice cannot be counted live in one list and finished in the next
  // because a second ticked over between two calls.
  const now = new Date();
  const sorted = sortNotices(notices);
  const live = sorted.filter((n) => isNoticeLive(n, now));
  const scheduled = sorted.filter((n) => isNoticeScheduled(n, now) && !isNoticeFinished(n, now));
  const drafts = sorted.filter((n) => !n.is_published && !isNoticeFinished(n, now));
  const past = sorted.filter((n) => isNoticeFinished(n, now));

  async function send(url: string, init: RequestInit, id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function post() {
    if (!draft) return;
    const ok = await send(
      `/api/facilities/${facilityId}/notices`,
      {
        method: "POST",
        body: JSON.stringify({
          category: draft.category,
          severity: draft.severity,
          headline: draft.headline.trim(),
          body: draft.body.trim() || null,
          space_id: draft.spaceId || null,
          // datetime-local has no zone; the Date constructor reads it in the
          // runtime's, which is the same local clock every other date in this
          // app uses since migration 036.
          ends_at: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
          is_published: draft.isPublished,
        }),
      },
      "new"
    );
    // Close and discard on success. `cacheComponents` keeps this component
    // mounted across navigations, so a draft left in state comes back
    // pre-filled the next time someone opens the page — see the note in
    // components/facility/FacilityForm.tsx.
    if (ok) setDraft(null);
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

  const spaceName = (id: string | null) =>
    id ? (spaces.find((s) => s.id === id)?.name ?? null) : null;

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {/* ── 1. Live now ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Live now</h2>
        {live.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Nothing posted. Patrons see the schedule as normal.
          </p>
        ) : (
          <ul className="space-y-2">
            {live.map((n) => {
              const Icon = SEVERITY_ICON[n.severity];
              return (
                <li
                  key={n.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-start"
                >
                  <Icon
                    className={`mt-0.5 size-5 shrink-0 ${
                      n.severity === "closure"
                        ? "text-red-600 dark:text-red-400"
                        : n.severity === "caution"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{n.headline}</p>
                    {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[spaceName(n.space_id), CATEGORY_LABEL[n.category], describeNoticeWindow(n, now)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => clear(n)}
                        disabled={busyId === n.id}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                      >
                        {busyId === n.id ? "Clearing…" : "Clear"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(n)}
                        disabled={busyId === n.id}
                        aria-label="Delete this notice"
                        title="Posted by mistake? Delete removes it from the record. Use Clear when it was real and is over."
                        className="rounded-lg border border-border px-2.5 py-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 2. Post one ─────────────────────────────────────────────────── */}
      {canWrite ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Post a status</h2>

          <div className="flex flex-wrap gap-2">
            {NOTICE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDraft(draftFromPreset(preset))}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  draft?.presetId === preset.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-muted"
                }`}
              >
                {preset.id === "blank" ? (
                  <span className="flex items-center gap-1.5">
                    <Plus className="size-3.5" aria-hidden />
                    {preset.label}
                  </span>
                ) : (
                  preset.label
                )}
              </button>
            ))}
          </div>

          {draft && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                post();
              }}
              className="mt-4 space-y-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Everything here is editable — the wording came from a template.
                </p>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  aria-label="Discard this draft"
                  className="-m-1 rounded-lg p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div>
                <label htmlFor="headline" className="mb-1 block text-sm font-medium">
                  What patrons will read *
                </label>
                <input
                  id="headline"
                  required
                  maxLength={120}
                  value={draft.headline}
                  onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                  placeholder="Pool closed — contamination"
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="body" className="mb-1 block text-sm font-medium">
                  More detail
                </label>
                <textarea
                  id="body"
                  rows={3}
                  maxLength={1000}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Don&apos;t promise a reopening time unless you know one.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="space" className="mb-1 block text-sm font-medium">
                    Where
                  </label>
                  <select
                    id="space"
                    value={draft.spaceId}
                    onChange={(e) => setDraft({ ...draft, spaceId: e.target.value })}
                    className="w-full rounded-lg border border-border px-3 py-2.5 text-sm"
                  >
                    <option value="">The whole facility</option>
                    {spaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="severity" className="mb-1 block text-sm font-medium">
                    How serious
                  </label>
                  <select
                    id="severity"
                    value={draft.severity}
                    onChange={(e) =>
                      setDraft({ ...draft, severity: e.target.value as NoticeSeverity })
                    }
                    className="w-full rounded-lg border border-border px-3 py-2.5 text-sm"
                  >
                    {NOTICE_SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="category" className="mb-1 block text-sm font-medium">
                    Kind
                  </label>
                  <select
                    id="category"
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({ ...draft, category: e.target.value as NoticeCategory })
                    }
                    className="w-full rounded-lg border border-border px-3 py-2.5 text-sm"
                  >
                    {NOTICE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="endsAt" className="mb-1 block text-sm font-medium">
                    Take it down at
                  </label>
                  <input
                    id="endsAt"
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                    className="w-full rounded-lg border border-border px-3 py-2.5 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Leave empty to keep it up until you clear it.
                  </p>
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isPublished}
                  onChange={(e) => setDraft({ ...draft, isPublished: e.target.checked })}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="font-medium">Show this to the public</span>
                  <span className="block text-xs text-muted-foreground">
                    On the facility page and in every embedded schedule for this building.
                    Uncheck to keep it internal for now.
                  </span>
                </span>
              </label>

              <button
                type="submit"
                disabled={busyId === "new" || !draft.headline.trim()}
                className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-50 sm:w-auto"
              >
                {busyId === "new" ? "Posting…" : draft.isPublished ? "Post it" : "Save as internal"}
              </button>
            </form>
          )}
        </section>
      ) : (
        readOnlyReason && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Post a status</h2>
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              {readOnlyReason}
            </p>
          </section>
        )
      )}

      {/* ── 3. Everything else ──────────────────────────────────────────── */}
      <NoticeList
        title="Not visible yet"
        empty={null}
        notices={drafts}
        now={now}
        spaceName={spaceName}
        action={
          canWrite
            ? { label: "Publish", run: (n) => publish(n, true), busyId }
            : undefined
        }
      />

      <NoticeList
        title="Starts later"
        empty={null}
        notices={scheduled}
        now={now}
        spaceName={spaceName}
        action={
          canWrite ? { label: "Unpublish", run: (n) => publish(n, false), busyId } : undefined
        }
      />

      <NoticeList
        title="Past"
        empty="Nothing has been posted here yet."
        notices={past.slice(0, 20)}
        now={now}
        spaceName={spaceName}
      />
    </div>
  );
}

function NoticeList({
  title,
  empty,
  notices,
  now,
  spaceName,
  action,
}: {
  title: string;
  /** `null` hides the whole section when it is empty; a string renders instead. */
  empty: string | null;
  notices: FacilityNotice[];
  now: Date;
  spaceName: (id: string | null) => string | null;
  action?: { label: string; run: (n: FacilityNotice) => void; busyId: string | null };
}) {
  if (notices.length === 0 && empty === null) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {notices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {notices.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{n.headline}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    SEVERITY_LABEL[n.severity],
                    spaceName(n.space_id),
                    describeNoticeWindow(n, now),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {action && (
                <button
                  type="button"
                  onClick={() => action.run(n)}
                  disabled={action.busyId === n.id}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {action.busyId === n.id ? "Saving…" : action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
