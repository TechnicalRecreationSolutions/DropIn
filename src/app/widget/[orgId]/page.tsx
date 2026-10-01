import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import OrgImage from "@/components/media/OrgImage";
import { DEFAULT_ENABLED_FILTERS, parseEnabledFilters } from "@/lib/schedule/sessionFilters";
import NoticeBanner from "@/components/status/NoticeBanner";
import { getPublicNotices } from "@/lib/status/public-notices";
import FacilityConditions from "@/components/conditions/FacilityConditions";
import { parseScopeLevels, type ScopeSchedule } from "@/lib/schedule/scopeSelection";
import WidgetScheduleClient from "./WidgetScheduleClient";

type Scope = {
  id: string;
  label: string;
  facilityId: string;
  departmentId: string | null;
  scheduleGroupId: string | null;
  facilityName: string;
  departmentName: string;
};

/**
 * Every schedule the visitor's Facility / Department / Schedule switcher can
 * reach, in display order — the tree lib/schedule/scopeSelection.ts derives
 * the three menus from, and resolves picks against.
 *
 * A saved filter is a *region* — a whole facility, one department, or one
 * schedule — and the switcher lets a visitor narrow inside it, the way the
 * landing hero does. A facility-wide filter contributes every live schedule in
 * the building (those with no department first, then each published
 * department's in order); a department-wide one, that department's; a
 * schedule-level one, just itself. The menus come from these, so "All
 * departments" and "All schedules" are what an empty menu means rather than
 * rows of their own.
 *
 * Publish state is filtered here for the same reason as the filter list
 * itself (see below): the dashboard preview carries the admin's session, so
 * RLS alone would show staff draft departments no visitor gets. A department
 * with no live schedule never appears — every session belongs to a schedule,
 * so picking it would only ever show an empty week. Duplicates collapse: two
 * filters on the same building still list each schedule once.
 */
async function buildScopeTree(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scopes: Scope[]
): Promise<ScopeSchedule[]> {
  const facilityIds = [...new Set(scopes.filter((s) => !s.scheduleGroupId).map((s) => s.facilityId))];
  const leafIds = [...new Set(scopes.flatMap((s) => (s.scheduleGroupId ? [s.scheduleGroupId] : [])))];
  if (facilityIds.length === 0 && leafIds.length === 0) return [];

  type GroupRow = {
    id: string;
    name: string;
    facility_id: string;
    department_id: string | null;
    ends_on: string | null;
    departments: { name: string; is_published: boolean } | null;
  };
  const groupSelect = "id, name, facility_id, department_id, ends_on, departments(name, is_published)";
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: departments }, { data: groups }, { data: leaves }] = await Promise.all([
    facilityIds.length > 0
      ? supabase
          .from("departments")
          .select("id, name, facility_id, display_order")
          .in("facility_id", facilityIds)
          .eq("is_published", true)
          .order("display_order")
          .order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; facility_id: string }[] }),
    facilityIds.length > 0
      ? supabase
          .from("schedule_groups")
          .select(groupSelect)
          .in("facility_id", facilityIds)
          .eq("status", "published")
          .order("display_order")
          .order("name")
          .overrideTypes<GroupRow[]>()
      : Promise.resolve({ data: [] as GroupRow[] }),
    leafIds.length > 0
      ? supabase.from("schedule_groups").select(groupSelect).in("id", leafIds).overrideTypes<GroupRow[]>()
      : Promise.resolve({ data: [] as GroupRow[] }),
  ]);
  const live = (groups ?? []).filter((g) => !g.ends_on || g.ends_on >= today);

  const tree: ScopeSchedule[] = [];
  const seen = new Set<string>();
  const add = (g: GroupRow, facilityName: string, departmentName: string | null, name = g.name) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    tree.push({
      id: g.id,
      name,
      facilityId: g.facility_id,
      facilityName,
      departmentId: g.department_id,
      departmentName,
    });
  };

  for (const scope of scopes) {
    if (scope.scheduleGroupId) {
      // Publish state of the schedule itself was checked with the filter row.
      const leaf = (leaves ?? []).find((g) => g.id === scope.scheduleGroupId);
      if (leaf && (!leaf.department_id || leaf.departments?.is_published)) {
        // Under the name the org gave the entry, as the switcher always showed it.
        add(leaf, scope.facilityName, leaf.departments?.name ?? null, scope.label || leaf.name);
      }
      continue;
    }
    if (!scope.departmentId) {
      // A schedule with no department has nowhere else to be picked from.
      for (const g of live.filter((g) => g.facility_id === scope.facilityId && !g.department_id)) {
        add(g, scope.facilityName, null);
      }
    }
    const depts = scope.departmentId
      ? [{ id: scope.departmentId, name: scope.departmentName }]
      : (departments ?? []).filter((d) => d.facility_id === scope.facilityId);
    for (const dept of depts) {
      for (const g of live.filter((g) => g.department_id === dept.id)) add(g, scope.facilityName, dept.name);
    }
  }
  return tree;
}

