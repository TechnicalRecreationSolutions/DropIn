"use client";

import { useEffect } from "react";
import type { ScheduleCanvasApi } from "./ScheduleCanvasContext";
import { SNAP_MINUTES } from "@/lib/schedule/gridEdits";

/** One press moves one grid step — the same grain a drag snaps to. */
const ARROWS: Record<string, { minutes?: number; lanes?: number }> = {
  ArrowUp: { minutes: -SNAP_MINUTES },
  ArrowDown: { minutes: SNAP_MINUTES },
  ArrowLeft: { lanes: -1 },
  ArrowRight: { lanes: 1 },
};

/**
 * The spreadsheet keys, bound at the window.
 *
 * Bound at the window rather than on the canvas element because the canvas is
 * a scrolling region of absolutely-positioned blocks, and requiring it to hold
 * DOM focus would mean Ctrl-C stopped working the moment someone clicked the
 * week navigator. `shouldIgnore` is what keeps that safe: every one of these
 * keys means something else inside an input, and a dialog is open over the
 * canvas for most of the editing this app does.
 */
export function useCanvasKeyboard(canvas: ScheduleCanvasApi | null) {
  useEffect(() => {
    if (!canvas?.enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!canvas) return;
      if (shouldIgnore(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        // Shift-Z as redo alongside Ctrl-Y: the first is what macOS and every
        // editor on it use, the second is what Windows users reach for.
        if (event.shiftKey) void canvas.batch.redo();
        else void canvas.batch.undo();
        return;
      }

      if (mod && key === "y") {
        event.preventDefault();
        void canvas.batch.redo();
        return;
      }

      if (mod && key === "c") {
        event.preventDefault();
        canvas.copy();
        return;
      }

      if (mod && key === "x") {
        event.preventDefault();
        canvas.cut();
        return;
      }

      if (mod && key === "v") {
        event.preventDefault();
        void canvas.paste();
        return;
      }

      if (mod && key === "d") {
        event.preventDefault();
        void canvas.duplicateBelow();
        return;
      }

      if (mod && key === "a") {
        event.preventDefault();
        canvas.selectAll();
        return;
      }

      // Arrows are the keyboard's drag. Only claimed while something is
      // selected — otherwise they must keep scrolling the page, which is what
      // someone reading the schedule is using them for.
      const arrow = ARROWS[event.key];
      if (arrow && canvas.selectedIds.size > 0) {
        event.preventDefault();
        if (arrow.lanes) {
          void canvas.nudgeSelection({ lanes: arrow.lanes });
          return;
        }
        // Shift turns the vertical pair into a resize of the bottom edge,
        // which is the edge a schedule is nearly always adjusted from — a
        // block usually starts when it starts and runs longer or shorter.
        void canvas.nudgeSelection(
          event.shiftKey
            ? { minutes: arrow.minutes, edge: "end" }
            : { minutes: arrow.minutes }
        );
        return;
      }

      if (key === "delete" || key === "backspace") {
        if (canvas.selectedIds.size === 0) return;
        event.preventDefault();
        void canvas.deleteSelected();
        return;
      }

      if (key === "escape") {
        canvas.clearSelection();
        canvas.batch.dismiss();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvas]);
}

/**
 * Whether this keystroke belongs to something other than the canvas.
 *
 * The document-wide check is the load-bearing half, not the element one. A
 * dialog open over the canvas usually has **nothing focused inside it** — the
 * session detail modal opens with focus still on `body` — so asking whether
 * the event *target* sits inside a dialog answers "no" while a dialog is very
 * much in the way. The canvas would then copy, paste or delete underneath it,
 * and Escape would clear a selection nobody can see instead of closing the
 * thing in front of them.
 */
function shouldIgnore(target: EventTarget | null): boolean {
  if (typeof document !== "undefined" && document.querySelector('[role="dialog"], [role="alertdialog"]')) {
    return true;
  }
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!target.closest('[role="menu"], [role="listbox"]');
}
