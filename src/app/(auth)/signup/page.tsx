import type { Metadata } from "next";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Create Account",
};

export default function SignupPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-foreground">Set up your centre</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an account to build and publish your schedule
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
