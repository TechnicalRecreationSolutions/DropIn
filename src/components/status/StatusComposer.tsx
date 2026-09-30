"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Pencil } from "lucide-react";
import {
  CATEGORY_LABEL,
  NOTICE_CATEGORIES,
  NOTICE_SEVERITIES,
  SEVERITY_LABEL,
} from "@/lib/status/notices";
import { templatesFor, type StatusTemplate } from "@/lib/status/templates";
import type { NoticeCategory, NoticeSeverity } from "@/types/app.types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldHelp, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { SeverityDot } from "./SeverityDot";

/**
 * Posting a status, in a side panel.
 *
 * Two steps, one screen each: pick what happened from the statuses this
 * department is offered, then check the words. Everything the old inline form
 * asked up front — kind, end time, public or internal — sits under "More
 * options", because the answer the template gives is right almost every time
 * and the person posting is usually standing on a pool deck.
 *
 * The department chips at the top are the reason the library exists: a tennis
 * department sees tennis statuses and the ones meant for everyone, and never
 * "Fecal contamination".
 */

export interface ComposerDepartment {
  id: string;
  name: string;
}

export interface ComposerSpace {
  id: string;
  name: string;
  department_id: string | null;
}

type Draft = {
  category: NoticeCategory;
  severity: NoticeSeverity;
  headline: string;
  body: string;
  spaceId: string;
  endsAt: string;
  isPublished: boolean;
};

function draftFrom(t: StatusTemplate | null): Draft {
  return {
    category: t?.category ?? "other",
    severity: t?.severity ?? "info",
    headline: t?.headline ?? "",
    body: t?.body ?? "",
    spaceId: "",
    endsAt: "",
    // Published by default: an unpublished notice helps nobody in the car park.
    isPublished: true,
  };
}

const chip =
  "min-h-9 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipOn = "border-brand bg-brand-subtle text-brand-strong";
const chipOff = "border-input bg-card text-foreground hover:bg-muted";

