"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Menu,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useMobileTreeSheet } from "./MobileTreeSheetProvider";
import { can, isReadOnly } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";

/**
 * Bottom navigation bar for the org dashboard on mobile devices.
 *
 * **Only what gets done with a phone in hand, standing up.** Setup work —
 * data import, widget, map, spaces, departments, billing, settings — is desk
 * work and lives in the Menu sheet (the full SidebarNav), not here:
 *
 *   owner / manager / coordinator:  Today · Schedule · (Count) · Activity · Menu
 *   aux:                                    Schedule · (Count) · Status · Menu
 *
 * Aux has no Today because /dashboard redirects them to the schedule, and no
 * Activity because they lack `activity:view`. Status takes that slot: for a
 * lifeguard, "the pool just got fouled" is the other thing done standing up,
 * and before it was here the status page had no route in from a phone at all.
 * It costs the centred Count its exact centre for aux, which is the cheaper
 * loss.
 *
 * **Count is the raised centre action, the app's "+ post".** It is the one
 * thing done many times a shift, and for aux it is the whole shift. Gated on
 * `reading:write` rather than `isReadOnly(role)` — the latter is TRUE for aux
 * and would hide it from exactly them.
 *
 * Activity takes the "notifications" slot and moves off the mobile topbar.
 * It has no unread badge yet — that needs a last-seen marker, a separate job.
 *
 * Menu is the only way into the Facility > Department > Schedule sheet on
 * mobile; the topbar hamburger that duplicated it is gone.
 *
 * Behaviour, social-app style:
 *  - the active tab gets a tinted pill behind a heavier icon;
 *  - the bar slides away while scrolling down and returns on any scroll up;
 *  - tapping the tab you are already on scrolls to the top (Instagram/X);
 *  - solid, hairline-topped, padded for the home indicator via
 *    env(safe-area-inset-bottom). That is 0 in a plain browser tab and becomes
 *    correct once the app sets viewport-fit=cover or ships in a native shell.
 * Tap targets are 56px (min-h-14), above the 44px minimum.
 */
type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const todayLink: NavItem = { href: "/dashboard", label: "Today", icon: LayoutDashboard, exact: true };
const scheduleLink: NavItem = { href: "/dashboard/schedule", label: "Schedule", icon: Calendar };
const countLink: NavItem = { href: "/dashboard/counts", label: "Count", icon: Users };
const activityLink: NavItem = { href: "/dashboard/activity", label: "Activity", icon: ClipboardList };
// /dashboard/status resolves to the staffer's facility (or a list of them).
const statusLink: NavItem = { href: "/dashboard/status", label: "Status", icon: Megaphone };

const HIDE_AFTER_PX = 64; // never hide while near the top of the page
const SCROLL_DELTA_PX = 8; // ignore jitter from momentum scrolling
const RING_PX = 4; // the raised button's ring-4

function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < SCROLL_DELTA_PX) return;
      setHidden(delta > 0 && y > HIDE_AFTER_PX);
      lastY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return hidden;
}

/**
 * Publishes how much of the viewport's bottom edge the bar covers as
 * `--tabbar-clearance` on <html>, so fixed/sticky action bars elsewhere
 * (SessionTemplateForm, WidgetStudio) can sit on top of it with
 * `bottom-[var(--tabbar-clearance,…)]` instead of a hardcoded pixel height.
 * Measured from the top of whichever is higher — the bar or the raised Count
 * button — so a full-width Save button is never cut in half by the circle.
 * 0 while the bar is scrolled away (those bars follow it down) and at `lg`,
 * where the bar is display:none and measures 0.
 */
function usePublishClearance(navRef: React.RefObject<HTMLElement | null>, hidden: boolean) {
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const root = document.documentElement;
    function publish() {
      if (!nav || hidden || nav.offsetHeight === 0) {
        root.style.setProperty("--tabbar-clearance", "0px");
        return;
      }
      const raised = nav.querySelector<HTMLElement>("[data-raised]");
      // offsetTop is from the nav's padding edge (inside its top border), and
      // ignores the translate animation. +RING_PX: ring-4 paints outside it.
      const overhang = raised ? Math.max(0, -raised.offsetTop - nav.clientTop + RING_PX) : 0;
      root.style.setProperty("--tabbar-clearance", `${nav.offsetHeight + overhang}px`);
    }
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--tabbar-clearance");
    };
  }, [navRef, hidden]);
}

