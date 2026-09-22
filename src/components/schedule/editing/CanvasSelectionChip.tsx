"use client";

import { MousePointerSquareDashed } from "lucide-react";
import type { ScheduleCanvasApi } from "./ScheduleCanvasContext";

/**
 * The one piece of the editing help that has to stay on the page: what is
 * selected right now.
 *
 * Everything static about the gestures moved into the week panel's "How to
 * edit" tab, because a reference list is read once and then in the way. This
 * is the opposite — it changes with every click, and a number you have to open
 * a drawer to read is a number nobody reads. It sits in the toolbar strip
 * above the grid, on one line, and disappears entirely when nothing is
 * selected so an idle canvas stays quiet.
 *
 * `data-canvas-selection-count` is the hook `verify-aw` reads; keep it.
 */
export default function CanvasSelectionChip({ canvas }: { canvas: ScheduleCanvasApi }) {
  const count = canvas.selectedSessionIds.size;
  const quiet = count === 0 && !canvas.hasClipboard;

  return (
    // The wrapper renders even when there is nothing to say, so the count is
    // always readable — by a harness, and by anything else that wants to know
    // the canvas is idle rather than missing. Only its contents are
    // conditional, so an idle toolbar still shows nothing.
    <span
      data-canvas-selection-count={count}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {!quiet && <MousePointerSquareDashed className="w-3.5 h-3.5 shrink-0" />}
      {count > 0 && <span className="font-medium text-foreground">{count} selected</span>}
      {count > 0 && (
        <span className="hidden sm:inline">
          · <Key>Ctrl</Key>
          <Key>C</Key> copy · <Key>Del</Key> remove
        </span>
      )}
      {canvas.hasClipboard && (
        <span className="text-blue-700 dark:text-blue-400">
          {count > 0 && " · "}clipboard ready — click a lane, then <Key>Ctrl</Key>
          <Key>V</Key>
        </span>
      )}
    </span>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 px-1 py-0.5 rounded border border-border bg-card text-[10px] font-semibold">
      {children}
    </kbd>
  );
}
