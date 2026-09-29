"use client";

import { useEffect, useState } from "react";
import { Undo2, Redo2, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { ScheduleBatchApi } from "./useScheduleBatch";

/**
 * What replaces the confirmation dialogs.
 *
 * Every write the canvas makes lands immediately, so this bar is the entire
 * account of what just happened: what changed, **how far it reached**, and one
 * key to take it back. The scope line is not decoration — a block on screen is
 * one occurrence of a recurring series, and "Moved Lengths Swimming" without
 * "every Tuesday" under it is the same silent series-wide edit the dialogs
 * existed to prevent.
 *
 * A success fades after a few seconds; an error does not, because an error is
 * the state of the schedule and not a notification about it.
 */
export default function CanvasUndoBar({ batch }: { batch: ScheduleBatchApi }) {
  const { status } = batch;
  /**
   * Which status the fade-out has already consumed, rather than a `visible`
   * flag. A flag would have to be *set* on every new status, from an effect,
   * which is a cascading render and a race — the bar would blink off and back
   * on when two edits land in the same tick. Recording the one number that was
   * hidden means a newer `seq` is visible by construction.
   */
  const [hiddenSeq, setHiddenSeq] = useState<number | null>(null);
  const visible = !!status && status.seq !== hiddenSeq;

  useEffect(() => {
    // An error is the state of the schedule, not a notification about it, so
    // it stays until it is dismissed or superseded.
    if (!status || status.error) return;
    const seq = status.seq;
    const timer = setTimeout(() => setHiddenSeq(seq), 7000);
    return () => clearTimeout(timer);
  }, [status]);

  if (!status || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(34rem,calc(100vw-2rem))]"
    >
      <div
        data-canvas-undo-bar={status.error ? "error" : status.destructive ? "destructive" : "ok"}
        className={cn(
          "flex items-start gap-3 rounded-banner border px-4 py-3 shadow-lg",
          status.error
            ? "border-transparent bg-destructive-subtle"
            : // A removal is not the same news as a move, and on a canvas that
              // writes without asking, this is the whole warning. Amber rather
              // than red: nothing has gone wrong, something has gone away.
              status.destructive
              ? "border-transparent bg-warning-subtle"
              : "border-border bg-card"
        )}
      >
        {(status.error || status.destructive) && (
          <AlertTriangle
            className={cn(
              "w-4 h-4 mt-0.5 flex-shrink-0",
              status.error ? "text-destructive" : "text-warning"
            )}
          />
        )}

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-semibold leading-tight truncate",
              status.error
                ? "text-destructive"
                : status.destructive
                  ? "text-warning"
                  : "text-foreground"
            )}
          >
            {status.label}
          </p>
          {status.error ? (
            <p className="text-xs text-destructive mt-0.5">{status.error}</p>
          ) : (
            status.scope && <p className="text-xs text-muted-foreground mt-0.5">{status.scope}</p>
          )}
          {status.timesIgnored && !status.error && (
            <p className="text-xs text-warning mt-1">
              The time was not changed — this session runs the whole time its department is open.
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => batch.undo()}
            disabled={!batch.canUndo || batch.busy}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => batch.redo()}
            disabled={!batch.canRedo || batch.busy}
            aria-label="Redo (Ctrl+Shift+Z)"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => {
              setHiddenSeq(status.seq);
              batch.dismiss();
            }}
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
