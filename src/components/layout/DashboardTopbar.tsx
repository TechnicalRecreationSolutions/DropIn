"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut, ChevronDown, Menu } from "lucide-react";
import { useState } from "react";
import type { Organization, OrgMembership } from "@/types/app.types";
import { Button } from "@/components/ui/button";
import { useMobileTreeSheet } from "./MobileTreeSheetProvider";

interface DashboardTopbarProps {
  org: Organization;
  membership: OrgMembership;
}

export default function DashboardTopbar({ org, membership }: DashboardTopbarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { open: openTreeSheet } = useMobileTreeSheet();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
      {/* Left: tree browser trigger on mobile — the sidebar is desktop-only */}
      <div className="lg:hidden flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Browse facilities"
          onClick={openTreeSheet}
        >
          <Menu className="size-5 text-gray-700" />
        </Button>
        <Link href="/" className="text-blue-600 font-bold text-sm">Dropin</Link>
      </div>

      <div className="hidden lg:block" />

      {/* Right: org + user menu */}
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 py-2"
        >
          <span className="hidden sm:block font-medium">{org.name}</span>
          <span className="text-xs text-gray-500 capitalize">{membership.role}</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-100 z-20 py-1">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
