"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { DAYS, timeStringToMinutes, minutesToTimeString, sessionDayIndex } from "@/lib/schedule/weekGeometry";
import { sessionDateString } from "@/lib/utils/dates";
import {
  MIN_DURATION_MINUTES,
  clampMinute,
  moveSpan,
  resizeSpan,
  snap,
  type ResizeEdge,
} from "@/lib/schedule/gridEdits";
import type { BatchOp, ScheduleBatchApi } from "./useScheduleBatch";

/**
 * Spreadsheet selection, clipboard and gestures for the lane-by-time canvas.
 *
 * `ScheduleEditingContext` answers "may this view be edited, and through which
 * dialogs". This answers the separate question direct manipulation raises:
 * *what is currently selected, and what does the next gesture do to it*. They
 * are deliberately two contexts — a surface can be editable without being a
 * canvas (the list and grid views open dialogs and have no cells), and keeping
 * selection out of the editing API means the widget's read-only render path is
 * untouched by any of this.
 *
 * ## A block is not a session
 *
 * A session occupying Lanes 1-4 renders four blocks. Selecting one and
 * pressing Delete must delete the session once, not four times, so every
 * gesture folds its selection down to distinct `sessionId`s before building
 * ops. What the *block* identity is still needed for is the lane a gesture
 * started in: dragging the Lane 2 block to Lane 6 means "replace Lane 2", and
 * without the block there is no way to know which of the four was grabbed.
 *
 * ## Cells are (column, minute), and the day is the surface's
 *
 * The canvas shows one day. That is what makes paste expressible — a copied
 * range keeps its lane and minute offsets and lands relative to the active
 * cell, exactly as a spreadsheet does — and it is why the surface has to tell
 * this context its column order and date rather than the other way round.
 */

/**
 * How long arrow presses are gathered before one write goes out.
 *
 * Long enough to absorb a key held at the OS repeat rate, short enough that a
 * single deliberate press still feels immediate.
 */
const NUDGE_COALESCE_MS = 140;

export interface CanvasColumn {
  /** Null for the free-text and "General" columns, which own no space row. */
  spaceId: string | null;
  name: string;
}

export interface CanvasBlock {
  /** `${session.key}::${column key}` — unique per drawn block, not per session. */
  id: string;
  session: ExpandedSession;
  columnIndex: number;
  spaceId: string | null;
  startMinute: number;
  endMinute: number;
}

export interface CanvasSurface {
  /** iCal code of the day on screen. */
  dayCode: string;
  /** YYYY-MM-DD of the day on screen — what a this-week-only edit writes against. */
  date: string;
  columns: CanvasColumn[];
}

export interface CanvasCell {
  columnIndex: number;
  startMinute: number;
}

type SelectMode = "replace" | "toggle" | "range";

interface ClipboardItem {
  session: ExpandedSession;
  columnIndex: number;
  spaceId: string | null;
  startMinute: number;
  durationMinutes: number;
}

interface Clipboard {
  items: ClipboardItem[];
  /** A cut pastes by moving the originals; a copy pastes by creating. */
  cut: boolean;
}

export interface ScheduleCanvasApi {
  /** False while the surface has nothing to select against (no schedule picked). */
  enabled: boolean;

  // --- what the surface publishes ------------------------------------------
  setSurface: (surface: CanvasSurface) => void;
  setBlocks: (blocks: CanvasBlock[]) => void;

  // --- selection -----------------------------------------------------------
  selectedIds: ReadonlySet<string>;
  selectedSessionIds: ReadonlySet<string>;
  selectBlock: (blockId: string, mode: SelectMode) => void;
  selectWithin: (rect: { columns: [number, number]; minutes: [number, number] }, additive: boolean) => void;
  clearSelection: () => void;
  selectAll: () => void;

  activeCell: CanvasCell | null;
  setActiveCell: (cell: CanvasCell | null) => void;

