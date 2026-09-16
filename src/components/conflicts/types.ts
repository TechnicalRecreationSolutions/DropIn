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
  occupancyKind: "drop_in" | "program" | "rental" | "closure";
  disclosure: "public" | "reserved" | "internal";
};

export type OrgConflict = {
  /** Always "conflict" — same space, same time. See OrgConflict in
   *  src/lib/sessions/conflicts.ts. */
  severity: "conflict";
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
