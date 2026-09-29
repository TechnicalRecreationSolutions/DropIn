"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";

export default function SignupForm() {
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName, email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    // No redirect: the account is unconfirmed until the emailed link is
    // followed, and this screen must look identical whether the address was new
    // or already registered — that indistinguishability is the anti-enumeration
    // property, so don't add a "welcome back" variant here.
    setEmailSent(true);
    setLoading(false);
  }

  if (emailSent) {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-banner bg-brand-subtle px-4 py-5">
          <h2 className="text-card-title text-foreground">Check your email</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            If <span className="font-medium">{email}</span> can receive mail, we&apos;ve sent a
            link to confirm your account. Open it to finish setting up{" "}
            <span className="font-medium">{orgName}</span>.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Didn&apos;t get it? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => { setEmailSent(false); setError(null); }}
            className="text-brand font-medium hover:underline"
          >
            try a different address
          </button>
          .
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Already confirmed?{" "}
          <Link href="/login" className="text-brand font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="orgName">
          Organization name
        </Label>
        <Input
          id="orgName"
          type="text"
          required
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="City of Calgary Parks & Recreation"
        />
      </div>

      <div>
        <Label htmlFor="email">
          Work email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourorg.com"
        />
      </div>

      <div>
        <Label htmlFor="password">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
        />
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-brand font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
