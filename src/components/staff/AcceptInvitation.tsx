"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui/banner";
import { Label } from "@/components/ui/field";

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
 * 1. **Signed out** — almost always a brand new staff member. They choose a
 *    password and that is all: /api/invitations/[token]/signup creates the
 *    account for the invited address, signs them in and accepts, in one
 *    request, with no confirmation email. (Until 2026-09-27 this sent them to
 *    /signup, which dropped the token, asked for an organization name, and
 *    after confirmation put them on "Set up your organization" instead.)
 *    Someone who already has an account signs in and lands in state 3.
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
    return <CreatePassword token={token} maskedEmail={maskedEmail} next={next} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{signedInAs}</span>. This
        invitation is for <span className="font-medium text-foreground">{maskedEmail}</span>.
      </p>

      {error && (
        <Banner variant="error">{error}</Banner>
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

      <p className="text-caption text-muted-foreground">
        Wrong account?{" "}
        <Link href={`/login?redirectTo=${next}`} className="underline hover:text-foreground">
          Sign in as someone else
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * State 1: a password is the only thing asked for. The address comes from the
 * invitation on the server, and the organization is the one that invited them.
 *
 * `busy` and the password are reset on every exit path, success included —
 * under cacheComponents this route can come back as a retained instance (see
 * components/space/SpaceForm.tsx), and a button stuck on "Joining…" would be
 * the first thing the next visitor on a shared browser sees.
 */
function CreatePassword({
  token,
  maskedEmail,
  next,
}: {
  token: string;
  maskedEmail: string;
  next: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAccountExists(false);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/invitations/${token}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setAccountExists(data.code === "account_exists");
      setError(data.error ?? "Could not create your account. Please try again.");
      return;
    }

    setPassword("");
    // Same reason as the signed-in path: refresh before push, so the dashboard
    // layout re-reads a membership that did not exist a moment ago.
    router.refresh();
    router.push("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your account will use{" "}
        <span className="font-medium text-foreground">{maskedEmail}</span>, the address this
        invitation was sent to. Choose a password to finish.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="invite-password" className="mb-0">
          Password
        </Label>
        <Input
          id="invite-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
          className="h-10"
          aria-invalid={error ? true : undefined}
          autoFocus
        />
      </div>

      {error && (
        <Banner variant="error">
          {error}
          {accountExists && (
            <>
              {" "}
              <Link href={`/login?redirectTo=${next}`} className="font-medium underline">
                Sign in
              </Link>
            </>
          )}
        </Banner>
      )}

      <Button type="submit" className="w-full h-10" disabled={busy}>
        {busy ? "Joining…" : "Create password and join"}
      </Button>

      <p className="text-center text-caption text-muted-foreground">
        Already have a Dropin account?{" "}
        <Link href={`/login?redirectTo=${next}`} className="underline hover:text-foreground">
          Sign in to accept
        </Link>
        . By joining you agree to our{" "}
        <Link href="/terms" className="underline hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
