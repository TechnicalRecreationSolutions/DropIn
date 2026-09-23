import type { OccupancyLevel, ReadingMetric } from "@/types/app.types";

/**
 * The wire contract for `GET /api/public/v1/facility/[facilityId]/conditions`.
 *
 * Versioned the same way as the directory (`src/lib/directory/types.ts`):
 * inside `v1`, adding a field is fine and clients must ignore what they do not
 * know; renaming one, removing one or changing its meaning is a `v2`. An
 * installed native app cannot be updated on our schedule.
 */

export interface ConditionReading {
  /** NULL when this is about the whole building. */
  spaceId: string | null;
  spaceName: string | null;
  metric: ReadingMetric;
  /**
   * The measured value — people, or degrees Celsius.
   *
   * **NULL for a head count in `level` mode**, where `level` carries the
   * answer instead. That is not a missing value: the facility chose to publish
   * a band rather than a number, and the number never leaves the database.
   */
  value: number | null;
  /** Set only for a head count in `level` mode. */
  level: OccupancyLevel | null;
  /** ISO. Never optional — a number without its age is a claim about now. */
  recordedAt: string;
  /**
   * The average for this weekday and hour over the preceding eight weeks, head
   * counts only, and only with three or more samples behind it.
   *
   * What the client falls back to when `recordedAt` has gone stale: "usually
   * about 35 at this time" is a useful sentence, and "40 people (four hours
   * ago)" is a misleading one.
   */
  typicalValue: number | null;
}

export interface ConditionsResponse {
  apiVersion: 1;
  /** Empty when the facility publishes nothing, or has nothing recent. */
  readings: ConditionReading[];
}
