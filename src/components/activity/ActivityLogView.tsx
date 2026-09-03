"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Building2,
  Layers,
  DoorOpen,
  CalendarDays,
  Clock,
  LayoutTemplate,
  Plus,
  Pencil,
  Trash2,
  Undo2,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ActivityEntry, ActivityTable } from "./types";

/** Sentinel select value for "no filter applied at this tier". */
const ALL = "__all__";

type ActionFilter = "insert" | "update" | "delete";

const TABLE_META: Record<ActivityTable, { label: string; icon: typeof Building2 }> = {
  facilities: { label: "Facility", icon: Building2 },
  departments: { label: "Department", icon: Layers },
  spaces: { label: "Space", icon: DoorOpen },
  schedule_groups: { label: "Schedule", icon: CalendarDays },
  sessions: { label: "Session", icon: Clock },
  session_templates: { label: "Session template", icon: LayoutTemplate },
};

const ACTION_META = {
  insert: { verb: "created", icon: Plus, undoVerb: "Undo create" },
  update: { verb: "updated", icon: Pencil, undoVerb: "Revert" },
  delete: { verb: "deleted", icon: Trash2, undoVerb: "Restore" },
} as const;

interface ActivityLogViewProps {
  initialEntries: ActivityEntry[];
  initialCursor: string | null;
  canRevert: boolean;
  actors: string[];
}

export default function ActivityLogView({ initialEntries, initialCursor, canRevert, actors }: ActivityLogViewProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingFiltered, setLoadingFiltered] = useState(false);
  const [revertTarget, setRevertTarget] = useState<ActivityEntry | null>(null);

  const [tableFilter, setTableFilter] = useState<ActivityTable | typeof ALL>(ALL);
  const [actionFilter, setActionFilter] = useState<ActionFilter | typeof ALL>(ALL);
  const [actorFilter, setActorFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the free-text search so it doesn't refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const hasFilters = tableFilter !== ALL || actionFilter !== ALL || actorFilter !== ALL || debouncedSearch !== "";

  function buildParams(before?: string) {
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    if (tableFilter !== ALL) params.set("table", tableFilter);
    if (actionFilter !== ALL) params.set("action", actionFilter);
    if (actorFilter !== ALL) params.set("actor", actorFilter);
    if (debouncedSearch) params.set("q", debouncedSearch);
    return params;
  }

  // Re-fetch from scratch whenever a filter changes — a cursor from an
  // unfiltered (or differently-filtered) page isn't valid for a new query.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    let cancelled = false;
    setLoadingFiltered(true);
    fetch(`/api/activity?${buildParams().toString()}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setEntries(body.entries ?? []);
        setCursor(body.nextCursor ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoadingFiltered(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFilter, actionFilter, actorFilter, debouncedSearch]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/activity?${buildParams(cursor).toString()}`);
      if (res.ok) {
        const { entries: more, nextCursor } = await res.json();
        setEntries((prev) => [...prev, ...more]);
        setCursor(nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setTableFilter(ALL);
    setActionFilter(ALL);
    setActorFilter(ALL);
    setSearch("");
  }

  function onReverted(id: string) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, reverted_at: new Date().toISOString() } : e))
    );
  }

  return (
    <div className="space-y-4">
      <FilterBar
        tableFilter={tableFilter}
        onTableFilter={setTableFilter}
        actionFilter={actionFilter}
        onActionFilter={setActionFilter}
        actorFilter={actorFilter}
        onActorFilter={setActorFilter}
        actors={actors}
        search={search}
        onSearch={setSearch}
        hasFilters={hasFilters}
        onClear={clearFilters}
      />

      {entries.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h2 className="font-medium text-gray-900 mb-1">{hasFilters ? "No matching activity" : "No activity yet"}</h2>
          <p className="text-sm text-gray-500">
            {hasFilters
              ? "Try a different filter or search term."
              : "Changes to facilities, schedules and sessions will show up here."}
          </p>
        </div>
      ) : (
        <Card className={`divide-y divide-gray-100 py-0 ${loadingFiltered ? "opacity-60" : ""}`}>
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              canRevert={canRevert}
              onRequestRevert={() => setRevertTarget(entry)}
            />
          ))}
        </Card>
      )}

      {cursor && entries.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore || loadingFiltered}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <RevertDialog entry={revertTarget} onCancel={() => setRevertTarget(null)} onReverted={onReverted} />
    </div>
  );
}

