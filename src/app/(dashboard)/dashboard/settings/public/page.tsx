import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Globe, EyeOff } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { SITE_URL } from "@/lib/seo/siteUrl";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { Badge } from "@/components/ui/badge";
import { SettingsHeading, SettingsCard } from "@/components/settings/SettingsSection";

export const metadata = { title: "Public presence · Settings" };

/** See dashboard/settings/page.tsx for what `instant` validates. */
export const instant = true;

/**
 * Everything this organization currently shows the public, on one page.
 *
 * ## Why this page reports instead of edits
 *
 * Every switch it reports belongs to a facility, and each one already has an
 * editor that knows the rest of that facility's context — publishing, the
 * directory opt-in and the head-count disclosure mode all live on the facility
 * edit and status pages, and moving them here would mean two places to change
 * one column.
 *
 * What did not exist anywhere was the ANSWER to "what can a patron see right
 * now", which before this required opening every facility in turn and
 * remembering four booleans. That question gets asked after a complaint, or
 * before a launch, and it is the reason this page is a summary with links out
 * rather than another form.
 */
export default function SettingsPublicPage() {
  return (
    <>
      <SettingsHeading
        title="Public presence"
        info="What patrons can currently see, and where. Each switch is changed on the facility it belongs to — this page is the overview, and every row links to its editor."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <PublicBody />
        </Streamed>
      </Suspense>
    </>
  );
}

const HEADCOUNT_LABEL: Record<string, string> = {
  hidden: "Not shown",
  level: "Busy / steady / quiet",
  exact: "Exact number",
};

async function PublicBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes } = orgContext;
  if (!can({ role: membership.role, scopes }, "facility:edit")) {
    redirect("/dashboard/settings/account");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("facilities")
    .select("id, name, slug, is_published, listed_in_directory, public_headcount, public_conditions")
    .eq("org_id", org.id)
    .order("name", { ascending: true });

  const facilities = data ?? [];
  const verified = org.approved_at !== null;
  const published = facilities.filter((f) => f.is_published);
  // The directory shows a facility only when BOTH are true — the org is
  // verified AND the facility opted in while published (migration 052 + 057).
  // Reporting the opt-in alone would tell an unverified organization it is
  // listed when nothing of theirs appears in /find at all.
  const listed = published.filter((f) => f.listed_in_directory && verified);

  return (
    <>
      <SettingsCard
        title="Resident directory"
        info="/find is the public, no-account directory of recreation facilities. A facility appears in it only when it is published, opted in, and its organization is verified — all three."
      >
        {verified ? (
          <p className="text-sm text-foreground">
            Your organization is verified.{" "}
            {listed.length === 0 ? (
              <>
                No facility has opted in yet, so none appear in the directory. Turn
                &ldquo;List in the resident directory&rdquo; on for a facility to add it.
              </>
            ) : (
              <>
                {listed.length} of your {published.length} published{" "}
                {published.length === 1 ? "facility is" : "facilities are"} listed in{" "}
                <Link href="/find" className="text-blue-600 hover:underline dark:text-blue-400">
                  the directory
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-foreground">
            Your organization is <strong>not verified yet</strong>, so nothing of yours appears
            in the directory and your facility pages carry <code>noindex</code> for search
            engines. The pages themselves work — your own website can link to them.
            Verification is granted by Dropin; it is not a setting.
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title="Facilities"
        description={
          facilities.length === 0
            ? undefined
            : "A facility that is not published has no public page at all — the link 404s rather than showing an empty schedule."
        }
      >
        {facilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No facilities yet.{" "}
            <Link
              href="/dashboard/facilities"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Add one
            </Link>{" "}
            to get a public page.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {facilities.map((f) => (
              <li
                key={f.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{f.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {f.is_published ? (
                      <Badge variant="secondary" className="gap-1">
                        <Globe className="size-3" aria-hidden /> Published
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <EyeOff className="size-3" aria-hidden /> Not published
                      </Badge>
                    )}
                    {f.is_published && f.listed_in_directory && (
                      <Badge variant="outline">
                        {verified ? "In the directory" : "Directory: waiting on verification"}
                      </Badge>
                    )}
                    <Badge variant="outline">
                      Head count: {HEADCOUNT_LABEL[f.public_headcount] ?? f.public_headcount}
                    </Badge>
                    {f.public_conditions && <Badge variant="outline">Temperatures shown</Badge>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <Link
                    href={`/dashboard/facilities/${f.id}/edit`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Edit
                  </Link>
                  {f.is_published && (
                    <a
                      href={`${SITE_URL}/facility/${f.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title="Embedded widget"
        description="One configuration for the whole organization — colours, which schedules appear, and whether patrons get a print button."
      >
        <Link
          href="/dashboard/widget"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Open the widget studio
        </Link>
      </SettingsCard>
    </>
  );
}