interface WidgetPageProps {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{
    facilityId?: string;
    departmentId?: string;
    theme?: string;
    templates?: string;
    preview?: string;
    /** Preview-only (see `preview` below): unsaved brand colour, "#rrggbb". */
    primary?: string;
    /** Preview-only: unsaved header title. */
    title?: string;
    /** Preview-only: unsaved enabled_filters, comma-separated. */
    filters?: string;
    /** Preview-only: unsaved allow_print, "1" or "0". */
    print?: string;
    /** Preview-only: unsaved multi_select_levels, comma-separated. */
    multi?: string;
    /** Preview-only: unsaved filters_collapsed, "1" or "0". */
    collapsed?: string;
  }>;
}

/**
 * /widget/[orgId] — The iframe-served schedule page.
 *
 * Served inside an iframe embedded on org websites — either the one
 * `public/embed/widget.js` builds, or one an org hand-wrote from step 4 of the
 * widget studio. Framing is permitted by `frame-ancestors *` on /widget/* in
 * next.config.ts (which also omits X-Frame-Options there, deliberately).
 * No auth required — only shows published programs/sessions.
 */
export default async function WidgetPage({ params, searchParams }: WidgetPageProps) {
  const { orgId } = await params;
  const {
    facilityId,
    departmentId,
    theme = "light",
    templates: previewTemplates,
    preview,
    primary: previewPrimary,
    title: previewTitle,
    filters: previewFilters,
    print: previewPrint,
    multi: previewMulti,
    collapsed: previewCollapsed,
  } = await searchParams;

  const supabase = await createClient();

  // Verify org exists and is active.
  //
  // Reads the organizations_public view, not the table. The table is
  // members-only since migration 026 — it carries email, phone, address and
  // stripe_customer_id, and RLS cannot restrict columns. The view exposes only
  // non-sensitive fields and already filters to status = 'active', so no status
  // predicate is needed (and `status` is not a column on it).
  const { data: org } = await supabase
    .from("organizations_public")
    .select("id, name, logo_url")
    .eq("id", orgId)
    .single();

  if (!org) notFound();

  // If facilityId provided, verify it belongs to this org
  let facility: { id: string; name: string } | null = null;
  if (facilityId) {
    const { data: f } = await supabase
      .from("facilities")
      .select("id, name")
      .eq("id", facilityId)
      .eq("org_id", orgId)
      .single();
    facility = f;
  }

  // If departmentId provided, verify it belongs to this org (and facility, if both given)
  let department: { id: string; name: string } | null = null;
  if (departmentId) {
    let deptQuery = supabase
      .from("departments")
      .select("id, name")
      .eq("id", departmentId)
      .eq("org_id", orgId);
    if (facilityId) deptQuery = deptQuery.eq("facility_id", facilityId);
    const { data: d } = await deptQuery.single();
    department = d;
  }

  // An org with exactly one published building: an unscoped embed is that
  // building's embed, so it can offer the floorplan. The studio's step 4
  // building picker only exists for multi-building orgs, so without this a
  // one-building org could never put its map in the widget. Used for the data
  // scope and the floorplan only — the header and print subtitle still follow
  // what the snippet actually named.
  let onlyFacility: { id: string; name: string } | null = null;
  if (!facility) {
    const { data: published } = await supabase
      .from("facilities")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("is_published", true)
      .limit(2);
    if (published?.length === 1) onlyFacility = published[0];
  }
  const dataFacility = facility ?? onlyFacility;

  // allowedTemplates reflects the org's saved widget_configs row for this
  // exact facility+department scope by default. The configurator's own
  // unsaved preview passes ?preview=1&templates=grid,list to see a choice
  // before saving — a real embed never sends `preview`, so it always
  // renders the saved value regardless of what's in its query string.
  // One row per org (migration 045). The facility/department in the request are
  // a *content* scope — which sessions to show — not an address for a second
  // set of settings, so an embed pasted on any page of the site carries the same
  // colour, views, heading and filters.
  const { data: widgetConfig } = await supabase
    .from("widget_configs")
    // `*` rather than a column list, and deliberately so: this project applies
    // migrations by hand, so the code and the database can be briefly out of
    // step (see scripts/verify/README.md). Naming a column that hasn't landed
    // yet fails the whole query and takes every embedded widget down with it;
    // reading the row wholesale means a missing column degrades to the default
    // for that setting. The table is small and carries nothing private — the
    // public GET /api/widget-config already returns it in full.
    .select("*")
    .eq("org_id", orgId)
    .is("facility_id", null)
    .is("department_id", null)
    .maybeSingle();

  // Brand colour and heading come from the saved config, except in the
  // dashboard's own preview iframe, which passes the not-yet-published values
  // so staff can see a choice before committing to it. Same rule as
  // `templates` below: a real embed never sends `preview`, so it can never
  // reach these branches. The colour is re-validated here rather than trusted
  // — it is written straight into a style attribute downstream.
  const isPreview = preview === "1";
  const previewColorValid = !!previewPrimary && /^#[0-9A-Fa-f]{6}$/.test(previewPrimary);
  const primaryColor =
    isPreview && previewColorValid ? previewPrimary! : widgetConfig?.primary_color ?? "#0066CC";
  const configuredTitle =
    (isPreview && previewTitle?.trim() ? previewTitle.trim().slice(0, 80) : widgetConfig?.custom_title?.trim()) || null;

  // Multi-schedule filter list — empty for the (default) single-scope embed,
  // so this is purely additive to existing embeds.
  //
  // Two things beyond the ids are loaded here. The **names** let the switcher
  // say which building/department/schedule is on screen, which a label alone
  // cannot ("Pool" is ambiguous the moment an org has two of them). The
  // **publish state** is filtered explicitly rather than left to RLS: the
  // anonymous policy from migration 043 already hides unpublished chains from
  // visitors, but the dashboard's preview iframe is same-origin and carries
  // the admin's own session, so relying on RLS alone showed staff a filter
  // list no visitor would ever get — a preview that lies in exactly the place
  // it is being used to check.
  type ScopeRow = {
    id: string;
    label: string;
    facility_id: string;
    department_id: string | null;
    schedule_group_id: string | null;
    facilities: { name: string; is_published: boolean } | null;
    departments: { name: string; is_published: boolean } | null;
    schedule_groups: { name: string; status: string } | null;
  };
  let scopes: Scope[] = [];
  if (widgetConfig?.id) {
    const { data: scopeRows } = await supabase
      .from("widget_config_scopes")
      .select(
        "id, label, facility_id, department_id, schedule_group_id, facilities(name, is_published), departments(name, is_published), schedule_groups(name, status)"
      )
      .eq("widget_config_id", widgetConfig.id)
      .order("sort_order", { ascending: true })
      .overrideTypes<ScopeRow[]>();
    scopes = (scopeRows ?? [])
      .filter(
        (s) =>
          s.facilities?.is_published === true &&
          (s.department_id === null || s.departments?.is_published === true) &&
          (s.schedule_group_id === null || s.schedule_groups?.status === "published")
      )
      // A snippet scoped to one facility (data-facility-id, and the department
      // with it) shows only that facility's entries — the switcher narrows with
      // the embed instead of ignoring it. Down to one entry the switcher
      // disappears on its own; down to none, the facility/department below
      // still scopes the sessions, which is what a pre-switcher embed did.
      .filter((s) => !facility || s.facility_id === facility.id)
      .filter((s) => !department || s.department_id === department.id)
      .map((s) => ({
        id: s.id,
        label: s.label,
        facilityId: s.facility_id,
        departmentId: s.department_id,
        scheduleGroupId: s.schedule_group_id,
        // The publish filter above guarantees the facility row, and a
        // department row whenever department_id is set.
        facilityName: s.facilities!.name,
        departmentName: s.departments?.name ?? "",
      }));
  }

  // With exactly one scope there is no switcher to name it, so the heading is
  // the only place that scope's name can appear — better than the generic
  // default. An org that set its own title still wins over both.
  const headerTitle = configuredTitle ?? (scopes.length === 1 ? scopes[0].label : "Schedule");

  const scopeTree = await buildScopeTree(supabase, scopes);

  // Switcher levels where visitors may tick several (migration 065). Same
  // preview-only override as the filters; a database without 065 has no key,
  // which parses to "one at a time everywhere".
  const multiSelectLevels =
    isPreview && previewMulti !== undefined
      ? parseScopeLevels(previewMulti)
      : parseScopeLevels(widgetConfig?.multi_select_levels);

  // Which general filters (activity, day, time…) the visitor gets. Preview-only
  // override so the dashboard can show a toggle's effect before publishing it;
  // `parseEnabledFilters` drops anything that isn't a known key either way.
  const enabledFilters =
    isPreview && previewFilters !== undefined
      ? parseEnabledFilters(previewFilters)
      : parseEnabledFilters(widgetConfig?.enabled_filters ?? DEFAULT_ENABLED_FILTERS);

  // Visitor Print button (migration 051). Same preview-only override as the
  // filters; `=== true` because a database without 051 yet has no such key.
  const allowPrint =
    isPreview && (previewPrint === "1" || previewPrint === "0")
      ? previewPrint === "1"
      : widgetConfig?.allow_print === true;

  // Whether the filter section starts collapsed (migration 066). Same
  // preview-only override; `=== true` because a database without 066 has no
  // such key, and open is how every embed rendered before it.
  const filtersCollapsed =
    isPreview && (previewCollapsed === "1" || previewCollapsed === "0")
      ? previewCollapsed === "1"
      : widgetConfig?.filters_collapsed === true;

  const validTemplates = ["grid", "list", "map", "floorplan", "board"] as const;
  function parseTemplateList(value: string | undefined): ("grid" | "list" | "map" | "floorplan" | "board")[] {
    if (!value) return [];
    return value
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is "grid" | "list" | "map" | "floorplan" | "board" => (validTemplates as readonly string[]).includes(t));
  }

  const previewList = parseTemplateList(previewTemplates);
  const rawAllowedTemplates =
    isPreview && previewList.length > 0
      ? previewList
      : widgetConfig?.allowed_templates ?? ["grid", "list", "map"];
  // Floorplan draws one building, so it needs one: named by the snippet,
  // inferred for a one-building org, or taken from the switcher — every entry
  // names a facility and WidgetScheduleClient hands the selected entry's to
  // the view, so the map follows the visitor's pick. Only an embed across
  // several buildings with no switcher has no one map to show.
  const allowedTemplates = dataFacility || scopes.length > 0
    ? rawAllowedTemplates
    : rawAllowedTemplates.filter((t) => t !== "floorplan");

  // The widget's light/dark comes from the org's saved widget config, not from
  // the `.dark` class the dashboard toggles — this page renders in an iframe on
  // someone else's site, where that class never exists. So every colour on this
  // branch is written out explicitly: the neutral tokens resolve to their
  // *light* values here no matter what `theme` says, which would put dark grey
  // text on the dark widget.
  const isDark = theme === "dark";

  // Facility status, above the schedule (migration 060).
  //
  // Only when the embed resolves to ONE building — named by the snippet, or
  // inferred for a one-building org. `dataFacility` is already exactly that
  // question, asked for the floorplan. An embed spanning several buildings has
  // no single facility to speak for, and stacking every building's notices
  // above a schedule the visitor has not yet narrowed would bury the one that
  // applies to them.
  //
  // The visitor can then narrow further with the scope switcher, which is
  // client-side and does not re-run this. That is a known limit rather than an
  // oversight: the notices shown are the building's, and a per-space notice
  // names its space in its own metadata line.
  const notices = dataFacility ? await getPublicNotices(dataFacility.id) : [];

  return (
    <div className={`min-h-screen p-3 sm:p-4 print:min-h-0 print:p-0 print:bg-white ${isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900"}`}>
      <OrgThemeProvider primaryColor={primaryColor}>
        {/* Header */}
        <div className="mb-4 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2.5 min-w-0">
            {org.logo_url && (
              <span className="relative size-8 rounded-md shrink-0 overflow-hidden border border-gray-200 bg-white">
                <OrgImage src={org.logo_url} alt="" sizes="32px" className="object-contain" />
              </span>
            )}
            <div className="min-w-0">
              <p className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                {org.name}
              </p>
              {facility && (
                <h2 className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                  {facility.name}{department ? ` · ${department.name}` : ""}
                </h2>
              )}
            </div>
          </div>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-600 font-medium"
          >
            dropin.app ↗
          </a>
        </div>

        {/* Not print:hidden — a widget printed from a host page is a schedule
            someone is about to act on. Compact, because an embed is routinely
            320px wide. `variant` is explicit: the iframe has no .dark class,
            so dark: utilities never fire here (see NoticeBanner's header). */}
        <NoticeBanner notices={notices} variant={isDark ? "dark" : "light"} compact />

        {/* Same one-building rule as the notices above: an embed spanning
            several has no single facility whose water temperature this is. */}
        {dataFacility && (
          <div className="print:hidden">
            <FacilityConditions
              facilityId={dataFacility.id}
              variant={isDark ? "dark" : "light"}
            />
          </div>
        )}

        <WidgetScheduleClient
          orgId={org.id}
          facilityId={dataFacility?.id}
          departmentId={department?.id}
          theme={theme === "dark" ? "dark" : "light"}
          allowedTemplates={allowedTemplates}
          scopeTree={scopeTree}
          firstScope={scopes[0]}
          multiSelectLevels={multiSelectLevels}
          title={headerTitle}
          enabledFilters={enabledFilters}
          filtersCollapsed={filtersCollapsed}
          allowPrint={allowPrint}
          printSubtitle={[org.name, facility?.name, department?.name].filter(Boolean).join(" · ")}
        />
      </OrgThemeProvider>
    </div>
  );
}