function FilterBar({
  tableFilter,
  onTableFilter,
  actionFilter,
  onActionFilter,
  actorFilter,
  onActorFilter,
  actors,
  search,
  onSearch,
  hasFilters,
  onClear,
}: {
  tableFilter: ActivityTable | typeof ALL;
  onTableFilter: (v: ActivityTable | typeof ALL) => void;
  actionFilter: ActionFilter | typeof ALL;
  onActionFilter: (v: ActionFilter | typeof ALL) => void;
  actorFilter: string;
  onActorFilter: (v: string) => void;
  actors: string[];
  search: string;
  onSearch: (v: string) => void;
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[160px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name…"
          className="pl-8"
        />
      </div>

      <Select
        value={tableFilter}
        onValueChange={(v) => onTableFilter(v as ActivityTable | typeof ALL)}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {(Object.keys(TABLE_META) as ActivityTable[]).map((t) => (
            <SelectItem key={t} value={t}>
              {TABLE_META[t].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={actionFilter}
        onValueChange={(v) => onActionFilter(v as ActionFilter | typeof ALL)}
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Action" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All actions</SelectItem>
          <SelectItem value="insert">Created</SelectItem>
          <SelectItem value="update">Updated</SelectItem>
          <SelectItem value="delete">Deleted</SelectItem>
        </SelectContent>
      </Select>

      {actors.length > 0 && (
        <Select value={actorFilter} onValueChange={onActorFilter}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Who" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everyone</SelectItem>
            {actors.map((email) => (
              <SelectItem key={email} value={email}>
                {email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-gray-500">
          <X className="size-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}

function ActivityRow({
  entry,
  canRevert,
  onRequestRevert,
}: {
  entry: ActivityEntry;
  canRevert: boolean;
  onRequestRevert: () => void;
}) {
  const table = TABLE_META[entry.table_name];
  const action = ACTION_META[entry.action];
  const TableIcon = table?.icon ?? Clock;
  const ActionIcon = action.icon;
  const label = entry.entity_label ?? "(untitled)";
  const actor = entry.actor_email ?? "System";

  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className="mt-0.5 shrink-0 size-7 rounded-full bg-gray-100 flex items-center justify-center">
        <TableIcon className="size-3.5 text-gray-500" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900">
          <span className="font-medium">{actor}</span>{" "}
          <span className="text-gray-500">{action.verb}</span>{" "}
          <span className="font-medium">{label}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className="gap-1">
            <ActionIcon className="size-3" />
            {table?.label ?? entry.table_name}
          </Badge>
          <span className="text-xs text-gray-400" title={new Date(entry.created_at).toLocaleString()}>
            {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
          </span>
          {entry.reverted_at && (
            <Badge variant="secondary">Reverted</Badge>
          )}
        </div>
        {entry.action === "update" && entry.changed_fields && entry.changed_fields.length > 0 && (
          <p className="mt-1 text-xs text-gray-400 truncate">
            Changed: {entry.changed_fields.join(", ")}
          </p>
        )}
      </div>

      {canRevert && !entry.reverted_at && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onRequestRevert}>
          <Undo2 className="size-3.5" />
          {action.undoVerb}
        </Button>
      )}
    </div>
  );
}

function RevertDialog({
  entry,
  onCancel,
  onReverted,
}: {
  entry: ActivityEntry | null;
  onCancel: () => void;
  onReverted: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!entry) return null;

  const table = TABLE_META[entry.table_name];
  const action = ACTION_META[entry.action];

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/activity/${entry!.id}/revert`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not revert this change.");
        return;
      }
      onReverted(entry!.id);
      onCancel();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !isPending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.undoVerb} &ldquo;{entry.entity_label ?? "this item"}&rdquo;?</DialogTitle>
          <DialogDescription>
            {entry.action === "insert" &&
              `This removes the ${table?.label.toLowerCase() ?? "item"} that was created. Anything added under it since won't be restored automatically.`}
            {entry.action === "update" &&
              `This restores every field of this ${table?.label.toLowerCase() ?? "item"} to what it was before this change, not just the fields listed.`}
            {entry.action === "delete" &&
              `This restores the ${table?.label.toLowerCase() ?? "item"} as it was right before it was deleted. If other things were deleted along with it, they won't come back automatically — each has its own entry in the log to revert.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Working…
              </>
            ) : (
              action.undoVerb
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
