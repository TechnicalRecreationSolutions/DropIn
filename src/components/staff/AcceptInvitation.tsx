"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface AcceptInvitationProps {
  token: string;
  /** Masked by `invitation_by_token()` — "j••••@example.com", never the full address. */
  maskedEmail: string;
  /** The address of whoever is signed in right now, if anyone. */
  signedInAs: string | null;
}

/**
 * The three states an invitee can arrive in.
 *
 * 1. **Signed out** — almost always a brand new staff member. They go to
 *    signup, and the link carries the token through so they come back here
 *    afterwards. That round trip costs exactly ONE Supabase confirmation
 *    email, which matters: Supabase's built-in mailer allows roughly two sends
 *    an hour and then fails silently (launch blocker 1 in docs/RESUME.md).
 *
 * 2. **Signed in as the wrong person** — a shared front-desk browser, or a
 *    manager who opened the link they just sent. The masked address is what
 *    tells them which account to use without publishing a colleague's email to
 *    whoever holds the link.
 *
 * 3. **Signed in as the right person** — one button.
 *
 * The address is not verified here. `accept_invitation()` re-reads it from
 * `auth.users` and refuses a mismatch, which is what makes a forwarded link
 * useless. Everything below is about explaining that, not enforcing it.
 */
export default function AcceptInvitation({
  token,
  maskedEmail,
  signedInAs,
}: AcceptInvitationProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = encodeURIComponent(`/invite/${token}`);

  if (!signedInAs) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This invitation is for <span className="font-medium text-foreground">{maskedEmail}</span>.
          Create an account with that address, or sign in if you already have one.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button asChild className="flex-1">
            <Link href={`/signup?next=${next}`}>Create an account</Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/login?redirectTo=${next}`}>I already have one</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{signedInAs}</span>. This
        invitation is for <span className="font-medium text-foreground">{maskedEmail}</span>.
      </p>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
          {error}
        </p>
      )}

      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          setBusy(false);

          if (!res.ok) {
            setError(data.error ?? "Could not accept this invitation.");
            return;
          }

          // refresh() before push(): this user had NO membership a moment ago,
          // and the dashboard layout may still be holding the render that said
          // so. getOrgContext() is cache()d per request, so a fresh request
          // re-reads it — but only once the router is told the cached one is
          // stale.
          router.refresh();
          router.push("/dashboard");
        }}
      >
        {busy ? "Joining…" : "Accept and join"}
      </Button>

      <p className="text-xs text-muted-foreground">
        Wrong account?{" "}
        <Link href={`/login?redirectTo=${next}`} className="underline hover:text-foreground">
          Sign in as someone else
        </Link>
        .
      </p>
    </div>
  );
}
