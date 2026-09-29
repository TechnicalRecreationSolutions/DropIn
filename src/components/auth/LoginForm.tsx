"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/auth/safe-redirect";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeNext(searchParams.get("redirectTo"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Generic message — don't reveal whether email or password was wrong
      setError("Invalid email or password. Please try again.");
      setLoading(false);
      return;
    }

    // Signing out is `router.push("/")`, a client-side navigation, so under
    // `cacheComponents` this page can still be the retained instance when
    // /login is opened again — with `loading` stuck true, the button reads
    // "Signing in…" and is disabled before anything has been typed. The
    // password is cleared for the obvious reason. See
    // components/space/SpaceForm.tsx for the full note.
    setLoading(false);
    setPassword("");

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">
          Email address
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <Label htmlFor="password" className="mb-0">
            Password
          </Label>
          <Link href="/forgot-password" className="text-caption text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-brand font-medium hover:underline">
          Get started
        </Link>
      </p>
    </form>
  );
}
