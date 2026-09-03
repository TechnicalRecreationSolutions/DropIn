import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { PLANS } from "@/lib/stripe/plans";
import { Skeleton } from "@/components/ui/skeleton";
import BillingClient from "./BillingClient";
import Streamed from "@/components/ui/streamed";

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
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-gray-500 mt-1">
          Manage your Dropin subscription.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-64 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-6">
          <BillingBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function BillingBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const currentTier = (orgContext.subscription?.plan_tier ?? "free") as keyof typeof PLANS;

  return <BillingClient currentTier={currentTier} />;
}
