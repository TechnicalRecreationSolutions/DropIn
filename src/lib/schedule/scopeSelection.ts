/**
 * The visitor's Facility / Department / Schedule switcher, as data.
 *
 * One model for the real embed, the studio's preview (an iframe of the embed)
 * and the landing hero, so the three cannot disagree about what a pick means.
 *
 * - The **tree** is every schedule a widget can show, in display order, each
 *   carrying its facility and department. Facilities and departments are
 *   derived from it, so a level can never offer something with nothing under
 *   it, and the tree *is* the region the org configured: nothing outside it
 *   can be picked.
 * - A **selection** ticks ids at each level. Nothing ticked at a level means
 *   "All …" at that level — the same rule as the filter bar's dropdowns.
 * - Levels combine like the filter bar's filters do: any of the ticks within a
 *   level, and every level at once. A schedule is shown when it passes all
 *   three. Each level only offers what passes the levels above it.
 *
 * The result is a set of schedules (`resolveSchedules`), which is what the
 * embed asks the sessions endpoint for. Asking by schedule rather than by
 * facility or department keeps a pick exactly inside the configured region: a
 * widget set to one schedule of building A and all of building B must not show
 * the rest of A when the visitor leaves everything on "All".
 */

export type ScopeLevel = "facility" | "department" | "schedule";

export const SCOPE_LEVELS: ScopeLevel[] = ["facility", "department", "schedule"];

export const ALL_LABELS: Record<ScopeLevel, string> = {
  facility: "All facilities",
  department: "All departments",
  schedule: "All schedules",
};

/** One pickable schedule — a leaf of the switcher. */
export interface ScopeSchedule {
  id: string;
  name: string;
  facilityId: string;
  facilityName: string;
  /** Null for a schedule that sits on the facility with no department. */
  departmentId: string | null;
  departmentName: string | null;
}

export interface ScopeSelection {
  facilities: string[];
  departments: string[];
  schedules: string[];
}

export const EMPTY_SCOPE_SELECTION: ScopeSelection = {
  facilities: [],
  departments: [],
  schedules: [],
};

export interface ScopeOption {
  value: string;
  label: string;
  /** Where it is, when the list spans several places — e.g. the building
   *  beside a department name that two buildings share. */
  detail?: string;
}

const KEY: Record<ScopeLevel, keyof ScopeSelection> = {
  facility: "facilities",
  department: "departments",
  schedule: "schedules",
};

function passes(s: ScopeSchedule, sel: ScopeSelection, upTo: ScopeLevel): boolean {
  if (sel.facilities.length > 0 && !sel.facilities.includes(s.facilityId)) return false;
  if (upTo === "facility") return true;
  if (sel.departments.length > 0 && !(s.departmentId && sel.departments.includes(s.departmentId))) return false;
  if (upTo === "department") return true;
  return sel.schedules.length === 0 || sel.schedules.includes(s.id);
}

/** The schedules the selection shows. */
export function resolveSchedules(tree: ScopeSchedule[], sel: ScopeSelection): ScopeSchedule[] {
  return tree.filter((s) => passes(s, sel, "schedule"));
}

/** What a level offers, given the ticks on the levels above it. */
export function scopeOptions(tree: ScopeSchedule[], sel: ScopeSelection, level: ScopeLevel): ScopeOption[] {
  if (level === "facility") {
    return uniqueBy(tree, (s) => s.facilityId).map((s) => ({ value: s.facilityId, label: s.facilityName }));
  }
  if (level === "department") {
    const under = tree.filter((s) => s.departmentId && passes(s, sel, "facility"));
    const manyFacilities = new Set(under.map((s) => s.facilityId)).size > 1;
    return uniqueBy(under, (s) => s.departmentId!).map((s) => ({
      value: s.departmentId!,
      label: s.departmentName ?? "",
      detail: manyFacilities ? s.facilityName : undefined,
    }));
  }
  const under = tree.filter((s) => passes(s, sel, "department"));
  const places = new Set(under.map((s) => `${s.facilityId}|${s.departmentId ?? ""}`)).size > 1;
  const manyFacilities = new Set(under.map((s) => s.facilityId)).size > 1;
  return under.map((s) => ({
    value: s.id,
    label: s.name,
    detail: places
      ? manyFacilities
        ? [s.facilityName, s.departmentName].filter(Boolean).join(" · ")
        : (s.departmentName ?? s.facilityName)
      : undefined,
  }));
}

/** Drops ticks the levels above no longer offer — after a level changes. */
export function pruneSelection(tree: ScopeSchedule[], sel: ScopeSelection): ScopeSelection {
  const out = { ...sel };
  for (const level of SCOPE_LEVELS) {
    const offered = new Set(scopeOptions(tree, out, level).map((o) => o.value));
    out[KEY[level]] = out[KEY[level]].filter((id) => offered.has(id));
  }
  return out;
}

/** Sets one level's ticks and re-fits the levels below it. */
export function setLevel(
  tree: ScopeSchedule[],
  sel: ScopeSelection,
  level: ScopeLevel,
  ids: string[]
): ScopeSelection {
  return pruneSelection(tree, { ...sel, [KEY[level]]: ids });
}

export function ticked(sel: ScopeSelection, level: ScopeLevel): string[] {
  return sel[KEY[level]];
}

/**
 * Where a widget opens: on the org's first configured entry, narrowed the way
 * that entry is — a facility, a department of it, or one schedule. Not "All",
 * so an org with five buildings does not greet a visitor with all five at
 * once; clearing a level gets there.
 */
export function initialSelection(
  tree: ScopeSchedule[],
  first: { facilityId: string; departmentId: string | null; scheduleGroupId: string | null } | undefined
): ScopeSelection {
  if (!first) return EMPTY_SCOPE_SELECTION;
  const leaf = first.scheduleGroupId ? tree.find((s) => s.id === first.scheduleGroupId) : undefined;
  const departmentId = first.departmentId ?? leaf?.departmentId ?? null;
  return pruneSelection(tree, {
    facilities: [first.facilityId],
    departments: departmentId ? [departmentId] : [],
    schedules: first.scheduleGroupId ? [first.scheduleGroupId] : [],
  });
}

/**
 * The one facility the selection is inside, if it is inside exactly one —
 * what the floorplan and the building's notices need.
 */
export function singleFacilityId(tree: ScopeSchedule[], sel: ScopeSelection): string | null {
  const ids = new Set(resolveSchedules(tree, sel).map((s) => s.facilityId));
  return ids.size === 1 ? [...ids][0] : null;
}

/** What a level's button says: "All …", the one choice, or a short list. */
export function summarizeLevel(options: ScopeOption[], selected: string[], level: ScopeLevel): string {
  const picked = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  if (picked.length === 0) return ALL_LABELS[level];
  if (picked.length <= 2) return picked.join(", ");
  return `${picked.length} selected`;
}

/** The selection for print and screen readers: the levels that narrow, joined. */
export function describeSelection(tree: ScopeSchedule[], sel: ScopeSelection): string {
  return SCOPE_LEVELS.map((level) => {
    const ids = ticked(sel, level);
    return ids.length === 0 ? null : summarizeLevel(scopeOptions(tree, sel, level), ids, level);
  })
    .filter(Boolean)
    .join(" › ");
}

/** Parses a stored or URL list of levels, dropping anything unknown. */
export function parseScopeLevels(value: unknown): ScopeLevel[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return SCOPE_LEVELS.filter((l) => raw.map((v) => String(v).trim()).includes(l));
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
