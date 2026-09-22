"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  Layers,
  MapPin,
  Plus,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import type { CommandSpace } from "@/components/schedule-command/types";
import {
  buildSpaceSections,
  moveSpaceByStep,
  moveSpaceOnto,
  zoneSiblingIds,
} from "@/lib/spaces/grouping";
import { cn } from "@/lib/utils/cn";

/**
 * The chip under the cursor wins, and only falls back to overlap when the
 * cursor is in the gutter between two chips.
 *
 * dnd-kit's default compares the DRAGGED element's box, not the pointer, and
 * the grip is at a chip's left edge — so a chip picked up by its handle sits
 * half a chip to the right of the cursor and kept landing one slot over.
 */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

interface SpaceSectionsProps {
  facilityId: string;
  /** This building's departments, already in display order. */
  departments: { id: string; name: string }[];
  /** Every space in the facility, already in `display_order`. */
  spaces: CommandSpace[];
}

/**
 * The grouped body of the Spaces page: department sections, zone subsections,
 * and the two ways to set `display_order` — drag a chip by its grip, or step it
 * with the up/down arrows.
 *
 * Both routes run the same move: `moveSpaceByStep` and `moveSpaceOnto` are thin
 * callers of one `moveSpaceWithinZone` in lib/spaces/grouping, which returns the
 * flattened facility rather than a swapped pair. That is what keeps the two in
 * agreement with each other and with the session editors (one flat
 * `display_order` list per facility): the save is always positions 1..N in the
 * order this page renders.
 *
 * Client-side because reordering is optimistic — the chip moves before the
 * write lands.
 */
