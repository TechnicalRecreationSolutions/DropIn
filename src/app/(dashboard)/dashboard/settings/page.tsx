import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BadgeCheck, Clock } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { STORED_TIER_TO_PLAN, PLANS, type StoredPlanTier } from "@/lib/stripe/plans";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import OrgProfileForm from "@/components/org/OrgProfileForm";
import {
  SettingsHeading,
  SettingsCard,
  SettingsFacts,
  SettingsFact,
  ReadOnlyNotice,
} from "@/components/settings/SettingsSection";

export const metadata = { title: "General · Settings" };

/**
 * Who the organization is, to everyone outside it.
 *
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * The Suspense boundary has to live inside this page — see the note in
 * dashboard/facilities/page.tsx for why a boundary in the layout is not
 * enough for navigations arriving from a sibling route.
 */
export const instant = true;

export default function SettingsGeneralPage() {
  return (
    <>
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <SettingsHeading
        title="General"
        info="Your organization's name, logo and description. All three are published: they appear on every public schedule page, in the embeddable widget, and on your directory listing."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <GeneralBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function GeneralBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes, subscription } = orgContext;
  const actor = { role: membership.role, scopes };
  const canEdit = can(actor, "org:edit-settings");

  // Previously this page had no route guard: the sidebar simply did not offer
  // it below Manager, and a coordinator who typed the URL got the whole form
  // rendered disabled. That was a deliberate choice once — "knowing what your
  // organization has published is reasonable" — but it makes the rail and the
  // routes disagree, and the rail is now the section's contract. Refused
  // roles go to the one settings page every role has.
  //
  // `canEdit` below is NOT redundant with this. It is the second layer, the
  // same shape as every page guard in this app having an API guard behind it:
  // if `org:edit-settings` is ever widened to a role that may look but not
  // touch, the fields are already disabled and the notice already explains why.
  if (!canEdit) redirect("/dashboard/settings/account");

  // `approved_at` IS the verification mark — migration 057 repurposed a column
  // unused since 001 rather than adding a boolean, and `organizations_public`
  // exposes it as `is_verified`. It is trigger-locked against the organization
  // itself, so this is always a fact about the platform's decision and never
  // about anything set here.
  const verified = org.approved_at !== null;

  const stored = (subscription?.plan_tier ?? "free") as StoredPlanTier;
  const planTier = STORED_TIER_TO_PLAN[stored] ?? null;
  const planName = planTier ? PLANS[planTier].name : "No paid plan";

  return (
    <>
      {!canEdit && (
        <ReadOnlyNotice>
          Only the Owner and Managers can change these settings. You can see what your
          organization has published.
        </ReadOnlyNotice>
      )}

      <OrgProfileForm
        orgId={org.id}
        logoUrl={org.logo_url}
        canEdit={canEdit}
        defaultValues={{
          name: org.name,
          description: org.description ?? "",
        }}
      />

      {/* ── Facts, not fields ──────────────────────────────────────────────
          Four things people ask about and none of them are editable here: two
          are the platform's to set (verification, and the slug that is baked
          into URLs already handed out), one belongs to Billing, and one is a
          timestamp. Putting them under the form rather than on a page of their
          own is what stops somebody opening a support ticket to ask where the
          verified badge comes from. */}
      <SettingsCard title="Organization record" info="Set by Dropin, or by another page. Shown here so you can quote it.">
        <SettingsFacts>
          <SettingsFact
            label="Verification"
            info="A verified organization is listed in the public resident directory and its facility pages are indexed by search engines. Unverified pages still work — your own site can link to them — but they carry noindex. Verification is granted by Dropin and cannot be set from inside the dashboard."
          >
            {verified ? (
              <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                <BadgeCheck className="size-4" aria-hidden />
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <Clock className="size-4" aria-hidden />
                Pending review
              </span>
            )}
          </SettingsFact>

          <SettingsFact
            label="Plan"
            info="Changed on the Billing page, which only the Owner can open."
          >
            {planName}
          </SettingsFact>

          <SettingsFact
            label="Identifier"
            info="Your organization's permanent slug. It is not editable: it is referenced by everything already created under this organization, and changing it would need a redirect story that does not exist yet."
          >
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{org.slug}</code>
          </SettingsFact>

          <SettingsFact
            label="Created"
            info="When this organization was first set up in Dropin."
          >
            {/* Explicit zone: this renders on the server, which is UTC in
                production, and a bare toLocaleDateString() there reports the
                wrong day for anything created after 5pm Pacific. */}
            {new Date(org.created_at).toLocaleDateString("en-CA", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "America/Edmonton",
            })}
          </SettingsFact>
        </SettingsFacts>
      </SettingsCard>
    </>
  );
}
