import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import OnboardOrgForm from "@/components/auth/OnboardOrgForm";

export const metadata: Metadata = {
  title: "Set Up Your Organization",
};

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("org_memberships")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membership) redirect("/dashboard");

  // Set at signup, before email confirmation. Untrusted (user_metadata is
  // user-writable) — prefill only; the API re-validates on submit.
  const suggestedName =
    typeof user.user_metadata?.org_name === "string" ? user.user_metadata.org_name : "";

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Set up your organization</h1>
        <p className="mt-2 text-sm text-gray-600">
          You&apos;re signed in, but not yet part of an organization on Dropin. Create one to continue.
        </p>
      </div>
      <OnboardOrgForm suggestedName={suggestedName} />
    </div>
  );
}
