import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign In",
};

export default function LoginPage() {
  return (
    <Card className="w-full max-w-[420px] [--card-spacing:--spacing(6)]">
      <CardContent className="space-y-6">
      <div className="text-center">
        <h1 className="text-title text-foreground">Welcome back</h1>
        <p className="mt-2 text-caption text-muted-foreground">
          Sign in to your organization dashboard
        </p>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      </CardContent>
    </Card>
  );
}