export default function StatusComposer({
  open,
  onOpenChange,
  facilityId,
  departments,
  spaces,
  templates,
  initialDepartmentId,
  reporting,
  canManageLibrary,
  departmentColumn,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  departments: ComposerDepartment[];
  spaces: ComposerSpace[];
  templates: StatusTemplate[];
  /** `null` = the whole facility. */
  initialDepartmentId: string | null;
  /** True when this staffer files a report rather than posting (migration 063). */
  reporting: boolean;
  canManageLibrary: boolean;
  /**
   * False before migration 064: there is no column to store the department in,
   * so the post goes out facility-wide (or by its space) instead of 503ing.
   */
  departmentColumn: boolean;
  onPosted: () => void;
}) {
  const [departmentId, setDepartmentId] = useState<string | null>(initialDepartmentId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the row that opened the panel. The Sheet stays mounted, and
  // `cacheComponents` keeps the whole page mounted across navigations, so a
  // draft left in state would otherwise come back the next time.
  const [seededFor, setSeededFor] = useState<{ open: boolean; dept: string | null }>({
    open,
    dept: initialDepartmentId,
  });
  if (seededFor.open !== open || seededFor.dept !== initialDepartmentId) {
    setSeededFor({ open, dept: initialDepartmentId });
    if (open) {
      setDepartmentId(initialDepartmentId);
      setDraft(null);
      setError(null);
    }
  }

  const facilityDepartmentIds = departments.map((d) => d.id);
  const offered = templatesFor(templates, departmentId, facilityDepartmentIds);
  const scopeSpaces = departmentId ? spaces.filter((s) => s.department_id === departmentId) : spaces;
  const scopeName = departmentId
    ? (departments.find((d) => d.id === departmentId)?.name ?? "This department")
    : "The whole facility";

  async function submit() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: draft.category,
        severity: draft.severity,
        headline: draft.headline.trim(),
        body: draft.body.trim() || null,
        space_id: draft.spaceId || null,
        department_id: departmentColumn ? departmentId : null,
        // datetime-local has no zone; Date reads it on the local clock, like
        // every other date in this app since migration 036.
        ends_at: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        is_published: draft.isPublished,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    setDraft(null);
    onPosted();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{reporting ? "Report a problem" : "Post a status"}</SheetTitle>
          <SheetDescription>
            {reporting
              ? "It goes to your Managers, who publish it to patrons."
              : "Shown above the schedule on the facility page and every embed."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 p-6">
          {error && <Banner variant="error">{error}</Banner>}

          {/* ── Who it is about ─────────────────────────────────────────── */}
          {departments.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">About</legend>
              <div className="flex flex-wrap gap-2">
                {[{ id: null as string | null, name: "Whole facility" }, ...departments].map(
                  (d) => (
                    <button
                      key={d.id ?? "facility"}
                      type="button"
                      aria-pressed={departmentId === d.id}
                      onClick={() => {
                        setDepartmentId(d.id);
                        // A space picked for the old scope may not exist in this one.
                        if (draft) setDraft({ ...draft, spaceId: "" });
                      }}
                      className={`${chip} ${departmentId === d.id ? chipOn : chipOff}`}
                    >
                      {d.name}
                    </button>
                  )
                )}
              </div>
            </fieldset>
          )}

          {!draft ? (
            /* ── Step 1: what happened ───────────────────────────────────── */
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">What happened?</p>
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
                {offered.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setDraft(draftFrom(t))}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <SeverityDot severity={t.severity} />
                      <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                        {t.label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {SEVERITY_LABEL[t.severity]}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setDraft(draftFrom(null))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
                    Write your own
                  </button>
                </li>
              </ul>
              {canManageLibrary && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Missing one?{" "}
                  <Link
                    href="/dashboard/settings/statuses"
                    className="font-medium text-brand underline-offset-4 hover:underline"
                  >
                    Edit the status list
                  </Link>
                </p>
              )}
            </div>
          ) : (
            /* ── Step 2: check the words ─────────────────────────────────── */
            <form
              id="status-composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="space-y-4"
            >
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="-ml-1 flex items-center gap-1 rounded-full px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Pick a different status
              </button>

              <div>
                <Label htmlFor="status-headline">
                  {reporting ? "What patrons would read *" : "What patrons will read *"}
                </Label>
                <Input
                  id="status-headline"
                  required
                  maxLength={120}
                  value={draft.headline}
                  onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                  placeholder="Courts closed — wet surface"
                />
              </div>

              <div>
                <Label htmlFor="status-body">More detail</Label>
                <Textarea
                  id="status-body"
                  rows={3}
                  maxLength={1000}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
                <FieldHelp>Don&apos;t promise a reopening time unless you know one.</FieldHelp>
              </div>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">How serious</legend>
                <div className="flex flex-wrap gap-2">
                  {NOTICE_SEVERITIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={draft.severity === s}
                      onClick={() => setDraft({ ...draft, severity: s })}
                      className={`${chip} flex items-center gap-2 ${draft.severity === s ? chipOn : chipOff}`}
                    >
                      <SeverityDot severity={s} />
                      {SEVERITY_LABEL[s]}
                    </button>
                  ))}
                </div>
              </fieldset>

              {scopeSpaces.length > 0 && (
                <div>
                  <Label htmlFor="status-space">Where</Label>
                  <NativeSelect
                    id="status-space"
                    value={draft.spaceId}
                    onChange={(e) => setDraft({ ...draft, spaceId: e.target.value })}
                  >
                    <option value="">{departmentId ? `All of ${scopeName}` : scopeName}</option>
                    {scopeSpaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}

              {!reporting && (
                <Collapsible>
                  <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    More options
                    <ChevronDown
                      className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 space-y-4">
                    <div>
                      <Label htmlFor="status-category">Kind</Label>
                      <NativeSelect
                        id="status-category"
                        value={draft.category}
                        onChange={(e) =>
                          setDraft({ ...draft, category: e.target.value as NoticeCategory })
                        }
                      >
                        {NOTICE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div>
                      <Label htmlFor="status-ends">Take it down at</Label>
                      <Input
                        id="status-ends"
                        type="datetime-local"
                        value={draft.endsAt}
                        onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                      />
                      <FieldHelp>Leave empty to keep it up until you clear it.</FieldHelp>
                    </div>
                    <label className="flex items-start gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={!draft.isPublished}
                        onChange={(e) => setDraft({ ...draft, isPublished: !e.target.checked })}
                        className="mt-0.5 size-4 accent-primary"
                      />
                      <span>
                        <span className="font-medium">Staff only for now</span>
                        <span className="block text-xs text-muted-foreground">
                          Saved here without reaching patrons. Publish it later from this page.
                        </span>
                      </span>
                    </label>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </form>
          )}
        </div>

        {draft && (
          <SheetFooter className="flex-row justify-end border-t border-border">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="status-composer" disabled={busy || !draft.headline.trim()}>
              {busy
                ? reporting
                  ? "Sending…"
                  : "Posting…"
                : reporting
                  ? "Send to a Manager"
                  : draft.isPublished
                    ? "Post it"
                    : "Save for staff"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