export default function SpaceSections({ facilityId, departments, spaces }: SpaceSectionsProps) {
  const [order, setOrder] = useState<CommandSpace[]>(spaces);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The drag in progress: what is moving, and which chips it may land on.
   *
   * The sibling list is read once, on drag start, from the grouping being
   * rendered — a chip then only has to ask whether its own id is in the set,
   * instead of every chip re-grouping the facility on every pointer move.
   */
  const [drag, setDrag] = useState<{ space: CommandSpace; targets: Set<string> } | null>(null);

  /**
   * One save in flight at a time, with the newest order queued behind it.
   *
   * Every save sends the WHOLE facility, so only the latest one matters —
   * superseding a queued order is correct, not lossy. Letting two overlap is
   * not: each writes `display_order` 1..N row by row, and two interleaved
   * passes leave duplicate positions and gaps (observed as 1,2,3,4,5,6,8,9,10
   * across ten rows after two quick clicks).
   */
  const save = useRef<{ inFlight: boolean; queued: CommandSpace[] | null }>({
    inFlight: false,
    queued: null,
  });

  // Switching facility (or any other server render) hands down a new list —
  // adopt it rather than keeping a stale optimistic one. Adjusted during render
  // rather than in an effect: an effect here would render the stale order once,
  // then cascade a second render to correct it.
  //
  // Never while a save is in flight. A server render that started before the
  // move carries the pre-move order, and adopting it would undo the move on
  // screen a moment after the user made it — which is exactly what a second
  // quick click used to hit.
  const [seededFrom, setSeededFrom] = useState(spaces);
  if (seededFrom !== spaces) {
    setSeededFrom(spaces);
    if (!saving) setOrder(spaces);
  }

  const sections = buildSpaceSections(order, departments);

  // A short distance/delay before a drag starts, so a tap still reaches the
  // chip's edit link underneath and a touch drag still lets the page scroll.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const space = order.find((s) => s.id === event.active.id);
    if (!space) return;
    setDrag({ space, targets: new Set(zoneSiblingIds(order, departments, space.id)) });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDrag(null);
    const overId = event.over?.id;
    if (typeof overId !== "string") return;

    // Refuses a drop outside the dragged space's own zone — see
    // `moveSpaceWithinZone` on why crossing a zone is a different write.
    const next = moveSpaceOnto(order, departments, String(event.active.id), overId);
    if (next) apply(next);
  }

  function move(space: CommandSpace, delta: -1 | 1) {
    const next = moveSpaceByStep(order, departments, space.id, delta);
    if (next) apply(next);
  }

  function apply(next: CommandSpace[]) {
    setOrder(next);
    setError(null);
    void persist(next);
  }

  async function persist(next: CommandSpace[]) {
    if (save.current.inFlight) {
      save.current.queued = next;
      return;
    }

    save.current.inFlight = true;
    setSaving(true);

    try {
      let pending: CommandSpace[] | null = next;
      while (pending) {
        const res = await fetch("/api/spaces/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facility_id: facilityId, ids: pending.map((s) => s.id) }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Could not save the new order.");
          // The server's list is the only thing known to be true now.
          setOrder(spaces);
          save.current.queued = null;
          return;
        }

        pending = save.current.queued;
        save.current.queued = null;
      }
    } finally {
      save.current.inFlight = false;
      setSaving(false);
    }

    // Deliberately no router.refresh(). It only re-renders THIS route — it does
    // not reach the session editors or the map — so all it can fetch back is
    // the order just written. Doing that on every click raced the next one: the
    // refresh carried the pre-move list and landed on top of it.
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <div className="space-y-4" data-saving={saving ? "true" : "false"}>
        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        {/* Reordering is optimistic, so without this there is nothing on screen
            between the chip moving and the write landing — and navigating away in
            that window loses the move silently. `data-saving` is the same fact in
            a form verify-aj can wait on. */}
        <p aria-live="polite" className="sr-only">
          {saving ? "Saving space order" : ""}
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground" aria-hidden="true">
            Saving order…
          </p>
        )}

        {sections.map((section) => (
          <section
            key={section.departmentId ?? "none"}
            className="bg-card rounded-xl border border-border p-4 sm:p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-muted-foreground/70 shrink-0" />
              <h2 className="text-sm font-semibold text-foreground truncate">{section.label}</h2>
              <span className="text-xs text-muted-foreground/70 shrink-0">
                {section.total} space{section.total !== 1 ? "s" : ""} · {section.published} published
              </span>
              <Link
                href={newSpaceHref(facilityId, section.departmentId)}
                className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1.5 -my-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add</span>
                <span className="sr-only sm:hidden">Add a space to {section.label}</span>
              </Link>
            </div>

            <div className="space-y-3">
              {section.zones.map((zone) => (
                <div key={zone.zoneName ?? "__none"}>
                  {zone.zoneName && (
                    <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1.5">
                      <span className="truncate">{zone.zoneName}</span>
                      <span className="text-muted-foreground/60 shrink-0">{zone.spaces.length}</span>
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    </h3>
                  )}
                  {/* A zone-less bucket under a department that also has zones gets
                      a rule of its own, so its chips do not read as part of the
                      zone above them. */}
                  {!zone.zoneName && section.zones.length > 1 && (
                    <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground/70 mb-1.5">
                      <span className="shrink-0">Not in a zone</span>
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    </h3>
                  )}
                  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {zone.spaces.map((space, i) => (
                      <li key={space.id}>
                        <SpaceChip
                          facilityId={facilityId}
                          space={space}
                          canMoveUp={i > 0}
                          canMoveDown={i < zone.spaces.length - 1}
                          onMove={(delta) => move(space, delta)}
                          isDragging={drag?.space.id === space.id}
                          // Only chips in the dragged space's own zone light up:
                          // anywhere else is not a position, it is a different
                          // department or zone, and the drop is refused.
                          isDropTarget={
                            !!drag && drag.space.id !== space.id && drag.targets.has(space.id)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* The chip stays in the grid (dimmed) and a copy follows the pointer —
          without this the grid would reflow around a lifted chip mid-drag and
          the drop target under the cursor would move as you aim at it. */}
      <DragOverlay dropAnimation={null}>
        {drag && (
          <div className="flex items-center gap-1.5 rounded-lg border border-blue-400 bg-card px-3 py-2 shadow-lg cursor-grabbing">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{drag.space.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface SpaceChipProps {
  facilityId: string;
  space: CommandSpace;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  isDragging: boolean;
  isDropTarget: boolean;
}

/**
 * The chip's whole face is the edit link — at this density a 16px pencil fails
 * on a phone — so the reorder controls sit above it on their own layer rather
 * than nested inside an anchor.
 *
 * Dragging hangs off a grip handle rather than the chip body for the same
 * reason: a drag started anywhere on the face would be competing with the link
 * for every press, and on touch with the page's own scroll.
 */
function SpaceChip({
  facilityId,
  space,
  canMoveUp,
  canMoveDown,
  onMove,
  isDragging,
  isDropTarget,
}: SpaceChipProps) {
  // `attributes` is deliberately not spread onto the handle below. It is
  // dnd-kit's accessibility bundle — role, tabIndex, aria-roledescription and
  // an `aria-describedby` pointing at its announcement region — and that id is
  // generated from a counter that starts over on the client, so spreading it
  // hydrates with a mismatch on every chip. None of it is wanted here anyway:
  // the handle is hidden from assistive tech, and the arrows are the keyboard
  // path. `listeners` is what actually starts a drag.
  const { setNodeRef: setDragRef, setActivatorNodeRef, listeners } = useDraggable({ id: space.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: space.id });

  // Same node is both the thing being dragged (dnd-kit measures it) and the
  // thing that can be dropped on.
  const ref = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const highlighted = isOver && isDropTarget;

  return (
    <div
      ref={ref}
      data-space-id={space.id}
      data-drop-target={highlighted ? "true" : undefined}
      className={cn(
        "relative min-h-11 h-full rounded-lg border border-border bg-muted/40 transition-colors hover:bg-muted hover:border-blue-300",
        isDragging && "opacity-40",
        highlighted && "border-blue-500 ring-2 ring-blue-500/40 bg-blue-50/60"
      )}
    >
      <Link
        href={`/dashboard/facilities/${facilityId}/spaces/${space.id}/edit`}
        aria-label={`Edit ${space.name}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      />

      <div className="relative flex flex-col justify-center gap-0.5 pl-7 pr-9 py-2 pointer-events-none">
        <span className="flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">{space.name}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          {space.isPublished ? (
            <Eye className="w-3 h-3 text-green-600 shrink-0" />
          ) : (
            <EyeOff className="w-3 h-3 shrink-0" />
          )}
          {/* The icon alone would carry this on colour and glyph only. */}
          <span className="sr-only">{space.isPublished ? "Published" : "Draft"}</span>
          <span aria-hidden="true">{space.isPublished ? "Published" : "Draft"}</span>
          {space.capacity != null && <span className="truncate">· Cap. {space.capacity}</span>}
        </span>
      </div>

      {/* Full-height strip so the target is a thumb, not a 14px glyph.
          Kept out of the tab order and hidden from assistive tech on purpose:
          a pointer drag has no keyboard equivalent here, and the arrows beside
          it already do the same move in a way a keyboard and a screen reader
          can both drive. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...listeners}
        tabIndex={-1}
        aria-hidden="true"
        data-drag-handle={space.id}
        className="absolute left-0 top-0 bottom-0 w-7 flex items-center justify-center rounded-l-lg text-muted-foreground/50 hover:text-foreground hover:bg-background/70 cursor-grab active:cursor-grabbing touch-none transition-colors"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <div className="absolute top-1 right-1 flex flex-col">
        <ReorderButton
          direction="up"
          disabled={!canMoveUp}
          spaceName={space.name}
          onClick={() => onMove(-1)}
        />
        <ReorderButton
          direction="down"
          disabled={!canMoveDown}
          spaceName={space.name}
          onClick={() => onMove(1)}
        />
      </div>
    </div>
  );
}

function ReorderButton({
  direction,
  disabled,
  spaceName,
  onClick,
}: {
  direction: "up" | "down";
  disabled: boolean;
  spaceName: string;
  onClick: () => void;
}) {
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Move ${spaceName} ${direction}`}
      className="p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-background disabled:opacity-0 disabled:pointer-events-none transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function newSpaceHref(facilityId: string, departmentId: string | null): string {
  const base = `/dashboard/facilities/${facilityId}/spaces/new`;
  return departmentId ? `${base}?departmentId=${departmentId}` : base;
}
