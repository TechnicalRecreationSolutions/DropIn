/**
 * Option lists for schedule_groups' descriptive columns (activity_type,
 * age_group, skill_level). These attributes describe the program itself,
 * not any one occurrence, but they're edited from the sessions editor
 * (`SessionForm`) rather than the schedule form — see the note there.
 */

export const ACTIVITY_TYPES = [
  { value: "drop_in", label: "Drop-in" },
  { value: "open_gym", label: "Open Gym" },
  { value: "registered", label: "Registered Program" },
] as const;

export const AGE_GROUPS = [
  { value: "all_ages", label: "All ages" },
  { value: "youth", label: "Youth (under 18)" },
  { value: "adult", label: "Adult (18+)" },
  { value: "senior", label: "Senior (55+)" },
  { value: "family", label: "Family" },
] as const;

export const SKILL_LEVELS = [
  { value: "all_levels", label: "All levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;
