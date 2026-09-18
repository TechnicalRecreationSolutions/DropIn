"use client";

import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  Clock,
  MonitorSmartphone,
  DoorOpen,
  Layers,
  Map as MapIcon,
  Database,
  Settings,
  CreditCard,
  Users,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import TreeNavNode from "./TreeNavNode";
import { commandCentreHref, spacesHref, mapHref, sessionsHref, departmentsHref, widgetHref, NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import type { SidebarSelection } from "./SidebarNav";
import { can } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";

interface SidebarMenuProps {
  selection: SidebarSelection;
  /** Org has at least one facility — menu items that need a facility scope render disabled otherwise. */
  hasFacility: boolean;
  onNavigate?: () => void;
  /** Icon-only mode for the collapsed sidebar. */
  collapsed?: boolean;
  /** The viewer's role, from /api/nav-tree. Decides which items exist at all. */
  role: OrgRole;
}

interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * What the viewer must be able to do for this item to appear AT ALL.
   *
   * Omitted means everyone who can reach the dashboard. Items are REMOVED
   * rather than disabled — an aux staffer should not see a greyed-out Billing
   * row inviting them to wonder what it does, and every new page added later
   * would otherwise have to remember to disable itself. Disabling is reserved
   * for "you could do this, but not yet" (no facility exists), which is a
   * different message entirely.
   *
   * Scoped permissions are asked WITHOUT a department here, so a coordinator
   * answers false for them — hence the org-wide permissions below. The
   * department-level question belongs to the page, which knows which one.
   */
  permission?: Permission;
}

/**
 * The flat Menu + Settings sections from the mockup. Replaces the old
 * accordion tree as the sidebar's navigation — hrefs for the scope-aware
 * items (Schedules, Spaces) are built from whatever SidebarFilters currently
 * has selected, so picking a facility/department/schedule there changes
 * where these links actually go.
 */
export default function SidebarMenu({ selection, hasFacility, onNavigate, collapsed, role }: SidebarMenuProps) {
  const pathname = usePathname();
  const needsFacility = "Add a facility first to use this.";
  // The sidebar only asks org-wide questions, so empty scope lists are the
  // right input — the per-row scope test belongs to each page.
  const actor = { role, scopes: { departmentIds: [], facilityIds: [] } };

  const menuItems: MenuItem[] = [
    {
      href: selection.facilityId ? `/dashboard?facility=${selection.facilityId}` : "/dashboard",
      label: "Overview",
      icon: LayoutDashboard,
      exact: true,
    },
    {
      href: "/dashboard/facilities",
      label: "Facilities",
      icon: Building2,
      permission: "facility:create",
    },
    {
      href: departmentsHref(selection.facilityId),
      label: "Departments",
      icon: Layers,
      permission: "department:create",
      disabled: !hasFacility,
      disabledReason: needsFacility,
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
      href: sessionsHref({
        facilityId: selection.facilityId,
        departmentId: selection.departmentId,
        scheduleGroupId: selection.scheduleGroupId,
      }),
      label: "Sessions",
      icon: Clock,
      // The templates page. Coordinators build templates for their own
      // departments, so this is asked as the org-wide "may you ever".
      permission: "session-template:write",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: spacesHref(selection.facilityId),
      label: "Spaces",
      icon: DoorOpen,
      permission: "space:write",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: widgetHref({
        facilityId: selection.facilityId,
        // The widget picker has no "no department" option — only carry
        // over a real department id, never the NO_DEPARTMENT sentinel.
        departmentId: selection.departmentId !== NO_DEPARTMENT ? selection.departmentId : null,
      }),
      label: "Widget",
      icon: MonitorSmartphone,
      permission: "widget:edit",
    },
    {
      href: mapHref(selection.facilityId),
      label: "Map",
      icon: MapIcon,
      permission: "map:edit",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
  ];

  const settingsItems: MenuItem[] = [
    {
      href: "/dashboard/data-sources",
      label: "Data Sources",
      icon: Database,
      permission: "import:use",
    },
    // Coordinators reach this too — they can add aux staff to their own
    // facilities, which is what stops seasonal hiring funnelling through the
    // owner. The page itself narrows what they see.
    { href: "/dashboard/staff", label: "Staff", icon: Users, permission: "staff:view" },
    // Above Billing because it's what a new centre needs on day one — the
    // org name and logo it edits here are what the public pages render.
    {
      href: "/dashboard/settings",
      label: "Organization",
      icon: Settings,
      permission: "org:edit-settings",
    },
    // Owner only. A manager who cannot cancel the subscription should not be
    // shown the page that cancels it.
    { href: "/dashboard/billing", label: "Billing", icon: CreditCard, permission: "billing:manage" },
  ];

  // Removed, not disabled — see the note on MenuItem.permission.
  const visible = (items: MenuItem[]) =>
    items.filter((item) => !item.permission || can(actor, item.permission));

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
        {!collapsed && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 px-3 pb-1">
            Menu
          </p>
        )}
        <div className="space-y-0.5">
          {visible(menuItems).map((item) => (
            <TreeNavNode
              key={item.label}
              href={item.href}
              label={item.label}
              icon={item.icon}
              depth={0}
              isActive={isActive(item)}
              disabled={item.disabled}
              disabledReason={item.disabledReason}
              collapsed={collapsed}
            />
          ))}
        </div>
      </div>

      {visible(settingsItems).length > 0 && (
      <div>
        {!collapsed && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 px-3 pb-1">
            Settings
          </p>
        )}
        <div className="space-y-0.5">
          {visible(settingsItems).map((item) => (
            <TreeNavNode
              key={item.label}
              href={item.href}
              label={item.label}
              icon={item.icon}
              depth={0}
              isActive={isActive(item)}
              collapsed={collapsed}
            />
          ))}
        </div>
      </div>
      )}
    </nav>
  );
}
