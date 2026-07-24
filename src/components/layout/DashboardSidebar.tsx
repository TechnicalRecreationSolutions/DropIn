"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Dumbbell,
  Calendar,
  Upload,
  RefreshCw,
  Code2,
  BarChart3,
  CreditCard,
  Settings,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/facilities", label: "Facilities", icon: Building2 },
  { href: "/dashboard/programs", label: "Programs", icon: Dumbbell },
  { href: "/dashboard/schedule", label: "Schedule", icon: Calendar },
  { href: "/dashboard/import", label: "Import Data", icon: Upload },
  { href: "/dashboard/scraping", label: "Scraping", icon: RefreshCw },
  { href: "/dashboard/widget", label: "Widget", icon: Code2 },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/org", label: "Settings", icon: Settings },
];

interface DashboardSidebarProps {
  orgName: string;
}

/**
 * Left sidebar for the org dashboard.
 * On mobile this is hidden — a bottom tab bar handles navigation instead.
 * See DashboardBottomNav for the mobile equivalent.
 */
export default function DashboardSidebar({ orgName }: DashboardSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-gray-950 text-white shrink-0">
      {/* Logo / Org name */}
      <div className="px-6 py-5 border-b border-gray-800">
        <Link href="/" className="flex items-center gap-2 text-blue-400 font-bold text-lg mb-1">
          <MapPin className="w-4 h-4" />
          Dropin
        </Link>
        <p className="text-xs text-gray-400 truncate">{orgName}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-800">
        <p className="text-xs text-gray-500">Dropin v0.1.0</p>
      </div>
    </aside>
  );
}
