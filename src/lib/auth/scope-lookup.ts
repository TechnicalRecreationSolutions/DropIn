import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Resolving "which department does this row belong to", for authorization.
 *
 * A coordinator's authority is department-scoped (migration 055), but almost
 * nothing they touch carries a `department_id` of its own — a session has only
 * a `schedule_group_id`, and a week review and a conflict dismissal are further
 * removed still. Every scoped route therefore has to walk the chain:
 *
 *   session → schedule_group → department
 *
 * These helpers are that walk, in one place, because doing it per route is how
 * two routes end up disagreeing about what a session's department is.
 *
 * ## The three-valued return, which callers must not flatten
 *
 *   `string`    the department id — ask `can()` with it
 *   `null`      the row exists and has NO department. A real answer: schedule
 *               groups, spaces and templates all have a nullable
 *               `department_id` (migrations 011, 012, 042) and rows like
 *               `Pickleball Open Play` are null today. Owner/manager territory;
 *               `can()` correctly refuses a coordinator.
 *   `undefined` no such row, or not in this org. A 404, never a 403 — and
 *               never to be conflated with `null`, which would silently hand
 *               managers authority over rows that do not exist while telling a
 *               coordinator their department is wrong.
 *
 * Every query is org-scoped, so a row in someone else's organization reads as
 * `undefined` rather than leaking its department.
 */
export type ScopeLookup = string | null | undefined;

export async function departmentOfScheduleGroup(
  supabase: ServerClient,
  scheduleGroupId: string,
  orgId: string
): Promise<ScopeLookup> {
  const { data } = await supabase
    .from("schedule_groups")
    .select("department_id")
    .eq("id", scheduleGroupId)
    .eq("org_id", orgId)
    .maybeSingle();

  return data ? data.department_id : undefined;
}

export async function departmentOfSession(
  supabase: ServerClient,
  sessionId: string,
  orgId: string
): Promise<ScopeLookup> {
  const { data } = (await supabase
    .from("sessions")
    .select("schedule_groups(department_id)")
    .eq("id", sessionId)
    .eq("org_id", orgId)
    .maybeSingle()) as unknown as {
    data: {
      schedule_groups:
        | { department_id: string | null }
        | { department_id: string | null }[]
        | null;
    } | null;
  };

  if (!data) return undefined;

  // PostgREST returns an embedded to-one as either an object or a one-element
  // array depending on how it resolved the relationship — the same unwrap
  // getOrgContext() does for `subscriptions`, for the same reason.
  const group = Array.isArray(data.schedule_groups)
    ? data.schedule_groups[0]
    : data.schedule_groups;

  return group ? group.department_id : undefined;
}

export async function departmentOfSpace(
  supabase: ServerClient,
  spaceId: string,
  orgId: string
): Promise<ScopeLookup> {
  const { data } = await supabase
    .from("spaces")
    .select("department_id")
    .eq("id", spaceId)
    .eq("org_id", orgId)
    .maybeSingle();

  return data ? data.department_id : undefined;
}

export async function departmentOfTemplate(
  supabase: ServerClient,
  templateId: string,
  orgId: string
): Promise<ScopeLookup> {
  const { data } = await supabase
    .from("session_templates")
    .select("department_id")
    .eq("id", templateId)
    .eq("org_id", orgId)
    .maybeSingle();

  return data ? data.department_id : undefined;
}
