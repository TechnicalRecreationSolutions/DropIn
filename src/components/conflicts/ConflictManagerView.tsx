"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Undo2,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { commandCentreHref, scheduleGroupScope } from "@/lib/schedule/commandCentreHref";
import type { ConflictParticipant, OrgConflict } from "./types";

interface ConflictManagerViewProps {
  initialConflicts: OrgConflict[];
}

export default function ConflictManagerView({ initialConflicts }: ConflictManagerViewProps) {
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [reassignTarget, setReassignTarget] = useState<{ conflict: OrgConflict; participant: ConflictParticipant } | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{ conflict: OrgConflict; participant: ConflictParticipant } | null>(null);

  async function refresh() {
    const res = await fetch("/api/conflicts");
    if (res.ok) {
      const { conflicts: next } = await res.json();
      setConflicts(next);
    }
  }

  const active = conflicts.filter((c) => !c.dismissed);
  const dismissed = conflicts.filter((c) => c.dismissed);

  if (conflicts.length === 0) {
    return (
      <div className="text-center py-16 bg-card rounded-xl border border-dashed border-border">
        <CheckCircle2 className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
        <h2 className="font-medium text-foreground mb-1">No conflicts</h2>
        <p className="text-sm text-muted-foreground">
          No two active sessions currently claim the same space at an overlapping time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {active.length === 0 && (
        <div className="text-center py-10 bg-card rounded-xl border border-dashed border-border">
          <CheckCircle2 className="w-8 h-8 text-muted-foreground/70 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No unresolved conflicts — everything below has been dismissed.</p>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map((c) => (
            <ConflictCard
              key={c.key}
              conflict={c}
              onRequestReassign={(participant) => setReassignTarget({ conflict: c, participant })}
              onRequestDeactivate={(participant) => setDeactivateTarget({ conflict: c, participant })}
              onDismissed={refresh}
            />
          ))}
        </div>
      )}

      {dismissed.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Dismissed ({dismissed.length})</h2>
          <div className="space-y-3">
            {dismissed.map((c) => (
              <ConflictCard
                key={c.key}
                conflict={c}
                onRequestReassign={(participant) => setReassignTarget({ conflict: c, participant })}
                onRequestDeactivate={(participant) => setDeactivateTarget({ conflict: c, participant })}
                onDismissed={refresh}
              />
            ))}
          </div>
        </div>
      )}

      <ReassignDialog target={reassignTarget} onCancel={() => setReassignTarget(null)} onDone={refresh} />
      <DeactivateDialog target={deactivateTarget} onCancel={() => setDeactivateTarget(null)} onDone={refresh} />
    </div>
  );
}

function ConflictCard({
  conflict,
  onRequestReassign,
  onRequestDeactivate,
  onDismissed,
}: {
  conflict: OrgConflict;
  onRequestReassign: (participant: ConflictParticipant) => void;
  onRequestDeactivate: (participant: ConflictParticipant) => void;
  onDismissed: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const canReassignInline = conflict.spaceIds.length === 1;

  function toggleDismiss() {
    startTransition(async () => {
      if (conflict.dismissed) {
        await fetch("/api/conflicts/dismiss", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionAId: conflict.sessionA.sessionId, sessionBId: conflict.sessionB.sessionId }),
        });
      } else {
        await fetch("/api/conflicts/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionAId: conflict.sessionA.sessionId, sessionBId: conflict.sessionB.sessionId }),
        });
      }
      onDismissed();
    });
  }

  return (
    <Card className={conflict.dismissed ? "p-4 gap-3 opacity-60" : "p-4 gap-3"}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 size-7 rounded-full bg-amber-50 flex items-center justify-center">
          <AlertTriangle className="size-3.5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            Both claim <span className="font-medium">{conflict.spaceNames.join(", ")}</span> starting{" "}
            <span className="font-medium">
              {conflict.occurrenceDate} around {conflict.occurrenceTime}
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={toggleDismiss} disabled={isPending}>
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : conflict.dismissed ? (
            <Undo2 className="size-3.5" />
          ) : (
            <Ban className="size-3.5" />
          )}
          {conflict.dismissed ? "Restore" : "Dismiss"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ParticipantBlock
          participant={conflict.sessionA}
          canReassign={canReassignInline}
          onReassign={() => onRequestReassign(conflict.sessionA)}
          onDeactivate={() => onRequestDeactivate(conflict.sessionA)}
        />
        <ParticipantBlock
          participant={conflict.sessionB}
          canReassign={canReassignInline}
          onReassign={() => onRequestReassign(conflict.sessionB)}
          onDeactivate={() => onRequestDeactivate(conflict.sessionB)}
        />
      </div>
    </Card>
  );
}

