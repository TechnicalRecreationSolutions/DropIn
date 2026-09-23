import { getOrgContext } from "@/lib/auth/session";
import { visibleSettingsNav } from "@/lib/settings/nav";
import SettingsNav from "@/components/settings/SettingsNav";
import { PageHeader } from "@/components/ui/info-tip";

/**
 * One section, nine pages, one heading.
 *
 * Before this, "settings" meant a single page called Organization plus three
 * unrelated sidebar rows (Staff, Billing, Data sources) that happened to sit
 * under a heading of the same name. Nothing tied them together, `/dashboard/
 * settings` held a 300-line form with a public profile, a postal address and a
 * staff-permission switch stacked in it, and there was nowhere at all to
 * change your own password.
 *
 * The section is now the unit: `SETTINGS_NAV` in `lib/settings/nav.ts` lists
 * every page once, this layout filters it by role, and the sidebar's Settings
 * group reads the same list. A page that exists is a page that can be found.
 *
 * ## The layout awaits, and that is deliberate
 *
 * This mirrors `dashboard/analytics/layout.tsx`. The rail has to know the
 * viewer's role to filter itself, and putting that behind its own Suspense
 * boundary would paint an empty rail and then fill it — a layout shift on
 * every settings navigation, on the one screen where people navigate
 * repeatedly between siblings. The pages beneath keep their own boundaries and
 * their own `instant` validation.
 *
 * ## This layout guards nothing
 *
 * It renders during the prerendered shell pass with no org context at all, so
 * a check here would be a check that is sometimes absent. Every page below
 * asks for itself, and the API routes ask again independently.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const orgContext = await getOrgContext();

  const actor = orgContext
    ? { role: orgContext.membership.role, scopes: orgContext.scopes }
    : null;

  const groups = visibleSettingsNav(actor);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Settings"
        info="Everything about your organization that is not a schedule — who you are to the public, who can sign in, what you are billed, and your own account."
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SettingsNav groups={groups} />
        <div className="min-w-0 flex-1 space-y-8">{children}</div>
      </div>
    </div>
  );
}
