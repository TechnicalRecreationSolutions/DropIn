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
  BarChart3,
  Database,
  Settings,
  CreditCard,
  Users,
  ClipboardList,
  Mail,
  Globe,
  ShieldCheck,
  UserCircle,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import TreeNavNode from "./TreeNavNode";
import { commandCentreHref, spacesHref, mapHref, sessionsHref, departmentsHref, widgetHref, countsHref, NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import type { SidebarSelection } from "./SidebarNav";
import { can } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";
import { SETTINGS_ROOT, visibleSettingsItems } from "@/lib/settings/nav";

/**
 * An icon per settings destination, keyed by href.
 *
 * Kept here rather than in `lib/settings/nav.ts` so that module stays free of
 * component imports — it is read by server components, and a lucide icon on
 * every row would drag the icon set into their bundles for nothing. A missing
 * entry falls back to the section's own gear, so adding a settings page
 * without touching this file produces a plain row rather than a crash.
 */
const SETTINGS_ICONS: Record<string, LucideIcon> = {
  "/dashboard/settings": Building2,
  "/dashboard/settings/contact": Mail,
  "/dashboard/settings/public": Globe,
  "/dashboard/settings/staff": Users,
  "/dashboard/settings/permissions": ShieldCheck,
  "/dashboard/settings/data-sources": Database,
  "/dashboard/settings/account": UserCircle,
  "/dashboard/settings/billing": CreditCard,
  "/dashboard/settings/danger": TriangleAlert,
};

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
  /**
   * Sub-items, rendered as an expandable group.
   *
   * The menu was flat until Analytics became three pages. A parent with
   * children is NOT itself a destination — clicking its row expands it — and
   * it appears only when at least one child survives the permission filter,
   * so a coordinator who can see Utilization and Attendance gets the group
   * without the Engagement row they cannot open.
   *
   * `permission` is therefore left off a parent: whether the group exists is
   * a question about its children, and answering it twice would eventually
   * disagree.
   */
  children?: MenuItem[];
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
    // Reachable only through the overview's rotating stat tile until now,
    // which is no way to find a whole section. Not facility-gated: the page
    // is org-wide and its own facility filter narrows it.
    {
      // The one item every role sees, aux included — it is their only write
      // (migration 061). Asked as `reading:write` and not `isReadOnly(role)`,
      // which is true for aux and would remove it from the role it is for.
      href: countsHref(selection.facilityId),
      label: "Head counts",
      icon: ClipboardList,
      permission: "reading:write",
    },
    {
      href: "/dashboard/analytics",
      label: "Analytics",
      icon: BarChart3,
      children: [
        {
          href: "/dashboard/analytics",
          label: "Engagement",
          icon: BarChart3,
          exact: true,
          permission: "analytics:view",
        },
        {
          href: "/dashboard/analytics/utilization",
          label: "Utilization",
          icon: CalendarDays,
          permission: "operations:view",
        },
        {
          href: "/dashboard/analytics/attendance",
          label: "Attendance",
          icon: ClipboardList,
          permission: "operations:view",
        },
      ],
    },
  ];

  /**
   * One row, expanding to the settings section.
   *
   * This used to be four unrelated rows — Data sources, Staff, Organization,
   * Billing — under a heading called Settings, which is a heading doing the
   * work a section should. They are now real siblings under
   * `/dashboard/settings`, and the children here are read from the SAME list
   * the settings rail renders (`lib/settings/nav.ts`) rather than restated, so
   * a page cannot exist in one and be missing from the other.
   *
   * The icons are assigned here and not in that module: it is imported by the
   * settings pages, which are server components, and shipping a lucide icon
   * per row through them would put the icon set in a bundle that has no use
   * for it.
   */
  const settingsItems: MenuItem[] = [
    {
      href: SETTINGS_ROOT,
      label: "Settings",
      icon: Settings,
      children: visibleSettingsItems(actor).map((item) => ({
        href: item.href,
        label: item.label,
        icon: SETTINGS_ICONS[item.href] ?? Settings,
        exact: item.exact,
      })),
    },
  ];

  // Removed, not disabled — see the note on MenuItem.permission. A parent is
  // kept only when something inside it survives.
  const visible = (items: MenuItem[]): MenuItem[] =>
    items
      .filter((item) => !item.permission || can(actor, item.permission))
      .map((item) => (item.children ? { ...item, children: visible(item.children) } : item))
      .filter((item) => !item.children || item.children.length > 0);

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
          {visible(menuItems).map((item) =>
            item.children ? (
              <MenuGroup
                key={item.label}
                item={item}
                collapsed={collapsed}
                isActive={isActive}
                // Open when you are already inside it — a group that collapsed
                // out from under the page you are on is a group you have to
                // re-open on every navigation.
                startOpen={item.children.some((child) => isActive(child))}
              />
            ) : (
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
            )
          )}
        </div>
      </div>

      {/* No "SETTINGS" caption any more: the block is one row, and a heading
          above a row of the same name is the heading repeating itself. The gap
          and the separator carry the grouping instead. */}
      {visible(settingsItems).length > 0 && (
        <div className="border-t border-sidebar-border pt-3">
          <div className="space-y-0.5">
            {visible(settingsItems).map((item) =>
              item.children ? (
                <MenuGroup
                  key={item.label}
                  item={item}
                  collapsed={collapsed}
                  isActive={isActive}
                  startOpen={item.children.some((child) => isActive(child))}
                />
              ) : (
                <TreeNavNode
                  key={item.label}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  depth={0}
                  isActive={isActive(item)}
                  collapsed={collapsed}
                />
              )
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

/**
 * An expandable parent and its children.
 *
 * Its own state, so expanding one group does not re-render the whole menu, and
 * so the open/closed choice survives a navigation inside the group. `startOpen`
 * seeds it from the current route rather than forcing it, which leaves someone
 * free to collapse the group they are standing in.
 *
 * Collapsed (icon-only) sidebar: the parent becomes an ordinary link to its
 * first child. There is nowhere to put an indented list 56px wide, and a
 * chevron that opens nothing visible is worse than a link that goes somewhere.
 */
function MenuGroup({
  item,
  collapsed,
  isActive,
  startOpen,
}: {
  item: MenuItem;
  collapsed?: boolean;
  isActive: (item: MenuItem) => boolean;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const children = item.children ?? [];

  if (collapsed) {
    return (
      <TreeNavNode
        href={children[0]?.href ?? item.href}
        label={item.label}
        icon={item.icon}
        depth={0}
        isActive={children.some(isActive)}
        collapsed
      />
    );
  }

  return (
    <>
      <TreeNavNode
        href={children[0]?.href ?? item.href}
        label={item.label}
        icon={item.icon}
        depth={0}
        // The parent row highlights when any child is open, so the group reads
        // as the thing you are inside.
        isActive={!open && children.some(isActive)}
        expandable
        expanded={open}
        onToggleExpand={() => setOpen((v) => !v)}
        collapsed={false}
      />
      {open &&
        children.map((child) => (
          <TreeNavNode
            key={child.href}
            href={child.href}
            label={child.label}
            icon={child.icon}
            depth={1}
            isActive={isActive(child)}
            collapsed={false}
          />
        ))}
    </>
  );
}
