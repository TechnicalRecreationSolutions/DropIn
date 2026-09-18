"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Layers, MapPin, Plus, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import type { CommandSpace } from "@/components/schedule-command/types";

interface SpaceSectionsProps {
  facilityId: string;
  /** This building's departments, already in display order. */
  departments: { id: string; name: string }[];
  /** Every space in the facility, already in `display_order`. */
  spaces: CommandSpace[];
}

/** One zone's worth of chips inside a department — `zoneName` null = not in a zone. */
interface ZoneGroup {
  zoneName: string | null;
  spaces: CommandSpace[];
}

interface Section {
  /** Null for the "whole building" bucket, which always sorts last. */
  departmentId: string | null;
  label: string;
  zones: ZoneGroup[];
  total: number;
  published: number;
}

/**
 * The grouped body of the Spaces page: department sections, zone subsections,
 * and the up/down controls that set `display_order`.
 *
 * Client-side because reordering needs optimistic state — and because the
 * flattened save order has to be derived from exactly the same grouping the
 * screen is rendering. Keeping `buildSections` and `flatten` in one file is
 * what guarantees that: reorder writes positions 1..N in render order, so the
 * session editors (one flat `display_order` list per facility) end up agreeing
 * with what this page shows.
 */
export default function SpaceSections({ facilityId, departments, spaces }: SpaceSectionsProps) {
  const [order, setOrder] = useState<CommandSpace[]>(spaces);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const sections = buildSections(order, departments);

  async function move(space: CommandSpace, delta: -1 | 1) {
    const current = buildSections(order, departments);
    const section = current.find((s) => s.departmentId === space.departmentId);
    const zone = section?.zones.find((z) => z.zoneName === zoneKeyOf(space));
    if (!zone) return;

    const index = zone.spaces.findIndex((s) => s.id === space.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= zone.spaces.length) return;

    // Swap inside the group the user can see, then flatten the whole facility —
    // see the note above on why the save is never just the moved pair.
    [zone.spaces[index], zone.spaces[target]] = [zone.spaces[target], zone.spaces[index]];
    const next = flatten(current);

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
  );
}

/** "" and null both mean "not in a zone" — see the API's normalization note. */
function zoneKeyOf(space: CommandSpace): string | null {
  const name = space.zoneName?.trim();
  return name ? name : null;
}

/**
 * Departments in their own display order, each with its zones, then the
 * unassigned bucket last. Empty departments are dropped: a heading with nothing
 * under it is noise on a page whose complaint was too many rows.
 *
 * Every space lands in exactly one place — a space whose department is not in
 * `departments` falls through to the "whole building" bucket rather than
 * vanishing, because `flatten` has to return the full facility.
 */
function buildSections(
  spaces: CommandSpace[],
  departments: { id: string; name: string }[]
): Section[] {
  const known = new Set(departments.map((d) => d.id));
  const sections: Section[] = [];

  const push = (departmentId: string | null, label: string, members: CommandSpace[]) => {
    if (members.length === 0) return;
    sections.push({
      departmentId,
      label,
      zones: buildZones(members),
      total: members.length,
      published: members.filter((s) => s.isPublished).length,
    });
  };

  for (const department of departments) {
    push(
      department.id,
      department.name,
      spaces.filter((s) => s.departmentId === department.id)
    );
  }

  // department_id null means "available to every schedule in the building" —
  // the hot tub, the parking lot — not "misfiled". The label says so.
  push(
    null,
    "Whole building",
    spaces.filter((s) => s.departmentId === null || !known.has(s.departmentId))
  );

  return sections;
}

/** Zones in first-appearance order, so reordering a space can move its zone too. */
function buildZones(spaces: CommandSpace[]): ZoneGroup[] {
  const zones: ZoneGroup[] = [];
  const byName = new Map<string, ZoneGroup>();
  let ungrouped: ZoneGroup | null = null;

  for (const space of spaces) {
    const key = zoneKeyOf(space);
    if (key === null) {
      if (!ungrouped) ungrouped = { zoneName: null, spaces: [] };
      ungrouped.spaces.push(space);
      continue;
    }
    let zone = byName.get(key);
    if (!zone) {
      zone = { zoneName: key, spaces: [] };
      byName.set(key, zone);
      zones.push(zone);
    }
    zone.spaces.push(space);
  }

  // Loose spaces sit under the named zones, never between them.
  if (ungrouped) zones.push(ungrouped);
  return zones;
}

/** Render order, top to bottom — exactly what gets saved as `display_order`. */
function flatten(sections: Section[]): CommandSpace[] {
  return sections.flatMap((section) => section.zones.flatMap((zone) => zone.spaces));
}

interface SpaceChipProps {
  facilityId: string;
  space: CommandSpace;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
}

/**
 * The chip's whole face is the edit link — at this density a 16px pencil fails
 * on a phone — so the reorder buttons sit above it on their own layer rather
 * than nested inside an anchor.
 */
function SpaceChip({ facilityId, space, canMoveUp, canMoveDown, onMove }: SpaceChipProps) {
  return (
    <div className="relative min-h-11 h-full rounded-lg border border-border bg-muted/40 transition-colors hover:bg-muted hover:border-blue-300">
      <Link
        href={`/dashboard/facilities/${facilityId}/spaces/${space.id}/edit`}
        aria-label={`Edit ${space.name}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      />

      <div className="relative flex flex-col justify-center gap-0.5 px-3 py-2 pr-9 pointer-events-none">
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
