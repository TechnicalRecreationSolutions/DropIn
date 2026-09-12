import type { ExpandedSession } from "@/types/schedule.types";

/**
 * The occupancy/disclosure vocabulary (migration 046), in one place because
 * three layers have to agree on it: SessionForm offers the choices,
 * POST /api/sessions validates them, and conflicts.ts derives the space
 * semantics from them. See docs/PLAN-internal-view.md §1.
 */

export type OccupancyKind = "drop_in" | "program" | "rental" | "closure";
export type Disclosure = "public" | "reserved" | "internal";

/**
 * What a booking does to the space it claims.
 *
 * `defaultDisclosure` is only a starting point the form applies when staff pick
 * a kind — the two axes are deliberately independent. Swim lessons are
 * exclusive but should be advertised; a rental is exclusive and should not be.
 */
export const OCCUPANCY_KINDS: {
  value: OccupancyKind;
  label: string;
  /** Shown under the picker — says what the choice does, not what it is called. */
  hint: string;
  defaultDisclosure: Disclosure;
}[] = [
  {
    value: "drop_in",
    label: "Drop-in",
    hint: "Open to the public in whatever space is left over. This is the schedule patrons come for.",
    defaultDisclosure: "public",
  },
  {
    value: "program",
    label: "Program or lesson",
    hint: "Takes its spaces outright. Patrons see the name — lessons and registered programs are worth advertising.",
    defaultDisclosure: "public",
  },
  {
    value: "rental",
    label: "Rental or club",
    hint: "Takes its spaces outright. Patrons see only that the space is taken; staff see who has it.",
    defaultDisclosure: "reserved",
  },
  {
    value: "closure",
    label: "Closure or maintenance",
    hint: "Takes its spaces outright. Usually worth publishing — patrons need to know before they drive over.",
    defaultDisclosure: "public",
  },
];

/** What patrons are told about a session, in the words staff choose from. */
export const DISCLOSURE_OPTIONS: {
  value: Disclosure;
  label: string;
  hint: string;
}[] = [
  { value: "public", label: "The name", hint: "Published exactly as it is today." },
  {
    value: "reserved",
    label: "Only that it is taken",
    hint: "The time and spaces are published; the name is not. Staff still see it.",
  },
  {
    value: "internal",
    label: "Nothing at all",
    hint: "Invisible to patrons. Use for holds, staff training, or anything with no public consequence.",
  },
];

/**
 * True when this kind claims its spaces outright.
 *
 * Derived rather than stored (migration 046, decision 2): `drop_in` is
 * *residual* — it occupies whatever is not exclusively claimed, which is why a
 * rental overlapping a drop-in block on the same lane is not a double-booking.
 * Two exclusive claims on one space still are.
 */
export function isExclusiveKind(kind: OccupancyKind): boolean {
  return kind !== "drop_in";
}

/**
 * Whether two sessions can genuinely double-book a shared space.
 *
 * Exclusive vs residual is not a conflict in either direction — the residual
 * block claims the remainder, so there is nothing to contend over. Everything
 * else (exclusive/exclusive, and residual/residual, which is two open swims
 * booked over each other) is left exactly as it behaved before 046.
 */
export function claimsCanCollide(a: OccupancyKind, b: OccupancyKind): boolean {
  return isExclusiveKind(a) === isExclusiveKind(b);
}

/**
 * What patrons read in place of a withheld name.
 *
 * A constant for now. Making it an org setting is listed in
 * docs/PLAN-internal-view.md §10 and is a one-column change when the wording
 * is decided — the point of routing every caller through here is that it will
 * be a one-line change too.
 */
export const RESERVED_PUBLIC_LABEL = "Reserved";

/**
 * The name to render for an occurrence, from the caller's own point of view.
 *
 * Safe for public surfaces by construction, and deliberately so: `holderName`
 * is only ever populated for org members, because it comes from
 * `session_internal`, which anon cannot read (migration 046, decision 4). A
 * public caller therefore falls through to the label the API already
 * substituted. No caller has to know which audience it is serving.
 */
export function sessionDisplayLabel(session: ExpandedSession): string {
  return session.holderName ?? session.templateName ?? session.scheduleGroupName;
}
