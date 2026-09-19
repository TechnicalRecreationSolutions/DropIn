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
