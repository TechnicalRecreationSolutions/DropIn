import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

/**
 * POST /api/stripe/create-portal
 *
 * Creates a Stripe Customer Portal session for the authenticated org.
 * The org must already have a stripe_customer_id (i.e. has been through checkout once).
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage billing" }, { status: 403 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", membership.org_id)
    .single() as unknown as { data: { stripe_customer_id: string | null } | null };

  if (!org?.stripe_customer_id) {
    return NextResponse.json({ error: "No Stripe customer found — please subscribe first" }, { status: 400 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${APP_URL}/dashboard/billing`,
  });

  return NextResponse.json({ url: session.url });
}
