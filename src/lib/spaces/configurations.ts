/**
 * Facility configurations (migration 048) — the vocabulary for "which state is
 * the building in".
 *
 * A 50m pool with a bulkhead is 8 long-course lanes or 16 short-course ones.
 * Those are different lane *sets*, so they are different `spaces` rows pointing
 * at different `facility_configurations`. A space with `configurationId === null`
 * exists in **every** configuration — the hot tub, the tennis court, and every
 * space at every facility that never sets one up, which is why none of this is
 * visible until a customer creates their first configuration.
 *
 * Four layers share these helpers, which is why they live here rather than in
 * any one of them: the lane pickers (SessionForm, CreateSessionDialog) group by
 * configuration, the map view filters its columns by it, the conflict scan uses
 * `configurationsDisagree` for its advisory, and every surface that names a
 * session's configuration goes through `configurationLabel`.
 *
 * See docs/PLAN-internal-view.md §3.
 */

/** The name staff read where a space belongs to no particular configuration. */
export const EVERY_CONFIGURATION_LABEL = "Every configuration";

/** A configuration as every picker needs it — id, name, and nothing else. */
export interface ConfigurationOption {
  id: string;
  name: string;
}

/** The only two fields grouping needs from a space. */
interface ConfigurableSpace {
  id: string;
  configurationId: string | null;
}

export interface ConfigurationGroup<T> {
  /** Null for the group of spaces that exist in every configuration. */
  configurationId: string | null;
  label: string;
  spaces: T[];
}

/**
 * Splits a space list into one group per configuration, in the order the
 * configurations were given (their `display_order`), with the
 * every-configuration spaces last.
 *
 * Returns a **single unlabelled group** when the facility has no
 * configurations, or when no space in the list belongs to one — the overwhelming
 * common case, and the signal callers use to render exactly the flat picker they
 * rendered before this existed. Empty groups are dropped, so a configuration
 * nobody has assigned lanes to yet does not produce a heading over nothing.
 */
export function groupSpacesByConfiguration<T extends ConfigurableSpace>(
  spaces: T[],
  configurations: ConfigurationOption[]
): ConfigurationGroup<T>[] {
  const anyAssigned = spaces.some((s) => s.configurationId !== null);
  if (configurations.length === 0 || !anyAssigned) {
    return [{ configurationId: null, label: EVERY_CONFIGURATION_LABEL, spaces }];
  }

  const groups: ConfigurationGroup<T>[] = configurations
    .map((c) => ({
      configurationId: c.id,
      label: c.name,
      spaces: spaces.filter((s) => s.configurationId === c.id),
    }))
    .filter((g) => g.spaces.length > 0);

  const shared = spaces.filter((s) => s.configurationId === null);
  if (shared.length > 0) {
    groups.push({ configurationId: null, label: EVERY_CONFIGURATION_LABEL, spaces: shared });
  }

  return groups;
}

/**
 * How a session's configuration is named, from the configurations its spaces
 * belong to.
 *
 * A session's configuration is *implied* by the lanes it claims — there is no
 * `sessions.configuration_id`, deliberately, because the lanes already say it
 * and a second copy could disagree with them. One name is the normal case;
 * `null` means the session claims only every-configuration spaces (or none) and
 * there is nothing to say. More than one is a mistake worth showing as one,
 * which is why they are joined rather than silently reduced to the first.
 */
export function configurationLabel(names: string[]): string | null {
  const distinct = [...new Set(names.filter((n) => n.trim().length > 0))];
  if (distinct.length === 0) return null;
  return distinct.join(" + ");
}

/**
 * Whether two sessions claim spaces from configurations that cannot both be
 * true at once — the predicate behind the cross-configuration advisory
 * (migration 048, decisions 4 and 5).
 *
 * A facility is in exactly one configuration at a time, so a long-course rental
 * overlapping a short-course drop-in means the bulkhead is in two places. It is
 * an advisory rather than a 409 because the sessions share no space at all: the
 * schema has no idea 50m Lane 3 and 25m Lane 5 are the same water, so this
 * function is reasoning about the building, not about a double-booking, and it
 * must never refuse a booking on the strength of that.
 *
 * False whenever either side names no configuration (every-configuration spaces
 * are compatible with everything, by definition) or when the two sides share
 * one.
 */
export function configurationsDisagree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const inA = new Set(a);
  return !b.some((id) => inA.has(id));
}
