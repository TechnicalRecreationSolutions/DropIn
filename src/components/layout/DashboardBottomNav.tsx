"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Compass,
  Database,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useMobileTreeSheet } from "./MobileTreeSheetProvider";
import { can, isReadOnly } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";

/**
 * Bottom navigation bar for the org dashboard on mobile devices.
 * Shows the most important sections — matches iOS/Android app conventions.
 * 44px minimum tap target enforced via py-3.
 * "Browse" opens the same Facility > Department > Schedule tree sheet as
 * the topbar hamburger — two entry points into one hierarchy browser,
 * since the desktop TreeNav sidebar has no room to exist on mobile.
 *
 * Aux staff get Home, Schedule, Counts and Browse. "Data" imports a
 * spreadsheet over the schedule, which is the last thing a lifeguard's thumb
 * should be able to reach on a phone, so it is removed rather than disabled
 * (same reasoning as SidebarMenu).
 *
 * **Counts is on the bar for everyone, and it is the aux staffer's one write.**
 * It is the only thing on this bar that gets used standing up, twice an hour,
 * and burying it behind Browse would mean burying it behind the one role whose
 * whole shift it belongs to. Gated on `reading:write` rather than
 * `isReadOnly(role)` — the latter is TRUE for aux and would hide it from
 * exactly them.
 */
const navLinks = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/schedule", label: "Manage", icon: Calendar },
];

const countsLink = { href: "/dashboard/counts", label: "Counts", icon: Users };

const trailingNavLinks = [
  { href: "/dashboard/data-sources", label: "Data", icon: Database },
];

export default function DashboardBottomNav({ role }: { role: OrgRole }) {
  const pathname = usePathname();
  const { open: openTreeSheet } = useMobileTreeSheet();
  // The role arrives as a prop from BottomNavSection rather than from a client
  // fetch: it is already in hand server-side (getOrgContext() is cache()d and
  // shared across all four chrome sections), so a fetch here would be a second
  // request AND a flash of the wrong navigation while it resolved.
  const actor = { role, scopes: { departmentIds: [], facilityIds: [] } };
  const canImport = can(actor, "import:use");
  const canCount = can(actor, "reading:write");

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
        {navLinks
          .map((item) =>
            // isReadOnly() rather than can(…, "session:write"): that
            // permission is department-scoped, so asking it without one here
            // would answer false for a coordinator and mislabel their tab.
            item.href === "/dashboard/schedule" && isReadOnly(role)
              ? { ...item, label: "Schedule" }
              : item
          )
          .map(renderLink)}
        {canCount && renderLink(countsLink)}
        <button
          type="button"
          onClick={openTreeSheet}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Compass className="w-5 h-5" />
          Browse
        </button>
        {canImport && trailingNavLinks.map(renderLink)}
      </div>
    </nav>
  );
}
