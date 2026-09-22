"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SCHEDULE_RANGE_KEY } from "@/hooks/useScheduleRange";
import type { ExpandedSession } from "@/types/schedule.types";

/**
 * The undo stack behind direct manipulation.
 *
 * Every gesture on the canvas posts a list of ops to `/api/sessions/batch` and
 * gets back the list that undoes it, computed from the rows as they actually
 * were. This hook does nothing clever with that: it pushes the pair onto a
 * stack, and undo posts the other half.
 *
 * ## Why the inverse is never computed here
 *
 * It would be easy, and wrong. The client knows what it *drew*, not what was
 * stored — those differ the moment a following session's times are discarded
 * server-side (058), a paste lands on hours the department resolves itself, or
 * a colleague saves the same session in between. An undo built from the local
 * guess would write that guess back over their work and call it a revert.
 *
 * ## Redo is just undo again
 *
 * Posting the undo returns *its* inverse, which is a valid redo by
 * construction. Nothing here has to reason about what redoing means.
 *
 * ## Why it also owns the cache
 *
 * A gesture has to land at pointer-up. Waiting for the write, then an
 * invalidate, then a refetch means the block sits in its old position for a few
 * hundred milliseconds and then jumps — which reads as a drag that failed and
 * somehow worked anyway, and is the single thing that most makes a canvas feel
 * like a form.
 *
 * So each entry carries an `optimistic` transform over the cached
 * `ExpandedSession[]`, applied before the request goes out and rolled back from
 * a snapshot if it is refused. Undo and redo do not need transforms of their
 * own: the snapshot taken either side of the original edit *is* the state to
 * put back, so they restore rather than recompute. The server's answer still
 * arrives and still wins — the invalidate at the end is what reconciles an
 * optimistic guess with what was actually stored (a following session's times
 * discarded, a lane collapsed into one it already held).
 */

export type BatchOp = Record<string, unknown> & { kind: string };

export interface BatchEntry {
  /** What the undo bar says happened, e.g. "Moved Lengths Swimming to Thursday". */
  label: string;
  /** How wide the edit reached, e.g. "every Tuesday" — shown under the label. */
  scope?: string;
  ops: BatchOp[];
  /**
   * True when the gesture removed something. The bar says so differently,
   * because "Removed Lengths Swimming — the whole recurring series" and
   * "Moved Lengths Swimming — every Tuesday" are not the same news, and on a
   * canvas that writes without asking, the difference is the only warning
   * there is.
   */
  destructive?: boolean;
  /**
   * The same change, applied to the cached week so the canvas redraws at
   * pointer-up. Must describe what the SERVER will do, not what the pointer
   * did: a time drag moves every occurrence of the series, while the day
   * change lands on the dragged occurrence alone.
   */
  optimistic?: (sessions: ExpandedSession[]) => ExpandedSession[];
}

/** Every cached range, as it stood — enough to put the canvas back. */
type CacheSnapshot = [readonly unknown[], ExpandedSession[] | undefined][];

interface HistoryEntry {
  label: string;
  scope?: string;
  /** The ops that reverse this entry. Posting them yields the ops that redo it. */
  inverse: BatchOp[];
  /** The cache as it will look once `inverse` has been applied. */
  targetCache: CacheSnapshot;
}

export interface BatchStatus {
  label: string;
  scope?: string;
  destructive?: boolean;
  /** Set when the last attempt failed; the bar turns into an error instead. */
  error: string | null;
  /**
   * 058: the times in the gesture were dropped because the session takes them
   * from its department's operating hours. Said out loud, or the block snapping
   * back to its old row reads as a failed drag.
   */
  timesIgnored?: boolean;
  /** Bumped on every status change so the bar can re-run its auto-dismiss. */
  seq: number;
}

interface BatchResponse {
  ok?: boolean;
  inverse?: BatchOp[];
  error?: string;
  timesIgnored?: boolean;
  rolledBack?: boolean;
  appliedBeforeFailure?: number;
}

export interface ScheduleBatchApi {
  /** Applies a gesture. Resolves true when it landed. */
  run: (entry: BatchEntry) => Promise<boolean>;
  /** Shows a refusal the client decided on its own, without a round trip. */
  reportError: (label: string, error: string) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  status: BatchStatus | null;
  dismiss: () => void;
}