function TabContent({
  icon: Icon,
  label,
  isActive,
  raised = false,
}: {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  raised?: boolean;
}) {
  return (
    <>
      {raised ? (
        // The centre action: a filled circle lifted above the bar's top edge,
        // ringed in the bar's own colour so it reads as cut out of it.
        <span
          data-raised
          className={cn(
            // size-14 less the -mt-6 lift = the 32px pill slot of the other
            // tabs, so every label still shares one baseline.
            "-mt-6 flex size-14 items-center justify-center rounded-full shadow-card ring-4 ring-background",
            "transition-transform duration-150 group-active:scale-90",
            "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring",
            isActive ? "bg-brand-subtle text-brand-strong" : "bg-primary text-primary-foreground"
          )}
        >
          <Icon className="size-[26px]" strokeWidth={2.25} />
        </span>
      ) : (
        <span
          className={cn(
            "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
            "group-focus-visible:ring-2 group-focus-visible:ring-ring",
            isActive && "bg-brand-subtle"
          )}
        >
          <Icon
            className="size-[22px] transition-transform duration-150 group-active:scale-90"
            strokeWidth={isActive ? 2.5 : 1.75}
          />
        </span>
      )}
      <span className={cn("text-[11px] leading-none", isActive ? "font-semibold" : "font-medium")}>
        {label}
      </span>
    </>
  );
}

function tabClass(isActive: boolean) {
  return cn(
    "group flex min-h-14 flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5",
    "select-none outline-none transition-colors [-webkit-tap-highlight-color:transparent]",
    isActive ? "text-brand" : "text-muted-foreground active:text-foreground"
  );
}

export default function DashboardBottomNav({ role }: { role: OrgRole }) {
  const pathname = usePathname();
  const { open: openTreeSheet } = useMobileTreeSheet();
  const hidden = useHideOnScroll();
  const navRef = useRef<HTMLElement>(null);
  usePublishClearance(navRef, hidden);
  // The role arrives as a prop from BottomNavSection rather than from a client
  // fetch: it is already in hand server-side (getOrgContext() is cache()d and
  // shared across all four chrome sections), so a fetch here would be a second
  // request AND a flash of the wrong navigation while it resolved.
  const actor = { role, scopes: { departmentIds: [], facilityIds: [] } };
  const canCount = can(actor, "reading:write");
  const canViewActivity = can(actor, "activity:view");

  function renderLink(item: NavItem, raised = false) {
    const isActive =
      item === statusLink
        ? pathname.startsWith(item.href) || pathname.endsWith("/status")
        : item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        onClick={(e) => {
          // Only on the tab's own root page: from a sub-page (a schedule's
          // edit screen, say) the tap should still navigate back up to it.
          if (pathname !== item.href) return;
          e.preventDefault();
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
        }}
        className={tabClass(isActive)}
      >
        <TabContent icon={item.icon} label={item.label} isActive={isActive} raised={raised} />
      </Link>
    );
  }

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className={cn(
        "lg:hidden fixed bottom-0 inset-x-0 z-50",
        "bg-background",
        "border-t border-border pb-[env(safe-area-inset-bottom)]",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        // Past the bottom edge by the raised button's overhang too, or its
        // top would peek out while the bar is hidden.
        hidden && "translate-y-[calc(100%+1.5rem)]"
      )}
    >
      <div className="mx-auto flex max-w-lg">
        {/* /dashboard redirects aux to the schedule, so for them Today would
            be a second Schedule tab. */}
        {!isReadOnly(role) && renderLink(todayLink)}
        {renderLink(scheduleLink)}
        {canCount && renderLink(countLink, true)}
        {canViewActivity && renderLink(activityLink)}
        {isReadOnly(role) && renderLink(statusLink)}
        <button
          type="button"
          onClick={openTreeSheet}
          aria-haspopup="dialog"
          className={tabClass(false)}
        >
          <TabContent icon={Menu} label="Menu" isActive={false} />
        </button>
      </div>
    </nav>
  );
}
