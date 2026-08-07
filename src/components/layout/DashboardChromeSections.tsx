import { getOrgContext } from "@/lib/auth/session";
import TreeNav from "./TreeNav";
import DashboardTopbar from "./DashboardTopbar";
import MobileTreeSheetContents from "./MobileTreeSheetContents";

/**
 * Server components that own the org lookup for each piece of dashboard chrome.
 *
 * The lookup lives here rather than in the layout on purpose. `getOrgContext()`
 * reads cookies, and merely *calling* it from the layout body counts as request
 * data access outside a Suspense boundary — which stops the route from
 * prerendering a static shell at all. Starting it inside these components keeps
 * the access within the boundary the layout wraps them in.
 *
 * getOrgContext() is cache()d, so all three share a single request.
 *
 * Each returns null when there is no org; <OrgGuard /> issues the redirect.
 */

export async function TreeNavSection() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  return <TreeNav orgId={orgContext.org.id} orgName={orgContext.org.name} />;
}

export async function TopbarSection() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  return (
    <DashboardTopbar
      org={orgContext.org}
      membership={orgContext.membership}
    />
  );
}

export async function MobileSheetSection() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  return (
    <MobileTreeSheetContents
      orgId={orgContext.org.id}
      orgName={orgContext.org.name}
    />
  );
}