  // --- gestures ------------------------------------------------------------
  /** Drag-to-move. `weekOnly` writes a single-date override instead of the series. */
  moveBlock: (args: {
    blockId: string;
    toColumnIndex: number;
    toDayCode: string;
    toStartMinute: number;
    weekOnly: boolean;
  }) => Promise<void>;
  resizeBlock: (args: {
    blockId: string;
    edge: ResizeEdge;
    toMinute: number;
    weekOnly: boolean;
  }) => Promise<void>;
  /** Extends a session across the lanes the fill handle was dragged over. */
  spanLanes: (args: { blockId: string; toColumnIndex: number }) => Promise<void>;
  /**
   * The keyboard's version of a drag: shift the selection by whole steps.
   *
   * `edge` turns it into a resize of that edge instead of a move. Everything
   * routes through `moveBlock`/`resizeBlock` on the first selected block, which
   * is what makes the keyboard reach exactly the same code — including the
   * optimistic redraw and the scope line — rather than a second, thinner path
   * that would drift.
   */
  nudgeSelection: (delta: { minutes?: number; lanes?: number; edge?: ResizeEdge }) => Promise<void>;
  /** The session a keyboard gesture just acted on, so its block can take focus back. */
  focusRequest: { sessionId: string | null; seq: number };

  /**
   * The drag in progress, published by whoever owns the DndContext.
   *
   * The surface needs this so the rest of a multi-selection can follow the
   * block being dragged, and it arrives through the canvas rather than through
   * dnd-kit. The direct route — `useDndMonitor` inside the view — THROWS when
   * no DndContext is above it, which is every read-only render of this same
   * component: the public widget, a facility page, an aux staffer. It took the
   * whole page down, not just the ghost.
   */
  dragGhost: { blockId: string | null; x: number; y: number } | null;
  setDragGhost: (ghost: { blockId: string | null; x: number; y: number } | null) => void;

  copy: () => void;
  cut: () => void;
  paste: () => Promise<void>;
  /** Ctrl-D — a copy of each selected block starting where it ends. */
  duplicateBelow: () => Promise<void>;
  deleteSelected: () => Promise<void>;
  hasClipboard: boolean;

  batch: ScheduleBatchApi;
}

const ScheduleCanvasContext = createContext<ScheduleCanvasApi | null>(null);

export const ScheduleCanvasProvider = ScheduleCanvasContext.Provider;

/** Returns the canvas API, or null on a surface that is not one (widget, list, grid). */
export function useScheduleCanvas(): ScheduleCanvasApi | null {
  return useContext(ScheduleCanvasContext);
}

/** The id under which a session's block in one column is selected. */
export function canvasBlockId(session: ExpandedSession, columnKey: string): string {
  return `${session.key}::${columnKey}`;
}

interface BuildArgs {
  batch: ScheduleBatchApi;
  /** Null when the scope spans schedules — creating needs exactly one. */
  scheduleGroupId: string | null;
  enabled: boolean;
}

/**
 * Builds the canvas API. A hook rather than a component so the command centre
 * can memoize the value it provides, the same way it already does for
 * `ScheduleEditingApi` — a fresh object each render re-renders every block on
 * every keystroke in a dialog.
 */
