"use client";

import {
  Inbox,
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
  History,
  Mail,
  Globe,
  ShieldCheck,
  UserCircle,
  TriangleAlert,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import TreeNavNode from "./TreeNavNode";
import { commandCentreHref, spacesHref, mapHref, sessionsHref, departmentsHref, widgetHref } from "@/lib/schedule/commandCentreHref";
import { can, isReadOnly } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";
import { SETTINGS_ROOT, visibleSettingsItems } from "@/lib/settings/nav";
import { useNeedsYouCount } from "@/hooks/useNeedsYouCount";

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
  /** The building switcher's facility — never "all"; the links carry it. */
  facilityId: string | null;
  /** Analytics is showing "All facilities", so its links keep doing so. */
  analyticsAll?: boolean;
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
   * Overrides the prefix match in `isActive`. Needed where a destination lives
   * under another item's path — facility status is under /dashboard/facilities,
   * and without this both rows light up.
   */
  activeWhen?: (pathname: string) => boolean;
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
  /** Carries the Overview's inbox count (things waiting on this person). */
  inbox?: boolean;
}

/**
 * The sidebar's links, in three bands by how often they are used (see the
 * note above `dailyItems`). Replaces the old
 * accordion tree as the sidebar's navigation — the facility-scoped items
 * carry the building switcher's facility, so every link opens in the building
 * you are working in. Department is a filter on the page, not carried here.
 */
