import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { findOrgConflicts } from "@/lib/sessions/conflicts";
import ConflictManagerView from "@/components/conflicts/ConflictManagerView";

/**
 * /dashboard/conflicts — every double-booking currently in the org (active
 * sessions sharing a space with an overlapping occurrence, draft schedules
 * included), with actions to resolve or dismiss each one. See
 * 039_session_conflict_dismissals.sql and findOrgConflicts() for what backs
 * this and why it's computed on demand rather than from a persisted table.
 */
export default async function ConflictsPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const conflicts = await findOrgConflicts(supabase, orgContext.org.id);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Conflicts</h1>
        <p className="text-gray-500 mt-1">
          Sessions double-booked into the same space at the same time, and what to do about each one.
        </p>
      </div>
      <ConflictManagerView initialConflicts={conflicts} />
    </div>
  );
}