export function useScheduleCanvasApi({ batch, scheduleGroupId, enabled }: BuildArgs): ScheduleCanvasApi {
  const surface = useRef<CanvasSurface>({ dayCode: "MO", date: "", columns: [] });
  // State, not a ref: the selection count is rendered, and a ref read during
  // render is both a lint error and a real staleness bug waiting to happen.
  // Identity only changes when the day's columns do, so publishing it from the
  // surface's effect cannot loop.
  const [blocks, setBlocksState] = useState<CanvasBlock[]>([]);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeCell, setActiveCell] = useState<CanvasCell | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [dragGhost, setDragGhost] = useState<{ blockId: string | null; x: number; y: number } | null>(null);
  /**
   * Which session the keyboard was last acting on, and a counter so the same
   * session can be asked for twice.
   *
   * A block moved to another lane is rendered by a different column, so React
   * unmounts it and mounts a new one — and the focus goes with it. After one
   * ArrowRight the keyboard was talking to nothing, which makes the whole
   * keyboard path a dead end on its second press.
   */
  const [focusRequest, setFocusRequest] = useState<{ sessionId: string | null; seq: number }>({
    sessionId: null,
    seq: 0,
  });
  const anchorId = useRef<string | null>(null);

  const setSurface = useCallback((next: CanvasSurface) => {
    surface.current = next;
  }, []);

  const setBlocks = useCallback((next: CanvasBlock[]) => {
    setBlocksState(next);
    // A block that left the week (another day selected, a filter applied, an
    // edit that moved it) must not stay selected — a later Delete would then
    // remove something that is not on screen.
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const live = new Set(next.map((b) => b.id));
      const kept = new Set([...current].filter((id) => live.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, []);

  const find = useCallback((blockId: string) => blocks.find((b) => b.id === blockId) ?? null, [blocks]);

  const selectedBlocks = useCallback(
    () => blocks.filter((b) => selectedIds.has(b.id)),
    [blocks, selectedIds]
  );

  const selectedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const block of blocks) if (selectedIds.has(block.id)) ids.add(block.session.sessionId);
    return ids;
  }, [blocks, selectedIds]);

  // --- selection -----------------------------------------------------------

  const selectBlock = useCallback((blockId: string, mode: SelectMode) => {
    setSelectedIds((current) => {
      if (mode === "toggle") {
        const next = new Set(current);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        anchorId.current = blockId;
        return next;
      }

      if (mode === "range" && anchorId.current) {
        const from = blocks.find((b) => b.id === anchorId.current);
        const to = blocks.find((b) => b.id === blockId);
        if (from && to) {
          // The rectangle the two corners describe, in lane and minute space —
          // a shift-click on a lane sheet means "everything between", not
          // "everything in document order between", which would sweep in whole
          // lanes that the two clicks never touched.
          const columns: [number, number] = [
            Math.min(from.columnIndex, to.columnIndex),
            Math.max(from.columnIndex, to.columnIndex),
          ];
          const minutes: [number, number] = [
            Math.min(from.startMinute, to.startMinute),
            Math.max(from.endMinute, to.endMinute),
          ];
          return new Set(
            blocks
              .filter(
                (b) =>
                  b.columnIndex >= columns[0] &&
                  b.columnIndex <= columns[1] &&
                  b.startMinute < minutes[1] &&
                  b.endMinute > minutes[0]
              )
              .map((b) => b.id)
          );
        }
      }

      anchorId.current = blockId;
      return new Set([blockId]);
    });

    const block = find(blockId);
    if (block) setActiveCell({ columnIndex: block.columnIndex, startMinute: block.startMinute });
  }, [find, blocks]);

  const selectWithin = useCallback(
    (rect: { columns: [number, number]; minutes: [number, number] }, additive: boolean) => {
      const hit = blocks
        .filter(
          (b) =>
            b.columnIndex >= rect.columns[0] &&
            b.columnIndex <= rect.columns[1] &&
            b.startMinute < rect.minutes[1] &&
            b.endMinute > rect.minutes[0]
        )
        .map((b) => b.id);
      setSelectedIds((current) => (additive ? new Set([...current, ...hit]) : new Set(hit)));
    },
    [blocks]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    anchorId.current = null;
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(blocks.map((b) => b.id)));
  }, [blocks]);

  // --- gestures ------------------------------------------------------------

  /**
   * One block's move, as ops. Shared by the single drag and the multi-select
   * drag, which is the same thing applied to every selected block with the
   * same lane/day/minute delta — so the two can never diverge.
   */
  const moveOpsFor = useCallback(
    (block: CanvasBlock, toColumnIndex: number, toDayCode: string, toStartMinute: number, weekOnly: boolean): BatchOp[] | { error: string } => {
      const span = moveSpan(
        {
          startTime: minutesToTimeString(block.startMinute),
          endTime: minutesToTimeString(block.endMinute),
        },
        toStartMinute
      );
      if (!span) return { error: "That would push the session past midnight." };

      if (weekOnly) {
        const sameLane = toColumnIndex === block.columnIndex;
        const sameDay = toDayCode === surface.current.dayCode;
        if (!sameLane || !sameDay) {
          return {
            error:
              "Holding Alt changes this week only, which can retime a block but cannot move it to another lane or day. Drop it without Alt to move the series.",
          };
        }
        return [
          {
            kind: "occurrence",
            sessionId: block.session.sessionId,
            date: surface.current.date,
            action: "modify",
            startTime: span.startTime,
            endTime: span.endTime,
          },
        ];
      }

      const toColumn = surface.current.columns[toColumnIndex];
      return [
        {
          kind: "move",
          sessionId: block.session.sessionId,
          fromDayCode: surface.current.dayCode,
          toDayCode,
          fromSpaceId: block.spaceId,
          toSpaceId: toColumn?.spaceId ?? undefined,
          startTime: span.startTime,
        },
      ];
    },
    []
  );

  const moveBlock = useCallback(
    async ({ blockId, toColumnIndex, toDayCode, toStartMinute, weekOnly }: {
      blockId: string;
      toColumnIndex: number;
      toDayCode: string;
      toStartMinute: number;
      weekOnly: boolean;
    }) => {
      const block = find(blockId);
      if (!block) return;

      // Dragging a block that is part of a selection moves the whole
      // selection by the same delta — the lane offset, the day, and the
      // minutes. Dragging one that is not selects it first, so a stray
      // click-drag never silently drags a selection made minutes ago.
      const dragging = selectedIds.has(blockId) ? selectedBlocks() : [block];
      if (!selectedIds.has(blockId)) selectBlock(blockId, "replace");

      const laneDelta = toColumnIndex - block.columnIndex;
      const minuteDelta = toStartMinute - block.startMinute;
      const maxColumn = surface.current.columns.length - 1;

      const ops: BatchOp[] = [];
      const plans = new Map<string, MovePlan>();
      const weekOnlyTimes = new Map<string, { startMinute: number; endMinute: number }>();
      const seen = new Set<string>();
      const fromDayIndex = dayIndexOf(surface.current.dayCode);
      const dayShift = weekOnly ? 0 : dayIndexOf(toDayCode) - fromDayIndex;

      for (const item of dragging) {
        // Distinct sessions only: a Lanes 1-4 session with two of its blocks
        // selected must not be moved twice, which would apply the delta twice.
        if (seen.has(item.session.sessionId)) continue;
        seen.add(item.session.sessionId);

        const column = clampColumn(item.columnIndex + laneDelta, maxColumn);
        const startMinute = clampMinute(item.startMinute + minuteDelta);
        const result = moveOpsFor(item, column, toDayCode, startMinute, weekOnly);
        if ("error" in result) {
          batch.reportError(`Could not move ${describe(dragging)}`, result.error);
          return;
        }
        ops.push(...result);

        const duration = item.endMinute - item.startMinute;
        if (weekOnly) {
          weekOnlyTimes.set(item.session.sessionId, {
            startMinute,
            endMinute: startMinute + duration,
          });
        } else {
          const target = surface.current.columns[column];
          plans.set(item.session.sessionId, {
            startMinute,
            durationMinutes: duration,
            fromDayIndex,
            dayShift,
            fromSpaceId: item.spaceId,
            toSpaceId: target?.spaceId ?? undefined,
            toSpaceName: target?.name,
          });
        }
      }

      await batch.run({
        label: `Moved ${describe(dragging)}`,
        scope: weekOnly ? thisWeekScope(surface.current.date) : seriesScope(toDayCode),
        ops,
        optimistic: weekOnly
          ? optimisticTimes(weekOnlyTimes, surface.current.date)
          : optimisticMove(plans),
      });
    },
    [find, selectedIds, selectedBlocks, selectBlock, moveOpsFor, batch]
  );

  const resizeBlock = useCallback(
    async ({ blockId, edge, toMinute, weekOnly }: {
      blockId: string;
      edge: ResizeEdge;
      toMinute: number;
      weekOnly: boolean;
    }) => {
      const block = find(blockId);
      if (!block) return;

      const span = resizeSpan(
        { startTime: minutesToTimeString(block.startMinute), endTime: minutesToTimeString(block.endMinute) },
        edge,
        toMinute
      );
      if (!span) return;

      const targets = selectedIds.has(blockId) ? dedupeBySession(selectedBlocks()) : [block];
      const delta =
        edge === "end"
          ? timeStringToMinutes(span.endTime) - block.endMinute
          : timeStringToMinutes(span.startTime) - block.startMinute;

      const times = new Map<string, { startMinute: number; endMinute: number }>();
      const ops: BatchOp[] = targets.map((item) => {
        const own = resizeSpan(
          { startTime: minutesToTimeString(item.startMinute), endTime: minutesToTimeString(item.endMinute) },
          edge,
          edge === "end" ? item.endMinute + delta : item.startMinute + delta
        ) ?? { startTime: minutesToTimeString(item.startMinute), endTime: minutesToTimeString(item.endMinute) };

        times.set(item.session.sessionId, {
          startMinute: timeStringToMinutes(own.startTime),
          endMinute: timeStringToMinutes(own.endTime),
        });

        return weekOnly
          ? {
              kind: "occurrence",
              sessionId: item.session.sessionId,
              date: surface.current.date,
              action: "modify",
              startTime: own.startTime,
              endTime: own.endTime,
            }
          : {
              kind: "resize",
              sessionId: item.session.sessionId,
              startTime: edge === "start" ? own.startTime : undefined,
              endTime: edge === "end" ? own.endTime : undefined,
            };
      });

      await batch.run({
        label: `Resized ${describe(targets)}`,
        scope: weekOnly ? thisWeekScope(surface.current.date) : "every occurrence of the series",
        ops,
        // A resize writes dtstart/dtend_time, so it reaches every occurrence —
        // unless Alt scoped it to the one date on screen.
        optimistic: optimisticTimes(times, weekOnly ? surface.current.date : undefined),
      });
    },
    [find, selectedIds, selectedBlocks, batch]
  );

  const spanLanes = useCallback(
    async ({ blockId, toColumnIndex }: { blockId: string; toColumnIndex: number }) => {
      const block = find(blockId);
      if (!block) return;

      const from = Math.min(block.columnIndex, toColumnIndex);
      const to = Math.max(block.columnIndex, toColumnIndex);
      const spanned = surface.current.columns
        .slice(from, to + 1)
        .map((c) => c.spaceId)
        .filter((id): id is string => !!id);

      if (spanned.length === 0) return;

      // The union, not a replacement: a session already in Lanes 1-4 dragged
      // from Lane 2 out to Lane 6 should end up in 1-6, not 2-6. Dragging the
      // handle is an "extend to here" gesture in every spreadsheet there is.
      const next = Array.from(new Set([...block.session.spaceIds, ...spanned]));
      if (next.length === block.session.spaceIds.length) return;

      const nextNames = surface.current.columns
        .filter((c) => c.spaceId && next.includes(c.spaceId))
        .map((c) => c.name);

      await batch.run({
        label: `Extended ${sessionDisplayLabel(block.session)} across ${next.length} spaces`,
        scope: seriesScope(surface.current.dayCode),
        ops: [{ kind: "patch", sessionId: block.session.sessionId, spaceIds: next }],
        optimistic: (list) =>
          list.map((s) =>
            s.sessionId === block.session.sessionId
              ? { ...s, spaceIds: next, spaceNames: nextNames }
              : s
          ),
      });
    },
    [find, batch]
  );

  const applyNudge = useCallback(
    async ({ minutes = 0, lanes = 0, edge }: { minutes?: number; lanes?: number; edge?: ResizeEdge }) => {
      // Document order, so repeated presses always take the same anchor and the
      // selection travels as one shape rather than drifting apart.
      const anchor = blocks.find((b) => selectedIds.has(b.id));
      if (!anchor) return;

      setFocusRequest((n) => ({ sessionId: anchor.session.sessionId, seq: n.seq + 1 }));

      if (edge) {
        await resizeBlock({
          blockId: anchor.id,
          edge,
          toMinute: (edge === "end" ? anchor.endMinute : anchor.startMinute) + minutes,
          weekOnly: false,
        });
        return;
      }

      await moveBlock({
        blockId: anchor.id,
        toColumnIndex: anchor.columnIndex + lanes,
        toDayCode: surface.current.dayCode,
        toStartMinute: anchor.startMinute + minutes,
        weekOnly: false,
      });
    },
    [blocks, selectedIds, moveBlock, resizeBlock]
  );

  // The latest implementation, for the coalescing timer below to reach without
  // capturing the `blocks` it was created with. Written from an effect rather
  // than during render — a timer that fires mid-render would otherwise read a
  // value React has not committed.
  const applyNudgeRef = useRef(applyNudge);
  useEffect(() => {
    applyNudgeRef.current = applyNudge;
  }, [applyNudge]);

  /**
   * Arrow presses are accumulated and flushed together.
   *
   * Two reasons, and the first is correctness. A press computes its target from
   * the block's *current* position, and a held arrow repeats about every 30ms —
   * far faster than the optimistic redraw can put the moved block back into
   * `blocks`. So a second press read the pre-move position and asked for the
   * same destination again: two presses, one step. Accumulating the delta and
   * flushing once is the only version where holding a key travels.
   *
   * The second is the undo stack. Holding Down for a second should be one entry
   * to undo, not thirty.
   */
  const pendingNudge = useRef<{ mode: string; minutes: number; lanes: number; edge?: ResizeEdge } | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNudge = useCallback(() => {
    if (nudgeTimer.current) {
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
    }
    const pending = pendingNudge.current;
    pendingNudge.current = null;
    if (pending) void applyNudgeRef.current(pending);
  }, []);

  const nudgeSelection = useCallback(
    async (delta: { minutes?: number; lanes?: number; edge?: ResizeEdge }) => {
      // Switching between moving and resizing mid-hold is a change of intent,
      // not something to average together.
      const mode = delta.edge ?? "move";
      if (pendingNudge.current && pendingNudge.current.mode !== mode) flushNudge();

      const pending = pendingNudge.current ?? { mode, minutes: 0, lanes: 0, edge: delta.edge };
      pendingNudge.current = {
        ...pending,
        minutes: pending.minutes + (delta.minutes ?? 0),
        lanes: pending.lanes + (delta.lanes ?? 0),
      };

      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(flushNudge, NUDGE_COALESCE_MS);
    },
    [flushNudge]
  );

  // --- clipboard -----------------------------------------------------------

  const snapshot = useCallback((): ClipboardItem[] => {
    const seen = new Set<string>();
    const items: ClipboardItem[] = [];
    for (const block of selectedBlocks()) {
      if (seen.has(block.session.sessionId)) continue;
      seen.add(block.session.sessionId);
      items.push({
        session: block.session,
        columnIndex: block.columnIndex,
        spaceId: block.spaceId,
        startMinute: block.startMinute,
        durationMinutes: block.endMinute - block.startMinute,
      });
    }
    return items;
  }, [selectedBlocks]);

  const copy = useCallback(() => {
    const items = snapshot();
    if (items.length > 0) setClipboard({ items, cut: false });
  }, [snapshot]);

  const cut = useCallback(() => {
    const items = snapshot();
    if (items.length > 0) setClipboard({ items, cut: true });
  }, [snapshot]);

  const paste = useCallback(async () => {
    if (!clipboard || clipboard.items.length === 0) return;
    const target = activeCell;
    if (!target) return;

    // Relative layout is preserved: the top-left of what was copied lands on
    // the active cell and everything else keeps its lane and minute offset,
    // which is what makes copying a whole morning across to another day one
    // gesture instead of six.
    const anchorColumn = Math.min(...clipboard.items.map((i) => i.columnIndex));
    const anchorMinute = Math.min(...clipboard.items.map((i) => i.startMinute));
    const maxColumn = surface.current.columns.length - 1;

    const ops: BatchOp[] = [];
    let follows = false;

    for (const item of clipboard.items) {
      const columnIndex = clampColumn(target.columnIndex + (item.columnIndex - anchorColumn), maxColumn);
      const column = surface.current.columns[columnIndex];
      const startMinute = clampMinute(snap(target.startMinute + (item.startMinute - anchorMinute)));
      const endMinute = startMinute + Math.max(item.durationMinutes, MIN_DURATION_MINUTES);
      if (endMinute > 24 * 60) continue;

      if (clipboard.cut) {
        ops.push({
          kind: "move",
          sessionId: item.session.sessionId,
          fromDayCode: surface.current.dayCode,
          toDayCode: surface.current.dayCode,
          fromSpaceId: item.spaceId,
          toSpaceId: column?.spaceId ?? undefined,
          startTime: minutesToTimeString(startMinute),
        });
        continue;
      }

      if (!scheduleGroupId) return;
      if (item.session.followsOperatingHours) follows = true;

      ops.push({
        kind: "create",
        scheduleGroupId,
        templateId: item.session.templateId,
        dayCodes: [surface.current.dayCode],
        startTime: minutesToTimeString(startMinute),
        endTime: minutesToTimeString(endMinute),
        // A pasted block claims the lane it was dropped on, and only it. The
        // source's other lanes belong to the source: pasting a Lanes 1-4
        // session onto Lane 6 and silently getting 1-4 back would make the
        // gesture unusable for the thing it is mostly for.
        spaceIds: column?.spaceId ? [column.spaceId] : [],
        validFrom: surface.current.date,
        locationDetail: item.session.locationDetail,
        occupancyKind: item.session.occupancyKind,
        disclosure: item.session.disclosure,
      });
    }

    const ok = await batch.run({
      label: `${clipboard.cut ? "Moved" : "Pasted"} ${countLabel(ops.length)}`,
      scope: follows
        ? "pasted with fixed times — the original follows the department's hours"
        : seriesScope(surface.current.dayCode),
      ops,
    });

    // A cut is spent once pasted, like every cut buffer; a copy stays for a
    // second paste.
    if (ok && clipboard.cut) setClipboard(null);
  }, [clipboard, activeCell, scheduleGroupId, batch]);

  const duplicateBelow = useCallback(async () => {
    if (!scheduleGroupId) return;
    const items = snapshot();
    if (items.length === 0) return;

    const ops: BatchOp[] = [];
    for (const item of items) {
      const start = item.startMinute + item.durationMinutes;
      const end = start + item.durationMinutes;
      if (end > 24 * 60) continue;
      const column = surface.current.columns[item.columnIndex];
      ops.push({
        kind: "create",
        scheduleGroupId,
        templateId: item.session.templateId,
        dayCodes: [surface.current.dayCode],
        startTime: minutesToTimeString(start),
        endTime: minutesToTimeString(end),
        spaceIds: column?.spaceId ? [column.spaceId] : [],
        validFrom: surface.current.date,
        locationDetail: item.session.locationDetail,
        occupancyKind: item.session.occupancyKind,
        disclosure: item.session.disclosure,
      });
    }

    await batch.run({
      label: `Repeated ${countLabel(ops.length)} below`,
      scope: seriesScope(surface.current.dayCode),
      ops,
    });
  }, [scheduleGroupId, snapshot, batch]);

  const deleteSelected = useCallback(async () => {
    const targets = dedupeBySession(selectedBlocks());
    if (targets.length === 0) return;
    const removed = new Set(targets.map((b) => b.session.sessionId));

    await batch.run({
      label: `Removed ${describe(targets)}`,
      // Said plainly: a block is one occurrence of a series and Delete takes
      // the series. Undo is what makes that safe, but only if it is legible.
      scope: "the whole recurring series",
      destructive: true,
      ops: targets.map((b) => ({ kind: "delete", sessionId: b.session.sessionId })),
      // Every occurrence, not just the one clicked: Delete takes the series.
      optimistic: (list) => list.filter((s) => !removed.has(s.sessionId)),
    });
    clearSelection();
  }, [selectedBlocks, batch, clearSelection]);

  return useMemo(
    () => ({
      enabled,
      setSurface,
      setBlocks,
      selectedIds,
      selectedSessionIds,
      selectBlock,
      selectWithin,
      clearSelection,
      selectAll,
      activeCell,
      setActiveCell,
      moveBlock,
      resizeBlock,
      spanLanes,
      nudgeSelection,
      focusRequest,
      dragGhost,
      setDragGhost,
      copy,
      cut,
      paste,
      duplicateBelow,
      deleteSelected,
      hasClipboard: !!clipboard,
      batch,
    }),
    [
      enabled,
      setSurface,
      setBlocks,
      selectedIds,
      selectedSessionIds,
      selectBlock,
      selectWithin,
      clearSelection,
      selectAll,
      activeCell,
      moveBlock,
      resizeBlock,
      spanLanes,
      nudgeSelection,
      focusRequest,
      dragGhost,
      setDragGhost,
      copy,
      cut,
      paste,
      duplicateBelow,
      deleteSelected,
      clipboard,
      batch,
    ]
  );
}

