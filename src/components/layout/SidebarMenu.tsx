"use client";

import {
  LayoutDashboard,
  CalendarDays,
  Clock,
  MonitorSmartphone,
  DoorOpen,
  Map as MapIcon,
  Database,
  Settings,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import TreeNavNode from "./TreeNavNode";
import { commandCentreHref, spacesHref, mapHref } from "@/lib/schedule/commandCentreHref";
import type { SidebarSelection } from "./SidebarNav";

interface SidebarMenuProps {
  selection: SidebarSelection;
  /** Org has at least one facility — menu items that need a facility scope render disabled otherwise. */
  hasFacility: boolean;
  onNavigate?: () => void;
}

interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * The flat Menu + Settings sections from the mockup. Replaces the old
 * accordion tree as the sidebar's navigation — hrefs for the scope-aware
 * items (Schedules, Spaces) are built from whatever SidebarFilters currently
 * has selected, so picking a facility/department/schedule there changes
 * where these links actually go.
 */
export default function SidebarMenu({ selection, hasFacility, onNavigate }: SidebarMenuProps) {
  const pathname = usePathname();
  const needsFacility = "Add a facility first to use this.";

  const menuItems: MenuItem[] = [
    {
      href: selection.facilityId ? `/dashboard?facility=${selection.facilityId}` : "/dashboard",
      label: "Overview",
      icon: LayoutDashboard,
      exact: true,
    },
    {
      href: commandCentreHref({
        facilityId: selection.facilityId,
        departmentId: selection.departmentId,
        scheduleGroupId: selection.scheduleGroupId,
      }),
      label: "Schedules",
      icon: CalendarDays,
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: "/dashboard/sessions",
      label: "Sessions",
      icon: Clock,
    },
    {
      href: "/dashboard/widget",
      label: "Widget",
      icon: MonitorSmartphone,
    },
    {
      href: spacesHref(selection.facilityId),
      label: "Spaces",
      icon: DoorOpen,
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: mapHref(selection.facilityId),
      label: "Map",
      icon: MapIcon,
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
  ];

  const settingsItems: MenuItem[] = [
    { href: "/dashboard/data-sources", label: "Data Sources", icon: Database },
    // Above Billing because it's what a new centre needs on day one — the
    // org name and logo it edits here are what the public pages render.
    { href: "/dashboard/settings", label: "Organization", icon: Settings },
    { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  ];

  function isActive(item: MenuItem) {
    const path = item.href.split("?")[0];
    return item.exact ? pathname === path : pathname.startsWith(path);
  }

  return (
    <nav
      className="px-2 py-3 space-y-4"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate?.();
      }}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 px-3 pb-1">
          Menu
        </p>
        <div className="space-y-0.5">
          {menuItems.map((item) => (
            <TreeNavNode
              key={item.label}
              href={item.href}
              label={item.label}
              icon={item.icon}
              depth={0}
              isActive={isActive(item)}
              disabled={item.disabled}
              disabledReason={item.disabledReason}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 px-3 pb-1">
          Settings
        </p>
        <div className="space-y-0.5">
          {settingsItems.map((item) => (
            <TreeNavNode
              key={item.label}
              href={item.href}
              label={item.label}
              icon={item.icon}
              depth={0}
              isActive={isActive(item)}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
