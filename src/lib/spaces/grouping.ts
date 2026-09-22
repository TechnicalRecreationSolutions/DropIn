/**
 * Department → zone grouping for a building's spaces, shared by the Spaces
 * page (`SpaceSections`) and the map editor's spaces sidebar
 * (`MapSpacesPanel`). One implementation on purpose: the map is meant to
 * read as a picture of the Spaces page, so a space must land in the same
 * section and zone on both — two copies of this logic would drift.
 */

export interface GroupableSpace {
  id: string;
  isPublished: boolean;
  /** Null for spaces that sit directly under the facility. */
  departmentId: string | null;
  /** Free-text label (migration 054); "" and null both mean "not in a zone". */
  zoneName?: string | null;
}

/** One zone's worth of spaces inside a department — `zoneName` null = not in a zone. */
export interface ZoneGroup<T extends GroupableSpace> {
  zoneName: string | null;
  spaces: T[];
}

export interface SpaceSection<T extends GroupableSpace> {
  /** Null for the "whole building" bucket, which always sorts last. */
  departmentId: string | null;
  label: string;
  zones: ZoneGroup<T>[];
  total: number;
  published: number;
}

/** "" and null both mean "not in a zone" — see the API's normalization note. */
export function zoneKeyOf(space: GroupableSpace): string | null {
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
 * vanishing, because `flattenSections` has to return the full facility.
 */
export function buildSpaceSections<T extends GroupableSpace>(
  spaces: T[],
  departments: { id: string; name: string }[]
): SpaceSection<T>[] {
  const known = new Set(departments.map((d) => d.id));
  const sections: SpaceSection<T>[] = [];

  const push = (departmentId: string | null, label: string, members: T[]) => {
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
function buildZones<T extends GroupableSpace>(spaces: T[]): ZoneGroup<T>[] {
  const zones: ZoneGroup<T>[] = [];
  const byName = new Map<string, ZoneGroup<T>>();
  let ungrouped: ZoneGroup<T> | null = null;

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
export function flattenSections<T extends GroupableSpace>(sections: SpaceSection<T>[]): T[] {
  return sections.flatMap((section) => section.zones.flatMap((zone) => zone.spaces));
}

/** Where a space sits in the rendered grouping: its zone, and its index in it. */
interface SpaceLocation<T extends GroupableSpace> {
  zone: ZoneGroup<T>;
  index: number;
}

/**
 * Takes already-built sections rather than building its own, because two
 * spaces are compared by whether they came back in the SAME zone object.
 * Locating each from its own `buildSpaceSections` pass gives two equal-looking
 * zones that are never identical, and every drop is refused.
 */
function locateIn<T extends GroupableSpace>(
  sections: SpaceSection<T>[],
  spaceId: string
): SpaceLocation<T> | null {
  for (const section of sections) {
    for (const zone of section.zones) {
      const index = zone.spaces.findIndex((s) => s.id === spaceId);
      if (index >= 0) return { zone, index };
    }
  }
  return null;
}

/**
 * Move one space to another slot inside ITS OWN zone, and return the whole
 * facility in the new render order — exactly the list `/api/spaces/reorder`
 * wants (see that route on why a partial list cannot be accepted).
 *
 * Returns null when the move is impossible or a no-op, so callers can bail
 * without writing: unknown space, an index off either end of the zone, or a
 * landing spot the space already occupies.
 *
 * Zone-bound on purpose, for both the arrows and the drag. A zone is
 * `zone_name` and a section is `department_id`; crossing either is a change of
 * WHICH department or zone a space belongs to, not of its position, and that
 * is a different write on a different route. Reordering here only ever
 * renumbers `display_order`.
 */
export function moveSpaceWithinZone<T extends GroupableSpace>(
  spaces: T[],
  departments: { id: string; name: string }[],
  spaceId: string,
  targetIndex: number
): T[] | null {
  const sections = buildSpaceSections(spaces, departments);
  const found = locateIn(sections, spaceId);
  if (!found) return null;

  const { zone, index } = found;
  if (targetIndex < 0 || targetIndex >= zone.spaces.length || targetIndex === index) return null;

  // Lift-and-insert rather than swap: dropping A onto B has to put A where B
  // was and push the rest along, and for the arrows (where the two are always
  // adjacent) that is the same thing a swap did.
  //
  // Mutates the freshly grouped copy, never the caller's list — the optimistic
  // state on the page is re-rendered from the return value.
  const [moved] = zone.spaces.splice(index, 1);
  zone.spaces.splice(targetIndex, 0, moved);

  return flattenSections(sections);
}

/** One step up or down the zone — what the chip's arrows do. */
export function moveSpaceByStep<T extends GroupableSpace>(
  spaces: T[],
  departments: { id: string; name: string }[],
  spaceId: string,
  delta: -1 | 1
): T[] | null {
  const found = locateIn(buildSpaceSections(spaces, departments), spaceId);
  if (!found) return null;
  return moveSpaceWithinZone(spaces, departments, spaceId, found.index + delta);
}

/**
 * Drop one space onto another — what a drag does. The dragged space takes the
 * target's slot; a target in a different zone or department is refused (null)
 * rather than approximated, per `moveSpaceWithinZone`.
 */
export function moveSpaceOnto<T extends GroupableSpace>(
  spaces: T[],
  departments: { id: string; name: string }[],
  spaceId: string,
  overSpaceId: string
): T[] | null {
  if (spaceId === overSpaceId) return null;

  // One grouping pass for both, so "same zone" can be object identity — see
  // the note on `locateIn`.
  const sections = buildSpaceSections(spaces, departments);
  const from = locateIn(sections, spaceId);
  const to = locateIn(sections, overSpaceId);
  if (!from || !to || from.zone !== to.zone) return null;

  return moveSpaceWithinZone(spaces, departments, spaceId, to.index);
}

/**
 * The ids a space can legally be dropped onto: every space in its own zone,
 * itself included. Read once when a drag starts, so each chip can say whether
 * it is a target without re-grouping the whole facility on every render.
 */
export function zoneSiblingIds<T extends GroupableSpace>(
  spaces: T[],
  departments: { id: string; name: string }[],
  spaceId: string
): string[] {
  const found = locateIn(buildSpaceSections(spaces, departments), spaceId);
  return found ? found.zone.spaces.map((s) => s.id) : [];
}
