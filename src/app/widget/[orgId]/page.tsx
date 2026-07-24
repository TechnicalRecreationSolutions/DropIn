import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WidgetScheduleClient from "./WidgetScheduleClient";

interface WidgetPageProps {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ facilityId?: string; theme?: string }>;
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
  const { facilityId, theme = "light" } = await searchParams;

  const supabase = await createClient();

  // Verify org exists and is active
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("id, name, slug")
    .eq("id", orgId)
    .eq("status", "active")
    .single() as { data: { id: string; name: string; slug: string } | null };

  if (!org) notFound();

  // If facilityId provided, verify it belongs to this org
  let facility: { id: string; name: string } | null = null;
  if (facilityId) {
    const { data: f } = await (supabase as any)
      .from("facilities")
      .select("id, name")
      .eq("id", facilityId)
      .eq("org_id", orgId)
      .single() as { data: { id: string; name: string } | null };
    facility = f;
  }

  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen p-3 sm:p-4 ${isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900"}`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            {org.name}
          </p>
          {facility && (
            <h2 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
              {facility.name}
            </h2>
          )}
        </div>
        <a
          href={`/org/${org.slug}`}
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
        theme={theme === "dark" ? "dark" : "light"}
      />
    </div>
  );
}
