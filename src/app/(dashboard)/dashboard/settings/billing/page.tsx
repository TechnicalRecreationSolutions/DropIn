import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { STORED_TIER_TO_PLAN, type StoredPlanTier } from "@/lib/stripe/plans";
import { hasInterval } from "@/lib/stripe/prices";
import { Skeleton } from "@/components/ui/skeleton";
import BillingClient from "./BillingClient";
import Streamed from "@/components/ui/streamed";
import { SettingsHeading } from "@/components/settings/SettingsSection";

export const metadata = { title: "Billing · Settings" };

/**
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

export default function BillingPage() {
  return (
    <>
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <SettingsHeading
        title="Billing"
        info="Your plan and payment. Dropin bills per facility: departments, schedules, spaces, staff accounts and embeds are unlimited on every tier."
      />

      <Suspense fallback={<Skeleton className="h-64 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-6">
          <BillingBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function BillingBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  // Owner only, and it was previously enforced by the sidebar alone — a manager
  // who typed the URL got the plan cards and a checkout button. The Stripe
  // routes refuse them, so nothing could be bought, but being shown a page that
  // exists only to refuse you is its own bug. The rail does not offer this,
  // and now neither does the route.
  if (!can({ role: orgContext.membership.role, scopes: orgContext.scopes }, "billing:manage")) {
    redirect("/dashboard/settings/account");
  }

  // The database still stores the legacy two-tier vocabulary (migration 004's
  // CHECK constraint), so translate before rendering. `free` maps to null — it
  // is the unpaid/cancelled state, not the cheapest plan.
  const stored = (orgContext.subscription?.plan_tier ?? "free") as StoredPlanTier;
  const currentTier = STORED_TIER_TO_PLAN[stored] ?? null;

  // Whether annual is sellable is a *server* fact — it depends on secret price
  // env vars, which read as `undefined` in the browser. So it is resolved here
  // and passed down as a boolean; BillingClient must never try to work it out
  // for itself. Today this is false everywhere, and the yearly figures on the
  // cards render as information rather than as a choice.
  const annualAvailable = hasInterval("year");

  return <BillingClient currentTier={currentTier} annualAvailable={annualAvailable} />;
}
