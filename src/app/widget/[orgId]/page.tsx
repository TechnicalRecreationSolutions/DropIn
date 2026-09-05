import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import OrgImage from "@/components/media/OrgImage";
import { DEFAULT_ENABLED_FILTERS, parseEnabledFilters } from "@/lib/schedule/sessionFilters";
import WidgetScheduleClient from "./WidgetScheduleClient";

/**
 * "Aquatic Centre › Aquatics › Lane Swim" for a scope, dropping any level the
 * label already says (an admin who names a filter after its schedule shouldn't
 * get that word twice) and any level that is missing or unreadable.
 */
function scopeContext(label: string, levels: (string | null | undefined)[]): string | null {
  const normalized = label.trim().toLowerCase();
  const parts = levels.filter((n): n is string => !!n && n.trim().toLowerCase() !== normalized);
  return parts.length > 0 ? parts.join(" › ") : null;
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

  // allowedTemplates reflects the org's saved widget_configs row for this
  // exact facility+department scope by default. The configurator's own
  // unsaved preview passes ?preview=1&templates=grid,list to see a choice
  // before saving — a real embed never sends `preview`, so it always
  // renders the saved value regardless of what's in its query string.
  let widgetConfigQuery = supabase
    .from("widget_configs")
    // `*` rather than a column list, and deliberately so: this project applies
    // migrations by hand, so the code and the database can be briefly out of
    // step (see scripts/verify/README.md). Naming a column that hasn't landed
    // yet fails the whole query and takes every embedded widget down with it;
    // reading the row wholesale means a missing column degrades to the default
    // for that setting. The table is small and carries nothing private — the
    // public GET /api/widget-config already returns it in full.
    .select("*")
    .eq("org_id", orgId);
  widgetConfigQuery = facility ? widgetConfigQuery.eq("facility_id", facility.id) : widgetConfigQuery.is("facility_id", null);
  widgetConfigQuery = department ? widgetConfigQuery.eq("department_id", department.id) : widgetConfigQuery.is("department_id", null);
  const { data: widgetConfig } = await widgetConfigQuery.maybeSingle();

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
  let scopes: {
    id: string;
    label: string;
    facilityId: string;
    departmentId: string | null;
    scheduleGroupId: string | null;
    context: string | null;
  }[] = [];
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
      .map((s) => ({
        id: s.id,
        label: s.label,
        facilityId: s.facility_id,
        departmentId: s.department_id,
        scheduleGroupId: s.schedule_group_id,
        context: scopeContext(s.label, [
          s.facilities?.name,
          s.departments?.name,
          s.schedule_groups?.name,
        ]),
      }));
  }

  // With exactly one scope there is no switcher to name it, so the heading is
  // the only place that scope's name can appear — better than the generic
  // default. An org that set its own title still wins over both.
  const headerTitle = configuredTitle ?? (scopes.length === 1 ? scopes[0].label : "Schedule");

  // Which general filters (activity, day, time…) the visitor gets. Preview-only
  // override so the dashboard can show a toggle's effect before publishing it;
  // `parseEnabledFilters` drops anything that isn't a known key either way.
  const enabledFilters =
    isPreview && previewFilters !== undefined
      ? parseEnabledFilters(previewFilters)
      : parseEnabledFilters(widgetConfig?.enabled_filters ?? DEFAULT_ENABLED_FILTERS);

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
  // Floorplan only makes sense scoped to a single facility — an org-wide
  // embed (no facilityId) has no one facility map to show.
  const allowedTemplates = facility
    ? rawAllowedTemplates
    : rawAllowedTemplates.filter((t) => t !== "floorplan");

  // The widget's light/dark comes from the org's saved widget config, not from
  // the `.dark` class the dashboard toggles — this page renders in an iframe on
  // someone else's site, where that class never exists. So every colour on this
  // branch is written out explicitly: the neutral tokens resolve to their
  // *light* values here no matter what `theme` says, which would put dark grey
  // text on the dark widget.
  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen p-3 sm:p-4 ${isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900"}`}>
      <OrgThemeProvider primaryColor={primaryColor}>
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
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

        <WidgetScheduleClient
          orgId={org.id}
          facilityId={facility?.id}
          departmentId={department?.id}
          theme={theme === "dark" ? "dark" : "light"}
          allowedTemplates={allowedTemplates}
          scopes={scopes}
          title={headerTitle}
          enabledFilters={enabledFilters}
        />
      </OrgThemeProvider>
    </div>
  );
}
