import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import OrgImage from "@/components/media/OrgImage";
import WidgetScheduleClient from "./WidgetScheduleClient";

interface WidgetPageProps {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{
    facilityId?: string;
    departmentId?: string;
    theme?: string;
    templates?: string;
    preview?: string;
  }>;
}

/**
 * /widget/[orgId] — The iframe-served schedule page.
 *
 * Served inside an iframe embedded on org websites.
 * X-Frame-Options is set to ALLOWALL for /widget/* in next.config.ts.
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
  let widgetConfigQuery = supabase.from("widget_configs").select("allowed_templates, primary_color").eq("org_id", orgId);
  widgetConfigQuery = facility ? widgetConfigQuery.eq("facility_id", facility.id) : widgetConfigQuery.is("facility_id", null);
  widgetConfigQuery = department ? widgetConfigQuery.eq("department_id", department.id) : widgetConfigQuery.is("department_id", null);
  const { data: widgetConfig } = await widgetConfigQuery.maybeSingle();

  const primaryColor = widgetConfig?.primary_color ?? "#0066CC";

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
    preview === "1" && previewList.length > 0
      ? previewList
      : widgetConfig?.allowed_templates ?? ["grid", "list", "map"];
  // Floorplan only makes sense scoped to a single facility — an org-wide
  // embed (no facilityId) has no one facility map to show.
  const allowedTemplates = facility
    ? rawAllowedTemplates
    : rawAllowedTemplates.filter((t) => t !== "floorplan");

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
        />
      </OrgThemeProvider>
    </div>
  );
}