export default function SidebarMenu({ facilityId, analyticsAll = false, hasFacility, onNavigate, collapsed, role }: SidebarMenuProps) {
  const pathname = usePathname();
  const needsFacility = "Add a facility first to use this.";
  // The sidebar only asks org-wide questions, so empty scope lists are the
  // right input — the per-row scope test belongs to each page.
  const actor = { role, scopes: { departmentIds: [], facilityIds: [] } };
  // The inbox count on the Overview row: the length of the Overview's
  // "Needs you" list for the building the switcher has selected.
  const { data: needs } = useNeedsYouCount(facilityId, !isReadOnly(role) && hasFacility);
  // Analytics keeps "All facilities" while you move between its pages.
  const analyticsHref = (path: string) => (facilityId && !analyticsAll ? `${path}?facility=${facilityId}` : path);

  // ── Grouped by how often people reach for them (2026-10-01) ────────────
  //
  // The menu was one flat list of ten rows in the order they were built. It is
  // now three bands, by frequency, the same reasoning the Overview uses:
  //
  //   1. Daily, no caption: the inbox (Overview, with its count), the
  //      schedule, and facility status. What an admin opens several times a
  //      day and a coordinator lives in.
  //   2. "Set up": the things you build once a season and then leave —
  //      sessions, spaces, departments, buildings, the map, the widget.
  //   3. Below the line: Analytics and Settings, both collapsible, both
  //      visited on purpose rather than in passing.
  const dailyItems: MenuItem[] = [
    // Not for read-only staff: /dashboard redirects them to the schedule, so
    // the row was a second "Schedules" that highlighted the wrong item.
    ...(isReadOnly(role)
      ? []
      : [
          {
            href: facilityId ? `/dashboard?facility=${facilityId}` : "/dashboard",
            label: "Overview",
            icon: Inbox,
            exact: true,
            inbox: true,
          },
        ]),
    {
      href: commandCentreHref({ facilityId }),
      label: "Schedules",
      icon: CalendarDays,
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    // Reachable only through the overview's rotating stat tile until now,
    // which is no way to find a whole section. Not facility-gated: the page
    // is org-wide and its own facility filter narrows it.
    // Every role, no permission: reading status is universal, and what each
    // person may do there (post, report, or only read) is the page's call.
    // Before this row existed the status page was linked only from the
    // Overview and the Facilities grid — neither of which aux staff can reach.
    // Since 2026-09-29 it is also where people are counted: the separate
    // "Head counts" item was folded into it.
    {
      href: facilityId
        ? `/dashboard/facilities/${facilityId}/status`
        : "/dashboard/status",
      label: "Facility status",
      icon: Megaphone,
      activeWhen: (path) => path === "/dashboard/status" || path.endsWith("/status"),
    },
  ];

  const setupItems: MenuItem[] = [
    {
      href: sessionsHref({ facilityId }),
      label: "Sessions",
      icon: Clock,
      // The templates page. Coordinators build templates for their own
      // departments, so this is asked as the org-wide "may you ever".
      permission: "session-template:write",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: spacesHref(facilityId),
      label: "Spaces",
      icon: DoorOpen,
      permission: "space:write",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: departmentsHref(facilityId),
      label: "Departments",
      icon: Layers,
      permission: "department:create",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      href: "/dashboard/facilities",
      label: "Facilities",
      icon: Building2,
      permission: "facility:create",
      activeWhen: (path) => path.startsWith("/dashboard/facilities") && !path.endsWith("/status"),
    },
    {
      href: mapHref(facilityId),
      label: "Map",
      icon: MapIcon,
      permission: "map:edit",
      disabled: !hasFacility,
      disabledReason: needsFacility,
    },
    {
      // Org-wide: the studio configures the one widget for every building.
      href: widgetHref({}),
      label: "Widget",
      icon: MonitorSmartphone,
      permission: "widget:edit",
    },
  ];

  const insightItems: MenuItem[] = [
    {
      href: "/dashboard/analytics",
      label: "Analytics",
      icon: BarChart3,
      children: [
        {
          href: analyticsHref("/dashboard/analytics"),
          label: "Engagement",
          icon: BarChart3,
          exact: true,
          permission: "analytics:view",
        },
        {
          href: analyticsHref("/dashboard/analytics/utilization"),
          label: "Utilization",
          icon: CalendarDays,
          permission: "operations:view",
        },
        {
          href: analyticsHref("/dashboard/analytics/attendance"),
          label: "Attendance",
          icon: ClipboardList,
          permission: "operations:view",
        },
        {
          href: analyticsHref("/dashboard/analytics/notices"),
          label: "Status history",
          icon: History,
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
    if (item.activeWhen) return item.activeWhen(pathname);
    const path = item.href.split("?")[0];
    return item.exact ? pathname === path : pathname.startsWith(path);
  }

  const renderItems = (items: MenuItem[]) =>
    visible(items).map((item) =>
      item.children ? (
        <MenuGroup
          key={item.label}
          item={item}
          collapsed={collapsed}
          isActive={isActive}
          // Open when you are already inside it — a group that collapsed out
          // from under the page you are on has to be re-opened on every visit.
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
          {...(item.inbox && needs && needs.count > 0
            ? {
                badge: needs.count,
                badgeTone: needs.urgent > 0 ? ("urgent" as const) : ("solid" as const),
                badgeLabel: `${needs.count} ${needs.count === 1 ? "thing needs" : "things need"} you${
                  needs.urgent > 0 ? `, ${needs.urgent} urgent` : ""
                }`,
              }
            : {})}
        />
      )
    );

  const setup = visible(setupItems);
  const lower = [...visible(insightItems), ...visible(settingsItems)];

  return (
    <nav
      aria-label="Main"
      className="px-2 py-3 space-y-3"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate?.();
      }}
    >
      {/* Daily. No caption: these are the app, and a heading reading "Menu"
          above them was the menu labelling itself. */}
      <div className="space-y-0.5">{renderItems(dailyItems)}</div>

      {setup.length > 0 && (
        <div className={collapsed ? "border-t border-border pt-3" : undefined}>
          {!collapsed && <p className="text-label text-muted-foreground px-3 pt-1 pb-1.5">Set up</p>}
          <div className="space-y-0.5">{renderItems(setupItems)}</div>
        </div>
      )}

      {/* Analytics and Settings: visited on purpose, so below the line and
          folded until you are inside one. */}
      {lower.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="space-y-0.5">
            {renderItems(insightItems)}
            {renderItems(settingsItems)}
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