// ---------------------------------------------------------------------------

function clampColumn(index: number, max: number): number {
  return Math.max(0, Math.min(max, index));
}

// ---------------------------------------------------------------------------
// Optimistic redraw
// ---------------------------------------------------------------------------
//
// These describe what the ROUTE will do, not what the pointer did, and the
// difference is the whole point. Dragging one block to a new time changes the
// series' `dtstart`, so every occurrence of it moves — including the Monday and
// Friday ones nobody touched. Drawing only the dragged block would be a lie
// that survives until the refetch corrects it, which is worse than waiting.

/** A session occurrence's Date is literal wall-clock digits — UTC setters only. */
function withTimeOfDay(date: Date, minuteOfDay: number): Date {
  const next = new Date(date);
  next.setUTCHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return next;
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayIndexOf(dayCode: string): number {
  return DAYS.findIndex((d) => d.code === dayCode);
}

/** Swaps one space out of an occurrence's parallel id/name arrays. */
function swapSpaceOnOccurrence(
  session: ExpandedSession,
  fromSpaceId: string | null,
  toSpaceId: string | undefined,
  toSpaceName: string | undefined
): ExpandedSession {
  if (!toSpaceId || !toSpaceName) return session;
  // The same guard `moveSpace` opens with, and for the same reason. Without it
  // a move *within* one lane took the "already holds this lane, so collapse the
  // two" branch below and optimistically removed the session's only space. The
  // block jumped to the General column, its id changed with the column, and the
  // selection was pruned out from under the next keypress — all of it undone a
  // moment later by the refetch, which is what made it look like a keyboard
  // bug rather than a lie in the optimistic paint.
  if (fromSpaceId === toSpaceId) return session;
  if (session.spaceIds.length === 0) {
    return { ...session, spaceIds: [toSpaceId], spaceNames: [toSpaceName] };
  }
  const index = fromSpaceId ? session.spaceIds.indexOf(fromSpaceId) : -1;
  if (index < 0) return session;
  if (session.spaceIds.includes(toSpaceId)) {
    return {
      ...session,
      spaceIds: session.spaceIds.filter((_, i) => i !== index),
      spaceNames: session.spaceNames.filter((_, i) => i !== index),
    };
  }
  const spaceIds = [...session.spaceIds];
  const spaceNames = [...session.spaceNames];
  spaceIds[index] = toSpaceId;
  spaceNames[index] = toSpaceName;
  return { ...session, spaceIds, spaceNames };
}

interface MovePlan {
  startMinute: number;
  durationMinutes: number;
  /** Which occurrence's weekday moves, and by how far. 0 when only the time changed. */
  fromDayIndex: number;
  dayShift: number;
  fromSpaceId: string | null;
  toSpaceId?: string;
  toSpaceName?: string;
}

function optimisticMove(plans: Map<string, MovePlan>) {
  return (list: ExpandedSession[]): ExpandedSession[] =>
    list.map((session) => {
      const plan = plans.get(session.sessionId);
      if (!plan) return session;

      // Time first: it belongs to the series, so every occurrence takes it.
      let start = withTimeOfDay(session.start, plan.startMinute);
      let end = withTimeOfDay(session.start, plan.startMinute + plan.durationMinutes);

      // Then the day, which belongs to the one occurrence that was dragged.
      if (plan.dayShift !== 0 && sessionDayIndex(session.start) === plan.fromDayIndex) {
        start = shiftDays(start, plan.dayShift);
        end = shiftDays(end, plan.dayShift);
      }

      const moved = swapSpaceOnOccurrence(session, plan.fromSpaceId, plan.toSpaceId, plan.toSpaceName);
      return { ...moved, start, end };
    });
}

function optimisticTimes(
  times: Map<string, { startMinute: number; endMinute: number }>,
  /** Set for an Alt edit, which reaches exactly one date. */
  onlyDate?: string
) {
  return (list: ExpandedSession[]): ExpandedSession[] =>
    list.map((session) => {
      const next = times.get(session.sessionId);
      if (!next) return session;
      if (onlyDate && sessionDateString(session.start) !== onlyDate) return session;
      return {
        ...session,
        start: withTimeOfDay(session.start, next.startMinute),
        end: withTimeOfDay(session.start, next.endMinute),
        isModified: onlyDate ? true : session.isModified,
      };
    });
}

function dedupeBySession(list: CanvasBlock[]): CanvasBlock[] {
  const seen = new Set<string>();
  return list.filter((b) => {
    if (seen.has(b.session.sessionId)) return false;
    seen.add(b.session.sessionId);
    return true;
  });
}

function describe(list: CanvasBlock[]): string {
  const distinct = dedupeBySession(list);
  if (distinct.length === 1) return sessionDisplayLabel(distinct[0].session);
  return countLabel(distinct.length);
}

function countLabel(n: number): string {
  return `${n} session${n === 1 ? "" : "s"}`;
}

function seriesScope(dayCode: string): string {
  const day = DAYS.find((d) => d.code === dayCode);
  return day ? `every ${day.label}` : "the whole series";
}

function thisWeekScope(date: string): string {
  return `this week only (${date})`;
}
