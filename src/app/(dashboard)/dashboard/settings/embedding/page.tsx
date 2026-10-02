import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { Banner } from "@/components/ui/banner";
import TrustedSitesForm from "@/components/org/TrustedSitesForm";
import { SettingsHeading, SettingsCard } from "@/components/settings/SettingsSection";

export const metadata = { title: "Embedding · Settings" };

/** See dashboard/settings/page.tsx for what `instant` validates. */
export const instant = true;

/**
 * Where this organization's widget is allowed to appear.
 *
 * A settings page rather than a step in the widget studio, because it is not a
 * look-and-feel choice that gets published with the colours: it is a security
 * boundary, owned by the people who own the organization's other policies
 * (`org:edit-settings`), and saving it takes effect without a publish. The
 * studio's Install step links here and says when the list is empty.
 *
 * How it is enforced lives in lib/embed/trustedSites.ts.
 */
export default function SettingsEmbeddingPage() {
  return (
    <>
      <SettingsHeading
        title="Embedding"
        info="Your widget can be put on your own website with a short piece of code. This page decides which websites that code works on, so nobody else can copy it onto theirs."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-card" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <EmbeddingBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function EmbeddingBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes } = orgContext;
  // Same rule as every other Organization page: a page the rail does not offer
  // is a page the route refuses. The API checks again on save.
  if (!can({ role: membership.role, scopes }, "org:edit-settings")) {
    redirect("/dashboard/settings/account");
  }

  // `org` is `select *`, so before migration 067 the column is simply absent.
  // Saving would then fail on an unknown column, so say so instead of
  // rendering a form that cannot work.
  const hosts = (org as { embed_allowed_hosts?: string[] }).embed_allowed_hosts;
  if (!Array.isArray(hosts)) {
    return (
      <Banner variant="warning">
        Trusted websites need a database update (migration 067) before they can be set.
      </Banner>
    );
  }

  return (
    <>
      <TrustedSitesForm defaultHosts={hosts} canEdit />

      <SettingsCard title="What this covers">
        <ul className="list-disc space-y-2 pl-5 text-body text-foreground">
          <li>
            The <strong>Script</strong> and <strong>iFrame</strong> codes from the{" "}
            <Link href="/dashboard/widget" className="text-brand hover:underline">
              widget studio
            </Link>{" "}
            only show your schedule on the websites listed above.
          </li>
          <li>
            The <strong>Link</strong> option still works anywhere, because it opens your
            schedule on Dropin in its own tab rather than inside someone else&apos;s page.
          </li>
          <li>
            Your schedule is still public. Anyone can view your facility pages. This only
            stops other websites from showing your widget, with your name and colours, as if
            it were theirs.
          </li>
        </ul>
      </SettingsCard>
    </>
  );
}
