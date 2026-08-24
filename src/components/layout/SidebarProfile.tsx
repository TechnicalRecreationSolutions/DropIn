"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface SidebarProfileProps {
  userEmail: string | null;
  role: string;
  onNavigate?: () => void;
}

/**
 * The mockup's sidebar-footer profile card. This is now the one place
 * sign-out lives — it used to be a dropdown in DashboardTopbar, but the
 * mockup gives the profile its own persistent spot, so the header no longer
 * duplicates it.
 */
export default function SidebarProfile({ userEmail, role, onNavigate }: SidebarProfileProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    onNavigate?.();
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const initial = (userEmail ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="px-4 py-4 border-t border-sidebar-border text-center shrink-0">
      <div className="mx-auto mb-2 size-10 rounded-full bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-bold text-sm">
        {initial}
      </div>
      <p className="text-sm font-medium text-sidebar-foreground truncate" title={userEmail ?? undefined}>
        {userEmail ?? "Unknown user"}
      </p>
      <p className="text-xs text-sidebar-foreground/50 capitalize mb-3">{role}</p>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50"
      >
        <LogOut className="size-3.5" />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
