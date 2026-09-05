import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { DEFAULT_ENABLED_FILTERS, SESSION_FILTER_KEYS } from "@/lib/schedule/sessionFilters";
import type { Database } from "@/types/database.types";

const DEFAULT_CONFIG = {
  primary_color: "#0066CC",
  secondary_color: "#FFFFFF",
  font_family: "Inter",
  show_cost: true,
  show_location: true,
  show_age_group: true,
  time_range_start: "06:00",
  time_range_end: "22:00",
  program_ids: null as string[] | null,
  custom_title: null as string | null,
  allowed_templates: ["grid", "list", "map"] as ("grid" | "list" | "map" | "floorplan" | "board")[],
  enabled_filters: [...DEFAULT_ENABLED_FILTERS],
};

const UpdateConfigSchema = z.object({
  facilityId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  allowedTemplates: z.array(z.enum(["grid", "list", "map", "floorplan", "board"])).min(1).optional(),
  // Unlike allowedTemplates, an empty array is meaningful here: it's "no
  // filter bar at all", which is a legitimate choice. Unknown keys are
  // rejected rather than dropped — a typo'd filter that silently renders
  // nothing is exactly the kind of thing nobody notices for a month.
  enabledFilters: z.array(z.enum(SESSION_FILTER_KEYS)).optional(),
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  customTitle: z.string().nullable().optional(),
  // Undefined = leave the saved filter list alone (an appearance-only save
  // shouldn't wipe it). [] explicitly clears it back to "no filter UI".
  scopes: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        facilityId: z.string().uuid(),
        departmentId: z.string().uuid().nullish(),
        scheduleGroupId: z.string().uuid().nullish(),
      })
    )
    .max(20)
    .optional(),
});

