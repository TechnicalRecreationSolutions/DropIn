import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { widgetConfigCacheTag } from "@/lib/cache/tags";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
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
  allow_print: false,
};

const UpdateConfigSchema = z.object({
  allowedTemplates: z.array(z.enum(["grid", "list", "map", "floorplan", "board"])).min(1).optional(),
  // Unlike allowedTemplates, an empty array is meaningful here: it's "no
  // filter bar at all", which is a legitimate choice. Unknown keys are
  // rejected rather than dropped — a typo'd filter that silently renders
  // nothing is exactly the kind of thing nobody notices for a month.
  enabledFilters: z.array(z.enum(SESSION_FILTER_KEYS)).optional(),
  allowPrint: z.boolean().optional(),
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
 * GET /api/widget-config?orgId=...
 *
 * Public — no auth required, mirrors the widget_configs_public_read RLS
 * policy. Returns the org's one configuration row, or defaults if it has
 * never been customised.
 *
 * It used to take facilityId/departmentId and address a different saved row
 * per combination. Migration 045 collapsed those to one row per org: which
 * sessions an embed shows is a property of the embed (its switcher entries and
 * its own data-facility-id), not a reason to keep a second set of colours.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ error: "Missing orgId" }, { status: 400 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("widget_configs")
    .select("*")
    .eq("org_id", orgId)
    .is("facility_id", null)
    .is("department_id", null)
    .maybeSingle();

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
      facility_id: null,
      department_id: null,
      ...DEFAULT_CONFIG,
    },
    scopes,
  });
}

/**
 * PATCH /api/widget-config
 *
 * Saves the authenticated org's one set of widget settings (migration 045 —
 * there is no longer a row per facility+department to address).
 * Scoped to allowed_templates/enabled_filters/allow_print/primary_color/
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
  const denied = requirePermission(membership, "widget:edit");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { allowedTemplates, primaryColor, secondaryColor, customTitle, enabledFilters, allowPrint, scopes } = parsed.data;

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
  if (allowPrint !== undefined) fields.allow_print = allowPrint;

  const { data, error } = await supabase
    .from("widget_configs")
    .upsert(
      {
        org_id: membership.org_id,
        // One row per org (migration 045) — always the org-wide one, so a
        // stale client can't recreate the per-facility split this collapsed.
        facility_id: null,
        department_id: null,
        ...fields,
      },
      { onConflict: "org_id,facility_id,department_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not save widget config" }, { status: 500 });
  }

  // The public facility pages cache this row for hours (see
  // facility/[facilitySlug]/page.tsx). `expire: 0` rather than "max": the
  // studio tells the admin a publish is live, so no visitor may get the old
  // settings after this returns. Here rather than at the end, because the
  // row is already written even if the scope list below fails.
  revalidateTag(widgetConfigCacheTag(membership.org_id), { expire: 0 });

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