export function useScheduleBatch(onChanged: () => void): ScheduleBatchApi {
  const queryClient = useQueryClient();
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const seq = useRef(0);
  /** One undo or redo at a time — see the note in `step`. */
  const inFlight = useRef(false);

  /** Every cached range at once — the same prefix every mutation invalidates. */
  const snapshot = useCallback(
    (): CacheSnapshot => queryClient.getQueriesData<ExpandedSession[]>({ queryKey: [SCHEDULE_RANGE_KEY] }),
    [queryClient]
  );

  const restore = useCallback(
    (snap: CacheSnapshot) => {
      for (const [key, data] of snap) queryClient.setQueryData(key, data);
    },
    [queryClient]
  );

  const applyOptimistic = useCallback(
    (transform: (sessions: ExpandedSession[]) => ExpandedSession[]) => {
      queryClient.setQueriesData<ExpandedSession[]>({ queryKey: [SCHEDULE_RANGE_KEY] }, (old) =>
        old ? transform(old) : old
      );
    },
    [queryClient]
  );

  const post = useCallback(async (ops: BatchOp[]): Promise<BatchResponse> => {
    const res = await fetch("/api/sessions/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    });
    const data = (await res.json().catch(() => ({}))) as BatchResponse;
    if (!res.ok) {
      return {
        ...data,
        error:
          data.error ??
          (res.status === 409
            ? "That overlaps another session in the same space."
            : "Could not apply this change."),
      };
    }
    return data;
  }, []);

  const fail = useCallback((label: string, data: BatchResponse) => {
    seq.current += 1;
    // A rollback that itself failed is the one case where the schedule on
    // screen is not the schedule in the database, so it is never folded into
    // the ordinary error text.
    const suffix =
      data.rolledBack === false && (data.appliedBeforeFailure ?? 0) > 0
        ? " Some of this change was applied and could not be rolled back — reload before editing further."
        : "";
    setStatus({ label, error: (data.error ?? "Could not apply this change.") + suffix, seq: seq.current });
  }, []);

  const run = useCallback(
    async (entry: BatchEntry) => {
      if (entry.ops.length === 0) return true;

      // Taken before the optimistic paint, so it is both the rollback for a
      // refusal and the state Undo will put back.
      const before = snapshot();
      if (entry.optimistic) applyOptimistic(entry.optimistic);

      setBusy(true);
      const data = await post(entry.ops);
      setBusy(false);

      if (!data.ok) {
        restore(before);
        fail(entry.label, data);
        return false;
      }

      seq.current += 1;
      setPast((p) => [
        ...p,
        { label: entry.label, scope: entry.scope, inverse: data.inverse ?? [], targetCache: before },
      ]);
      // A new edit makes every redo unreachable, same as any text editor.
      setFuture([]);
      setStatus({
        label: entry.label,
        scope: entry.scope,
        destructive: entry.destructive,
        error: null,
        timesIgnored: data.timesIgnored,
        seq: seq.current,
      });
      onChanged();
      return true;
    },
    [post, fail, onChanged, snapshot, restore, applyOptimistic]
  );

  const step = useCallback(
    async (from: HistoryEntry[], verb: "Undid" | "Redid", move: (entry: HistoryEntry) => void) => {
      const entry = from[from.length - 1];
      if (!entry) return;

      // Held Ctrl-Z repeats at the OS key rate, and `past` does not shrink
      // until the first request answers — so without this the same entry is
      // undone two or three times, each posting the same inverse against a
      // schedule that has already moved. The stack is not a queue, so the fix
      // is to refuse the overlap rather than to serialise it.
      if (inFlight.current) return;
      inFlight.current = true;

      // No transform to recompute: the snapshot either side of the original
      // edit is exactly what undoing and redoing it produce.
      const current = snapshot();
      restore(entry.targetCache);

      setBusy(true);
      const data = await post(entry.inverse);
      setBusy(false);
      inFlight.current = false;

      if (!data.ok) {
        restore(current);
        fail(`${verb === "Undid" ? "Undo" : "Redo"} failed`, data);
        return;
      }

      seq.current += 1;
      move({
        label: entry.label,
        scope: entry.scope,
        inverse: data.inverse ?? [],
        targetCache: current,
      });
      setStatus({ label: `${verb} · ${entry.label}`, error: null, seq: seq.current });
      onChanged();
    },
    [post, fail, onChanged, snapshot, restore]
  );

  const undo = useCallback(async () => {
    await step(past, "Undid", (redoEntry) => {
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [...f, redoEntry]);
    });
  }, [past, step]);

  const redo = useCallback(async () => {
    await step(future, "Redid", (undoEntry) => {
      setFuture((f) => f.slice(0, -1));
      setPast((p) => [...p, undoEntry]);
    });
  }, [future, step]);

  const reportError = useCallback((label: string, error: string) => {
    seq.current += 1;
    setStatus({ label, error, seq: seq.current });
  }, []);

  return {
    run,
    reportError,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    busy,
    status,
    dismiss: () => setStatus(null),
  };
}
