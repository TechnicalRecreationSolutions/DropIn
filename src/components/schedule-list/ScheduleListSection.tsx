"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Eye, Copy, Trash2, ArrowRight, ChevronDown, ChevronUp, ChevronRight, CalendarX2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { cn } from "@/lib/utils/cn";
import { navTreeQueryKey } from "@/hooks/useNavTree";
import { SCHEDULE_STATUS_META, type ScheduleListStatus } from "@/lib/schedule/scheduleStatus";
import DuplicateScheduleDialog from "./DuplicateScheduleDialog";
import DeleteScheduleDialog from "./DeleteScheduleDialog";

export interface ScheduleListRow {
  id: string;
  name: string;
  typeLabel: string;
  typeIcon: string;
  departmentName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  sessionsCount: number;
  scheduleStatus: ScheduleListStatus;
  editHref: string;
  previewHref: string;
}

interface ScheduleListSectionProps {
  orgId: string;
  facilityName: string;
  rows: ScheduleListRow[];
  newScheduleHref: string;
  /** Overrides the "{facility} has no schedules yet" copy — for when `rows`
   *  arrives already narrowed by a department/schedule filter, so an empty
   *  list means "none match the filter", not "this facility is empty". */
  emptyMessage?: string;
  /** False for read-only staff (aux): hides create/duplicate/delete and turns
   *  "Edit" into "Open" — they can view a schedule but not change it, and the
   *  routes behind those buttons would 403. Defaults to true. */
  canEdit?: boolean;
}

type FilterValue = "all" | "active" | "draft";
type SortKey = "name" | "startsOn" | "endsOn" | "scheduleStatus";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
];

