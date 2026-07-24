import { getOrgContext } from "@/lib/auth/session";
import { PLANS } from "@/lib/stripe/plans";
import BillingClient from "./BillingClient";

export default async function BillingPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const currentTier = (orgContext.subscription?.plan_tier ?? "free") as keyof typeof PLANS;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-gray-500 mt-1">
          Manage your Dropin subscription.
        </p>
      </div>
      <BillingClient currentTier={currentTier} />
    </div>
  );
}