function ParticipantBlock({
  participant,
  canReassign,
  onReassign,
  onDeactivate,
}: {
  participant: ConflictParticipant;
  canReassign: boolean;
  onReassign: () => void;
  onDeactivate: () => void;
}) {
  const href = commandCentreHref(
    scheduleGroupScope({
      facility_id: participant.facilityId,
      department_id: participant.departmentId,
      id: participant.scheduleGroupId,
    })
  );

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-foreground">{participant.scheduleGroupName}</span>
        <Badge variant={participant.scheduleGroupStatus === "published" ? "default" : "secondary"}>
          {participant.scheduleGroupStatus === "published" ? "Published" : "Draft"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{participant.spaceNames.join(", ") || "No space"}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          <ExternalLink className="size-3" />
          Open
        </Link>
        {canReassign && (
          <button
            type="button"
            onClick={onReassign}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftRight className="size-3" />
            Move space
          </button>
        )}
        <button
          type="button"
          onClick={onDeactivate}
          className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
        >
          <Ban className="size-3" />
          Deactivate
        </button>
      </div>
    </div>
  );
}

function ReassignDialog({
  target,
  onCancel,
  onDone,
}: {
  target: { conflict: OrgConflict; participant: ConflictParticipant } | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [spaces, setSpaces] = useState<{ id: string; name: string }[] | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const participant = target?.participant ?? null;

  useEffect(() => {
    if (!participant) return;
    let cancelled = false;
    fetch(`/api/spaces?facilityId=${participant.facilityId}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const conflictingSpaceId = participant.spaceIds[0];
        setSpaces((body.spaces ?? []).filter((s: { id: string }) => s.id !== conflictingSpaceId));
      })
      .catch(() => {
        if (!cancelled) setSpaces([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.sessionId]);

  if (!target || !participant) return null;

  function handleClose(next: boolean) {
    if (next || isPending) return;
    onCancel();
    setSpaces(null);
    setSelectedSpaceId("");
    setError(null);
  }

  function handleConfirm() {
    if (!selectedSpaceId || !participant) return;
    setError(null);
    startTransition(async () => {
      const conflictingSpaceId = participant.spaceIds[0];
      const newSpaceIds = participant.spaceIds.map((id) => (id === conflictingSpaceId ? selectedSpaceId : id));
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: participant.sessionId,
          schedule_group_id: participant.scheduleGroupId,
          rrule: participant.rrule,
          dtstart: participant.dtstart,
          dtend_time: participant.dtendTime,
          valid_from: participant.validFrom,
          valid_until: participant.validUntil,
          space_ids: newSpaceIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not move this session.");
        return;
      }
      onDone();
      handleClose(false);
    });
  }

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move &ldquo;{participant.scheduleGroupName}&rdquo; to a different space</DialogTitle>
          <DialogDescription>
            This only changes the space for this one session — the day and time stay the same.
          </DialogDescription>
        </DialogHeader>

        {spaces === null ? (
          <p className="text-sm text-muted-foreground">Loading spaces…</p>
        ) : spaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other spaces at this facility to move it to.</p>
        ) : (
          <Select value={selectedSpaceId} onValueChange={setSelectedSpaceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a space" />
            </SelectTrigger>
            <SelectContent>
              {spaces.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !selectedSpaceId}>
            {isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Moving…
              </>
            ) : (
              "Move"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  target,
  onCancel,
  onDone,
}: {
  target: { conflict: OrgConflict; participant: ConflictParticipant } | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!target) return null;
  const { participant } = target;

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/sessions?sessionId=${participant.sessionId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not deactivate this session.");
        return;
      }
      onDone();
      onCancel();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !isPending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate this session?</DialogTitle>
          <DialogDescription>
            &ldquo;{participant.scheduleGroupName}&rdquo; will stop appearing on the public schedule and no longer
            claim {participant.spaceNames.join(", ") || "its space"}. This doesn&rsquo;t delete it — it can be
            reactivated later from the schedule.
          </DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

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
              "Deactivate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
