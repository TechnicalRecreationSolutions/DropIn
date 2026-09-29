import type { Metadata } from "next";
import SignupForm from "@/components/auth/SignupForm";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Create Account",
};

export default function SignupPage() {
  return (
    <Card className="w-full max-w-[420px] [--card-spacing:--spacing(6)]">
      <CardContent className="space-y-6">
      <div className="text-center">
        <h1 className="text-title text-foreground">Set up your centre</h1>
        <p className="mt-2 text-caption text-muted-foreground">
          Create an account to build and publish your schedule
        </p>
      </div>
      <SignupForm />
      </CardContent>
    </Card>
  );
}