/**
 * GET /api/widget-config?orgId=...&facilityId=...&departmentId=...
 *
 * Public — no auth required, mirrors the widget_configs_public_read RLS
 * policy. Returns the config scoped to the given facility+department
 * combination (both optional; omitted = org-wide default row), or defaults
 * if that specific scope hasn't been customized yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const facilityId = url.searchParams.get("facilityId");
  const departmentId = url.searchParams.get("departmentId");
  if (!orgId) return NextResponse.json({ error: "Missing orgId" }, { status: 400 });

  const supabase = await createClient();
  let query = supabase.from("widget_configs").select("*").eq("org_id", orgId);
  query = facilityId ? query.eq("facility_id", facilityId) : query.is("facility_id", null);
  query = departmentId ? query.eq("department_id", departmentId) : query.is("department_id", null);

  const { data } = await query.maybeSingle();

  // Scopes live on the widget_configs row's own id, not its (org, facility,
  // department) key — no saved row yet means no filter list to load either.
  let scopes: Database["public"]["Tables"]["widget_config_scopes"]["Row"][] = [];
  if (data?.id) {
    const { data: scopeRows } = await supabase
      .from("widget_config_scopes")
      .select("*")
      .eq("widget_config_id", data.id)
      .order("sort_order", { ascending: true });
    scopes = scopeRows ?? [];
  }

  return NextResponse.json({
    config: data ?? {
      org_id: orgId,
      facility_id: facilityId ?? null,
      department_id: departmentId ?? null,
      ...DEFAULT_CONFIG,
    },
    scopes,
  });
}

/**
 * PATCH /api/widget-config
 *
 * Saves the authenticated org's widget appearance settings for a given
 * facility+department scope (both optional — omitted saves the org-wide
 * default config). Scoped to allowed_templates/enabled_filters/primary_color/
 * secondary_color/custom_title for now — font_family, show_cost,
 * show_location, show_age_group, time_range_start, time_range_end, and
 * program_ids remain unwired. org_id is always derived server-side, never
 * trusted from the request body.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage the widget" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { facilityId, departmentId, allowedTemplates, primaryColor, secondaryColor, customTitle, enabledFilters, scopes } = parsed.data;

  // Verify facility/department belong to the caller's own org before scoping a config to them.
  if (facilityId) {
    const { data: facility } = await supabase
      .from("facilities")
      .select("id")
      .eq("id", facilityId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  if (departmentId) {
    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  // Verify every scope entry's facility/department/schedule actually belongs
  // to the caller's org and that department/schedule sit under the facility
  // the entry claims — one bad id shouldn't silently pass through as a
  // legit-looking filter option in the public widget. Where a schedule is
  // given, its own department_id is the source of truth for the scope's
  // department (rather than trusting the submitted one), so a scope can name
  // just a schedule without also having to re-derive its department.
  let resolvedScopes:
    | { label: string; facilityId: string; departmentId: string | null; scheduleGroupId: string | null }[]
    | undefined;
  if (scopes !== undefined) {
    const facilityIds = [...new Set(scopes.map((s) => s.facilityId))];
    const departmentIds = [...new Set(scopes.map((s) => s.departmentId).filter((v): v is string => !!v))];
    const scheduleGroupIds = [...new Set(scopes.map((s) => s.scheduleGroupId).filter((v): v is string => !!v))];

    const [{ data: scopeFacilities }, { data: scopeDepartments }, { data: scopeScheduleGroups }] = await Promise.all([
      facilityIds.length
        ? supabase.from("facilities").select("id").eq("org_id", membership.org_id).in("id", facilityIds)
        : Promise.resolve({ data: [] as { id: string }[] }),
      departmentIds.length
        ? supabase.from("departments").select("id, facility_id").eq("org_id", membership.org_id).in("id", departmentIds)
        : Promise.resolve({ data: [] as { id: string; facility_id: string }[] }),
      scheduleGroupIds.length
        ? supabase
            .from("schedule_groups")
            .select("id, facility_id, department_id")
            .eq("org_id", membership.org_id)
            .in("id", scheduleGroupIds)
        : Promise.resolve({ data: [] as { id: string; facility_id: string; department_id: string | null }[] }),
    ]);

    const validFacilityIds = new Set((scopeFacilities ?? []).map((f) => f.id));
    const departmentById = new Map((scopeDepartments ?? []).map((d) => [d.id, d]));
    const scheduleGroupById = new Map((scopeScheduleGroups ?? []).map((sg) => [sg.id, sg]));

    resolvedScopes = [];
    for (const scope of scopes) {
      if (!validFacilityIds.has(scope.facilityId)) {
        return NextResponse.json({ error: "Scope references a facility outside your organization" }, { status: 404 });
      }

      if (scope.scheduleGroupId) {
        const sg = scheduleGroupById.get(scope.scheduleGroupId);
        if (!sg || sg.facility_id !== scope.facilityId) {
          return NextResponse.json({ error: "Scope references an invalid schedule" }, { status: 404 });
        }
        resolvedScopes.push({
          label: scope.label,
          facilityId: scope.facilityId,
          departmentId: sg.department_id,
          scheduleGroupId: scope.scheduleGroupId,
        });
        continue;
      }

      if (scope.departmentId) {
        const dept = departmentById.get(scope.departmentId);
        if (!dept || dept.facility_id !== scope.facilityId) {
          return NextResponse.json({ error: "Scope references an invalid department" }, { status: 404 });
        }
      }

      resolvedScopes.push({
        label: scope.label,
        facilityId: scope.facilityId,
        departmentId: scope.departmentId ?? null,
        scheduleGroupId: null,
      });
    }
  }

  const fields: Database["public"]["Tables"]["widget_configs"]["Update"] = {};
  if (allowedTemplates !== undefined) fields.allowed_templates = allowedTemplates;
  if (primaryColor !== undefined) fields.primary_color = primaryColor;
  if (secondaryColor !== undefined) fields.secondary_color = secondaryColor;
  if (customTitle !== undefined) fields.custom_title = customTitle;
  if (enabledFilters !== undefined) fields.enabled_filters = enabledFilters;

  const { data, error } = await supabase
    .from("widget_configs")
    .upsert(
      {
        org_id: membership.org_id,
        facility_id: facilityId ?? null,
        department_id: departmentId ?? null,
        ...fields,
      },
      { onConflict: "org_id,facility_id,department_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not save widget config" }, { status: 500 });
  }

  // Replace-the-whole-list rather than a diff — the list is short (max 20)
  // and this keeps sort_order trivially correct without a separate reorder
  // step. Delete-then-insert only runs when the caller actually sent `scopes`.
  let scopeRows: Database["public"]["Tables"]["widget_config_scopes"]["Row"][] = [];
  if (resolvedScopes !== undefined) {
    const { error: deleteError } = await supabase
      .from("widget_config_scopes")
      .delete()
      .eq("widget_config_id", data.id);
    if (deleteError) {
      return NextResponse.json({ error: "Could not save widget filters" }, { status: 500 });
    }

    if (resolvedScopes.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from("widget_config_scopes")
        .insert(
          resolvedScopes.map((s, index) => ({
            widget_config_id: data.id,
            org_id: membership.org_id,
            label: s.label,
            facility_id: s.facilityId,
            department_id: s.departmentId,
            schedule_group_id: s.scheduleGroupId,
            sort_order: index,
          }))
        )
        .select("*");
      if (insertError || !inserted) {
        return NextResponse.json({ error: "Could not save widget filters" }, { status: 500 });
      }
      scopeRows = inserted;
    }
  }

  return NextResponse.json({ config: data, scopes: scopeRows });
}
