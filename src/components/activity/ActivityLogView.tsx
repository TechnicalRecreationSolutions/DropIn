"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ActivityEntry, ActivityTable } from "./types";

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
}

export default function ActivityLogView({ initialEntries, initialCursor, canRevert }: ActivityLogViewProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revertTarget, setRevertTarget] = useState<ActivityEntry | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/activity?before=${encodeURIComponent(cursor)}`);
      if (res.ok) {
        const { entries: more, nextCursor } = await res.json();
        setEntries((prev) => [...prev, ...more]);
        setCursor(nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function onReverted(id: string) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, reverted_at: new Date().toISOString() } : e))
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h2 className="font-medium text-gray-900 mb-1">No activity yet</h2>
        <p className="text-sm text-gray-500">
          Changes to facilities, schedules and sessions will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-gray-100 py-0">
        {entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={entry}
            canRevert={canRevert}
            onRequestRevert={() => setRevertTarget(entry)}
          />
        ))}
      </Card>

      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <RevertDialog entry={revertTarget} onCancel={() => setRevertTarget(null)} onReverted={onReverted} />
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
