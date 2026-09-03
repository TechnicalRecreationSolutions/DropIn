"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Compass,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useMobileTreeSheet } from "./MobileTreeSheetProvider";

/**
 * Bottom navigation bar for the org dashboard on mobile devices.
 * Shows the most important sections — matches iOS/Android app conventions.
 * 44px minimum tap target enforced via py-3.
 * "Browse" opens the same Facility > Department > Schedule tree sheet as
 * the topbar hamburger — two entry points into one hierarchy browser,
 * since the desktop TreeNav sidebar has no room to exist on mobile.
 */
const navLinks = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/schedule", label: "Manage", icon: Calendar },
];

const trailingNavLinks = [
  { href: "/dashboard/data-sources", label: "Data", icon: Database },
];

export default function DashboardBottomNav() {
  const pathname = usePathname();
  const { open: openTreeSheet } = useMobileTreeSheet();

  function renderLink(item: (typeof navLinks)[number]) {
    const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
          isActive ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <item.icon className="w-5 h-5" />
        {item.label}
      </Link>
    );
  }

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border safe-area-pb">
      <div className="flex">
        {navLinks.map(renderLink)}
        <button
          type="button"
          onClick={openTreeSheet}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Compass className="w-5 h-5" />
          Browse
        </button>
        {trailingNavLinks.map(renderLink)}
      </div>
    </nav>
  );
}
