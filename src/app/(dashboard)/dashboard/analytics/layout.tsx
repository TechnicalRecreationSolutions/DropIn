import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import AnalyticsTabs, { type AnalyticsTab } from "@/components/dashboard/analytics/AnalyticsTabs";

/**
 * Three analytical stories about one building, behind one heading.
 *
 * Before this, `/dashboard/analytics` meant "how many people looked at the
 * schedule" and nothing else. The other two questions an operator asks already
 * had answers in the app, and neither was anywhere you could send somebody:
 *
 *   **Engagement**  — who looks at the schedule. `analytics_events`.
 *   **Utilization** — what the building is programmed for. Lived in a side
 *                     sheet inside one editor, on one week at a time.
 *                     `sessions`, expanded.
 *   **Attendance**  — who actually showed up. Had nowhere at all until
 *                     migration 061. `facility_readings`.
 *
 * They are siblings rather than sections of one page because they come from
 * three different tables, answer at three different confidences, and are read
 * by different people for different reasons — but they share a period, a
 * facility filter, an export and a chart kit, and stacking them would produce
 * a page nobody scrolls to the bottom of.
 *
 * ## The gates differ, and that is the point
 *
 * Engagement is `analytics:view` — owner and manager. It is org-wide visitor
 * data that a coordinator has no business reading for departments outside
 * their scope.
 *
 * Utilization and Attendance are `operations:view`, which **includes
 * coordinators**. Both are about the building's own operation, and the
 * coordinator filling the schedule is exactly who needs to know how much of
 * the week is unprogrammed. Widening `analytics:view` instead would have
 * handed them the visitor analytics too, which is why there are two
 * permissions.
 *
 * A tab whose permission fails is not rendered — the same rule `SidebarMenu`
 * follows. A greyed-out tab invites the question "what would I see there?",
 * and every future tab would have to remember to disable itself.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const orgContext = await getOrgContext();

  // Not a guard — the pages enforce their own, and this layout renders for a
  // signed-out request during the static shell pass. Absent context just means
  // no tabs yet.
  const actor = orgContext
    ? { role: orgContext.membership.role, scopes: orgContext.scopes }
    : null;

  const tabs: AnalyticsTab[] = [];
  if (!actor || can(actor, "analytics:view")) {
    tabs.push({ href: "/dashboard/analytics", label: "Engagement", exact: true });
  }
  if (!actor || can(actor, "operations:view")) {
    tabs.push({ href: "/dashboard/analytics/utilization", label: "Utilization" });
    tabs.push({ href: "/dashboard/analytics/attendance", label: "Attendance" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* A single tab is not a choice, so the strip hides itself rather than
          rendering one lonely pill above a page that is already named. */}
      {tabs.length > 1 && <AnalyticsTabs tabs={tabs} />}
      {children}
    </div>
  );
}
