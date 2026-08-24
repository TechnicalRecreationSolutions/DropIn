/** Client-safe mirror of ConflictParticipant/OrgConflict
 *  (src/lib/sessions/conflicts.ts) — kept separate so client components
 *  don't import that file's server-only createClient type. */
export type ConflictParticipant = {
  sessionId: string;
  scheduleGroupId: string;
  scheduleGroupName: string;
  scheduleGroupStatus: "draft" | "published";
  facilityId: string;
  departmentId: string | null;
  rrule: string;
  dtstart: string;
  dtendTime: string;
  validFrom: string;
  validUntil: string | null;
  spaceIds: string[];
  spaceNames: string[];
};

export type OrgConflict = {
  key: string;
  sessionA: ConflictParticipant;
  sessionB: ConflictParticipant;
  spaceIds: string[];
  spaceNames: string[];
  occurrenceDate: string;
  occurrenceTime: string;
  dismissed: boolean;
  dismissalId: string | null;
  dismissalNote: string | null;
};
