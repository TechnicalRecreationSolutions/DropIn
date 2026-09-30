"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Plus, Pencil, Trash2, Eye, EyeOff, Calendar, LayoutGrid, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";

export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  is_published: boolean;
  /** Schedules and spaces filed under this department, for the card's stats. */
  schedule_count: number;
  space_count: number;
  /** summarizeWeek() of its operating hours, or null when none are set. */
  week_summary: string | null;
}

interface DepartmentsPanelProps {
  facility: { id: string; name: string };
  departments: DepartmentRow[];
}

/**
 * The dedicated Departments page's grid.
 *
 * Was a stack of full-width rows: a name, an optional description, a status
 * pill, and two icon buttons. It read as a settings table — nothing on it said
 * what a department *had*, so picking one meant opening it to find out, and
 * the only thing a click could do was edit.
 *
 * Now the same cards the Facilities grid uses, one step smaller: the card body
 * opens that department's schedule (the thing people actually came for), the
 * stats say how much is in it, and the footer is a call to action — operating
 * hours, which is the one piece of setup a department can silently be missing
 * and the one that stops sessions running "the whole time we're open".
 */
export default function DepartmentsPanel({ facility, departments }: DepartmentsPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Not an error — something that happened and that nobody else will mention. */
  const [notice, setNotice] = useState<string | null>(null);

  async function handleDelete(department: DepartmentRow) {
    if (!confirm(`Delete "${department.name}"? Schedules in it keep their sessions but lose this grouping.`)) {
      return;
    }

    setError(null);
    setNotice(null);
    setDeletingId(department.id);

    const res = await fetch(`/api/departments/${department.id}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not delete department.");
      setDeletingId(null);
      return;
    }

    // Who just lost all their access (migration 055 §5.3). The cascade is
    // correct and completely silent — the only signal anyone gets is this one.
    const { stranded } = (await res.json().catch(() => ({}))) as { stranded?: string[] };
    if (stranded?.length) {
      const one = stranded.length === 1;
      setNotice(
        `${stranded.join(", ")} ${one ? "was" : "were"} assigned only to this ` +
          `department, so ${one ? "that account" : "those accounts"} can no longer ` +
          `see anything. Assign another department on the Staff page.`
      );
    }

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    setDeletingId(null);
    router.refresh();
  }

  const newDepartmentHref = `/dashboard/facilities/${facility.id}/departments/new`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {/* Which building these cards belong to. The explanation of what a
            department IS lives in the page header's (i) — repeating it here
            cost four lines of a phone screen above the first card. */}
        <p className="truncate text-sm text-muted-foreground">
          In <span className="font-medium text-foreground">{facility.name}</span>
        </p>
        <Button asChild className="shrink-0">
          <Link href={newDepartmentHref}>
            <Plus className="w-4 h-4" />
            Add department
          </Link>
        </Button>
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      {/* Not an error — the delete worked. This is the only place anyone is
          told that a coordinator just lost all their access to it. */}
      {notice && (
        <Banner variant="warning" role="status">
          {notice}
        </Banner>
      )}

      {departments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          titleAs="h2"
          description={<>Optional. Group related schedules, such as &quot;Aquatics&quot; or &quot;Fitness&quot;.</>}
          action={
            <Button asChild variant="outline">
              <Link href={newDepartmentHref}>
                <Plus className="w-4 h-4" />
                Add a department
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((department) => (
            <DepartmentCard
              key={department.id}
              facilityId={facility.id}
              department={department}
              deleting={deletingId === department.id}
              onDelete={() => handleDelete(department)}
            />
          ))}

          {/* The last tile, rather than only the button in the header: on a
              phone the header scrolls away, and "one more" is the action
              someone is most likely to want after reading the grid. */}
          <Link
            href={newDepartmentHref}
            className="flex min-h-[7rem] flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-input p-4 text-center text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-5" />
            Add department
          </Link>
        </div>
      )}
    </div>
  );
}

interface DepartmentCardProps {
  facilityId: string;
  department: DepartmentRow;
  deleting: boolean;
  onDelete: () => void;
}

function DepartmentCard({ facilityId, department, deleting, onDelete }: DepartmentCardProps) {
  const editHref = `/dashboard/facilities/${facilityId}/departments/${department.id}/edit`;
  const hasHours = !!department.week_summary;

  return (
    <div
      data-department-card={department.name}
      className={cn(
        "relative flex flex-col rounded-card border border-border bg-card shadow-card transition-colors duration-150",
        "hover:border-input",
        deleting && "opacity-50"
      )}
    >
      {/* The card body goes to the schedule, not to this page's own editor —
          seeing what is in a department is the reason to click one. Editing is
          the pencil, exactly as on the Facilities grid. */}
      <Link href={commandCentreHref({ facilityId, departmentId: department.id })} className="block flex-1 rounded-t-card p-5 pr-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <div className="flex items-start gap-2">
          <Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate text-card-title text-foreground">{department.name}</h3>
        </div>

        {department.description ? (
          <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">{department.description}</p>
        ) : (
          <p className="mt-1 text-caption text-muted-foreground">No description</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3.5" />
            {department.schedule_count} schedule{department.schedule_count === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <LayoutGrid className="size-3.5" />
            {department.space_count} space{department.space_count === 1 ? "" : "s"}
          </span>
          {department.is_published ? (
            <Badge variant="success">
              <Eye /> Published
            </Badge>
          ) : (
            <Badge>
              <EyeOff /> Draft
            </Badge>
          )}
        </div>
      </Link>

      <div className="absolute right-3 top-3 flex items-center gap-0.5">
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
          <Link href={editHref} aria-label={`Edit ${department.name}`}>
            <Pencil className="size-4" />
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete ${department.name}`}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {/* The one piece of setup a department can be silently missing. A
          department with no hours cannot offer "runs the whole time we're
          open" to any of its sessions, and nothing else on this page says so. */}
      <Link
        href={`${editHref}#hours`}
        className={cn(
          "flex items-center gap-1.5 rounded-b-card border-t border-border px-5 py-2.5 text-caption transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          hasHours
            ? "text-muted-foreground hover:bg-muted"
            : "bg-warning-subtle font-medium text-warning hover:underline"
        )}
      >
        <Clock className="size-3.5 shrink-0" />
        <span className="truncate">{hasHours ? department.week_summary : "Set operating hours"}</span>
      </Link>
    </div>
  );
}
