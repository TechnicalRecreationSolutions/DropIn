"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/SettingsSection";
import { orgFieldClass, orgLabelClass } from "@/components/org/useOrgPatch";

/** Shared with DashboardTopbar's toggle — one key, or the two disagree. */
const THEME_KEY = "dropin-theme";

type Theme = "light" | "dark" | "system";

/**
 * The one settings page every role reaches, aux included.
 *
 * Until now there was nowhere in the product to change your own password. The
 * only route to a new one was the forgotten-password flow on the sign-in page,
 * which means the answer to "I think someone saw me type it" was "sign out and
 * pretend you forgot it". That is the gap this page exists to close; everything
 * else here is the context that belongs beside it.
 *
 * ## Why the email change says "check your email" and not "saved"
 *
 * Supabase does not move an address until the confirmation link in it is
 * clicked. A form that reported success at the moment of the request would be
 * describing something that has not happened, and the person would then find
 * their old address still on the sign-in screen. So the confirmation names the
 * next step instead.
 *
 * ## The snapshot reconciliation, on mount
 *
 * `org_memberships.email` is a snapshot taken at join time (migration 055 §2),
 * so a confirmed email change leaves the Staff page showing the old address
 * forever. This posts `sync-email` once per visit; it finds nothing on almost
 * every visit, and on the one after a confirmed change it repairs the row and
 * refreshes. That is cheaper and more reliable than a webhook this deployment
 * does not have.
 */
export default function AccountPanel({ email }: { email: string | null }) {
  const router = useRouter();

  // ── Reconcile the membership snapshot, once ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync-email" }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        // Only when something actually moved — an unconditional refresh on
        // every visit re-renders the whole settings tree for nothing.
        if (!cancelled && body?.changed > 0) router.refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <>
      <PasswordCard />
      <EmailCard currentEmail={email} />
      <AppearanceCard />
      <SessionsCard />
    </>
  );
}

/** POSTs one action and reports on it. Every card below shares this shape. */
function useAccountAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Something went wrong. Try again.");
        return false;
      }
      setMessage(success);
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      // Always, for the reason in useOrgPatch: under cacheComponents this
      // component is hidden rather than unmounted when you navigate away, so a
      // flag left true stays true for the rest of the session.
      setBusy(false);
    }
  }

  return { run, busy, error, message, setError };
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  if (error) {
    return (
      <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">
        {message}
      </p>
    );
  }
  return null;
}

function PasswordCard() {
  const { run, busy, error, message } = useAccountAction();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const tooShort = newPassword.length > 0 && newPassword.length < 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    // Checked here as well as on the server, because a mismatch is the one
    // error the browser can answer instantly and without a round trip.
    if (newPassword !== confirm) {
      setLocalError("The two new passwords do not match.");
      return;
    }

    const ok = await run(
      { action: "password", currentPassword, newPassword },
      "Your password has been changed."
    );
    if (ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  }

  return (
    <SettingsCard
      title="Password"
      info="Changing your password does not sign you out anywhere. Use “Sign out other devices” below for that."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className={orgLabelClass}>
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            className={orgFieldClass}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="newPassword" className={orgLabelClass}>
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNext(e.target.value)}
              aria-describedby="password-rule"
              className={orgFieldClass}
            />
            <p
              id="password-rule"
              className={`mt-1 text-xs ${tooShort ? "text-destructive" : "text-muted-foreground"}`}
            >
              At least 10 characters.
            </p>
          </div>
          <div>
            <label htmlFor="confirmPassword" className={orgLabelClass}>
              Repeat new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={orgFieldClass}
            />
          </div>
        </div>

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </form>

      <Feedback error={localError ?? error} message={message} />
    </SettingsCard>
  );
}

function EmailCard({ currentEmail }: { currentEmail: string | null }) {
  const { run, busy, error, message } = useAccountAction();
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrent] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      { action: "email", email, currentPassword },
      `Check ${email} for a confirmation link. Your address changes when you click it — until then, keep signing in with the current one.`
    );
    if (ok) {
      setEmail("");
      setCurrent("");
    }
  }

  return (
    <SettingsCard
      title="Email address"
      description={
        currentEmail
          ? `You sign in as ${currentEmail}. This is also where invitations and password resets are sent.`
          : undefined
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="newEmail" className={orgLabelClass}>
              New email address
            </label>
            <input
              id="newEmail"
              name="newEmail"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={orgFieldClass}
              placeholder="you@yourcity.ca"
            />
          </div>
          <div>
            <label htmlFor="emailCurrentPassword" className={orgLabelClass}>
              Current password
            </label>
            <input
              id="emailCurrentPassword"
              name="emailCurrentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              className={orgFieldClass}
            />
          </div>
        </div>

        <Button type="submit" variant="outline" size="lg" disabled={busy}>
          {busy ? "Sending…" : "Send confirmation"}
        </Button>
      </form>

      <Feedback error={error} message={message} />
    </SettingsCard>
  );
}

/**
 * Theme, with a real "system" option.
 *
 * The topbar toggle is a two-state switch that writes the same localStorage
 * key, so it can only ever say light or dark — once you touch it you have opted
 * out of following the operating system, with no way back. This is where that
 * way back lives, which is why the option exists here and not there.
 *
 * Per-device, not per-account: it is a browser preference, stored where the
 * topbar's boot script reads it, and a lifeguard's phone and the front-desk
 * monitor should not have to agree.
 */
function AppearanceCard() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading an external system (localStorage) that isn't available during SSR
    setTheme(stored === "dark" || stored === "light" ? stored : "system");
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem(THEME_KEY);
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", !!prefersDark);
      return;
    }
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <SettingsCard
      title="Appearance"
      description="Saved on this device only — your phone and the front-desk screen can differ."
    >
      <fieldset>
        <legend className="sr-only">Theme</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => apply(option.value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-foreground/20 bg-muted text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <option.icon className="size-4" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    </SettingsCard>
  );
}

function SessionsCard() {
  const router = useRouter();
  const { run, busy, error, message } = useAccountAction();
  const [signingOut, setSigningOut] = useState(false);

  async function signOutHere() {
    setSigningOut(true);
    await createClient().auth.signOut();
    // Not reset on the way out: this navigates away, and leaving the flag set
    // keeps the button from being clicked twice while the redirect happens.
    router.push("/");
    router.refresh();
  }

  return (
    <SettingsCard
      title="Sessions"
      info="“Other devices” revokes every signed-in session except the one you are using right now — the right thing to do after losing a phone or leaving a shared computer signed in."
    >
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={busy}
          onClick={() =>
            void run(
              { action: "sign-out-others" },
              "Your other devices have been signed out."
            )
          }
        >
          {busy ? "Signing out…" : "Sign out other devices"}
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="lg"
          disabled={signingOut}
          onClick={signOutHere}
        >
          <LogOut className="size-4" aria-hidden />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>

      <Feedback error={error} message={message} />
    </SettingsCard>
  );
}