function formatDate(value: string | null): string {
  if (!value) return "Ongoing";
  // DATE columns arrive as plain "YYYY-MM-DD" — parsed as local, not UTC
  // midnight, so this never off-by-ones onto the previous day.
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The staff home screen's main content: every schedule at the selected
 * facility, split into what's current/active (the default view) and what's
 * stored (collapsed by default — see the header comment on why: it's
 * historical, and keeping it out of the way is what makes Section 1
 * scannable in one glance). Facility scope comes from the caller (the
 * sidebar tree owns facility switching); there is deliberately no
 * department filter here yet, per the schedule-list build's own
 * scope-creep guardrail.
 */
export default function ScheduleListSection({
  orgId,
  facilityName,
  rows,
  newScheduleHref,
  emptyMessage,
  canEdit = true,
}: ScheduleListSectionProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<FilterValue>("all");
  const [sortKey, setSortKey] = useState<SortKey>("startsOn");
  const [sortDesc, setSortDesc] = useState(true);
  const [storedOpen, setStoredOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<ScheduleListRow | null>(null);
  const [deleting, setDeleting] = useState<ScheduleListRow | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  const current = rows.filter((r) => r.scheduleStatus !== "stored");
  const stored = rows.filter((r) => r.scheduleStatus === "stored");

  const filteredCurrent = useMemo(() => {
    if (filter === "draft") return current.filter((r) => r.scheduleStatus === "unfinished");
    if (filter === "active") return current.filter((r) => r.scheduleStatus !== "unfinished");
    return current;
  }, [current, filter]);

  function sortRows(list: ScheduleListRow[]) {
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return sorted;
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  function refresh() {
    router.refresh();
    queryClient.invalidateQueries({ queryKey: navTreeQueryKey(orgId) });
  }

  async function handleConfirmDuplicate(name: string, startsOn: string | null, endsOn: string | null) {
    if (!duplicating) return;
    setMutating(true);
    setMutateError(null);

    const res = await fetch(`/api/schedule-groups/${duplicating.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, starts_on: startsOn, ends_on: endsOn }),
    });

    setMutating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMutateError(data.error ?? "Could not duplicate this schedule.");
      return;
    }

    setDuplicating(null);
    refresh();
  }

  async function handleConfirmDelete() {
    if (!deleting) return;
    setMutating(true);
    setMutateError(null);

    const res = await fetch(`/api/schedule-groups/${deleting.id}`, { method: "DELETE" });

    setMutating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMutateError(data.error ?? "Could not delete this schedule.");
      return;
    }

    setDeleting(null);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-0.5 bg-muted rounded-full">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-full transition-colors",
                filter === f.value ? "bg-raised text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canEdit && (
          <Link
            href={newScheduleHref}
            className="shrink-0 text-xs font-medium text-brand hover:underline underline-offset-4"
          >
            + New schedule
          </Link>
        )}
      </div>

      {mutateError && (
        <Banner variant="error">
          {mutateError}
        </Banner>
      )}

      {filteredCurrent.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <CalendarX2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? (emptyMessage ?? `${facilityName} has no schedules yet.`)
              : "Nothing matches this filter."}
          </p>
          {rows.length === 0 && !emptyMessage && canEdit && (
            <Link
              href={newScheduleHref}
              className="inline-block mt-3 text-sm font-medium text-brand hover:underline underline-offset-4"
            >
              Create your first schedule
            </Link>
          )}
        </Card>
      ) : (
        <ScheduleTable
          rows={sortRows(filteredCurrent)}
          sortKey={sortKey}
          sortDesc={sortDesc}
          onSort={toggleSort}
          canEdit={canEdit}
          onDuplicate={setDuplicating}
          onDelete={setDeleting}
        />
      )}

      {stored.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setStoredOpen((v) => !v)}
            className="flex items-center gap-1.5 text-label text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", storedOpen && "rotate-90")} />
            {stored.length} stored {stored.length === 1 ? "schedule" : "schedules"}
          </button>
          {storedOpen && (
            <div className="mt-3">
              <ScheduleTable
                rows={sortRows(stored)}
                sortKey={sortKey}
                sortDesc={sortDesc}
                onSort={toggleSort}
                canEdit={canEdit}
                onDuplicate={setDuplicating}
                onDelete={setDeleting}
              />
            </div>
          )}
        </div>
      )}

      <DuplicateScheduleDialog
        row={duplicating}
        onCancel={() => {
          setDuplicating(null);
          setMutateError(null);
        }}
        onConfirm={handleConfirmDuplicate}
        submitting={mutating}
      />

      <DeleteScheduleDialog
        row={deleting}
        onCancel={() => {
          setDeleting(null);
          setMutateError(null);
        }}
        onConfirm={handleConfirmDelete}
        submitting={mutating}
      />
    </div>
  );
}

interface ScheduleTableProps {
  rows: ScheduleListRow[];
  sortKey: SortKey;
  sortDesc: boolean;
  onSort: (key: SortKey) => void;
  canEdit: boolean;
  onDuplicate: (row: ScheduleListRow) => void;
  onDelete: (row: ScheduleListRow) => void;
}

function ScheduleTable({ rows, sortKey, sortDesc, onSort, canEdit, onDuplicate, onDelete }: ScheduleTableProps) {
  const OpenIcon = canEdit ? Pencil : ArrowRight;
  const openLabel = canEdit ? "Edit" : "Open";
  return (
    <>
      {/* Phone: cards, not a narrowed table.
          The table below drops four columns at this width and still leaves the
          actions past the right edge of a 390px screen — reachable only by
          scrolling sideways *inside* the card, which almost nobody discovers.
          A row whose Edit and Delete cannot be reached is a read-only row, so
          the phone got its own layout rather than a squeezed copy of this one.
          Sorting stays desktop-only on purpose: the rows arrive already sorted
          by the same comparator, and a sort control per column is four more
          taps competing with the four that do something. */}
      <div className="sm:hidden">
        <ScheduleCards rows={rows} canEdit={canEdit} onDuplicate={onDuplicate} onDelete={onDelete} />
      </div>

      {/* The wrapper carries the breakpoint, not the Card: Card's own base
          classes include `flex`, and `hidden sm:flex` on the same element
          leaves two display utilities fighting in one cascade layer. */}
      <div className="hidden sm:block">
      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-label text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Type</th>
              <SortableHead label="Description" sortKey="name" active={sortKey} desc={sortDesc} onSort={onSort} />
              <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Department</th>
              <SortableHead label="Start" sortKey="startsOn" active={sortKey} desc={sortDesc} onSort={onSort} className="hidden sm:table-cell" />
              <SortableHead label="End" sortKey="endsOn" active={sortKey} desc={sortDesc} onSort={onSort} className="hidden md:table-cell" />
              <th className="px-4 py-2.5 font-medium hidden md:table-cell">Sessions</th>
              <SortableHead label="Status" sortKey="scheduleStatus" active={sortKey} desc={sortDesc} onSort={onSort} />
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const meta = SCHEDULE_STATUS_META[row.scheduleStatus];
              return (
                <tr key={row.id} className="hover:bg-muted transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-base" aria-hidden>{row.typeIcon}</span>{" "}
                    <span className="text-muted-foreground text-xs">{row.typeLabel}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    <Link href={row.editHref} className="hover:text-brand">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {row.departmentName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                    {formatDate(row.startsOn)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap hidden md:table-cell">
                    {formatDate(row.endsOn)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{row.sessionsCount}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={meta.className}>
                      {meta.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={row.editHref}
                        aria-label={`${openLabel} ${row.name}`}
                        title={openLabel}
                        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <OpenIcon className="size-3.5" />
                      </Link>
                      <a
                        href={row.previewHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Preview ${row.name}`}
                        title="Preview"
                        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="size-3.5" />
                      </a>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => onDuplicate(row)}
                            aria-label={`Duplicate ${row.name}`}
                            title="Duplicate"
                            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(row)}
                            aria-label={`Delete ${row.name}`}
                            title="Delete"
                            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>
      </div>
    </>
  );
}

/**
 * The phone layout for the same rows.
 *
 * Each card carries what the table's dropped columns carried — department,
 * dates, session count — as a wrapped line of facts, and then the four actions
 * as labelled, full-height targets rather than 14px icons. The actions are the
 * reason this exists: on the table they sat past the right edge of the screen.
 */
function ScheduleCards({
  rows,
  canEdit,
  onDuplicate,
  onDelete,
}: {
  rows: ScheduleListRow[];
  canEdit: boolean;
  onDuplicate: (row: ScheduleListRow) => void;
  onDelete: (row: ScheduleListRow) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const meta = SCHEDULE_STATUS_META[row.scheduleStatus];
        return (
          <Card key={row.id} className="gap-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <Link href={row.editHref} className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>
                    {row.typeIcon}
                  </span>
                  <span className="truncate font-medium text-foreground">{row.name}</span>
                </span>
              </Link>
              <Badge variant="outline" className={cn("shrink-0", meta.className)}>
                {meta.label}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {row.departmentName ? `${row.departmentName} · ` : ""}
              {formatDate(row.startsOn)} – {formatDate(row.endsOn)} ·{" "}
              {row.sessionsCount} {row.sessionsCount === 1 ? "session" : "sessions"}
            </p>

            <div className="-mx-1 flex items-center gap-1 pt-1">
              <Link
                href={row.editHref}
                className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-muted text-sm font-medium text-foreground"
              >
                {canEdit ? <Pencil className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
                {canEdit ? "Edit" : "Open"}
              </Link>
              <a
                href={row.previewHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Preview ${row.name}`}
                className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <Eye className="size-4" aria-hidden />
              </a>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => onDuplicate(row)}
                    aria-label={`Duplicate ${row.name}`}
                    className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    <Copy className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(row)}
                    aria-label={`Delete ${row.name}`}
                    className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function SortableHead({
  label,
  sortKey,
  active,
  desc,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  desc: boolean;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = active === sortKey;
  return (
    <th className={cn("px-4 py-2.5 font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        {isActive && (desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
      </button>
    </th>
  );
}
