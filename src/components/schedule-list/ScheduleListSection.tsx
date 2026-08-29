"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Eye, Copy, Trash2, ChevronDown, ChevronUp, ChevronRight, CalendarX2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
        <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                filter === f.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Link
          href={newScheduleHref}
          className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          + New schedule
        </Link>
      </div>

      {mutateError && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {mutateError}
        </p>
      )}

      {filteredCurrent.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <CalendarX2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {rows.length === 0
              ? (emptyMessage ?? `${facilityName} has no schedules yet.`)
              : "Nothing matches this filter."}
          </p>
          {rows.length === 0 && !emptyMessage && (
            <Link
              href={newScheduleHref}
              className="inline-block mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
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
          onDuplicate={setDuplicating}
          onDelete={setDeleting}
        />
      )}

      {stored.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setStoredOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600"
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
  onDuplicate: (row: ScheduleListRow) => void;
  onDelete: (row: ScheduleListRow) => void;
}

function ScheduleTable({ rows, sortKey, sortDesc, onSort, onDuplicate, onDelete }: ScheduleTableProps) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
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
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => {
              const meta = SCHEDULE_STATUS_META[row.scheduleStatus];
              return (
                <tr key={row.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-base" aria-hidden>{row.typeIcon}</span>{" "}
                    <span className="text-gray-500 text-xs">{row.typeLabel}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link href={row.editHref} className="hover:text-blue-600">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {row.departmentName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap hidden sm:table-cell">
                    {formatDate(row.startsOn)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap hidden md:table-cell">
                    {formatDate(row.endsOn)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{row.sessionsCount}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={meta.className}>
                      {meta.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={row.editHref}
                        aria-label={`Edit ${row.name}`}
                        title="Edit"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600"
                      >
                        <Pencil className="size-3.5" />
                      </Link>
                      <a
                        href={row.previewHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Preview ${row.name}`}
                        title="Preview"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600"
                      >
                        <Eye className="size-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => onDuplicate(row)}
                        aria-label={`Duplicate ${row.name}`}
                        title="Duplicate"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600"
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        aria-label={`Delete ${row.name}`}
                        title="Delete"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
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
          "inline-flex items-center gap-1 hover:text-gray-700",
          isActive ? "text-gray-700" : "text-gray-400"
        )}
      >
        {label}
        {isActive && (desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
      </button>
    </th>
  );
}
