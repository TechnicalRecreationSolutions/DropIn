"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import OrgImage from "@/components/media/OrgImage";
import { Button } from "@/components/ui/button";
import SidebarNav from "./SidebarNav";
import SidebarProfile from "./SidebarProfile";
import { cn } from "@/lib/utils/cn";

interface TreeNavProps {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  userEmail: string | null;
  role: string;
}

const COLLAPSED_STORAGE_KEY = "dropin-sidebar-collapsed";

/** Desktop sidebar shell: logo, Filters + Menu, and the profile footer. */
export default function TreeNav({ orgId, orgName, orgLogoUrl, userEmail, role }: TreeNavProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Read the persisted preference after mount so the server-rendered shell
  // (always expanded) matches the client on first paint — avoids a hydration
  // mismatch — then re-collapses a beat later if that's what the user left it as.
  useEffect(() => {
    if (localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading an external system (localStorage) that isn't available during SSR
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <aside
      className={cn(
        // sticky + h-screen (not min-h-screen) pins the sidebar to the viewport:
        // on a long page it stays exactly one screen tall with the profile
        // footer visible, instead of stretching to the full document height and
        // pushing the footer off the bottom. SidebarNav scrolls internally when
        // the menu itself is taller than the space left between header and footer.
        "hidden lg:flex flex-col sticky top-0 h-screen bg-sidebar text-foreground shrink-0 border-r border-border transition-[width] duration-200",
        collapsed ? "w-16" : "w-62"
      )}
    >
      <div
        className={cn(
          "shrink-0",
          collapsed ? "px-2 pt-3 pb-2" : "px-4 pt-3 pb-2"
        )}
      >
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between gap-2")}>
          <Link
            href="/dashboard"
            className="rounded-sm text-lg font-bold leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {collapsed ? (
              <>
                <span aria-hidden>D</span>
                <span className="sr-only">Dropin</span>
              </>
            ) : (
              "Dropin"
            )}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            {orgLogoUrl && (
              <span className="relative size-5 rounded shrink-0 overflow-hidden bg-muted">
                <OrgImage src={orgLogoUrl} alt="" sizes="20px" className="object-cover" />
              </span>
            )}
            <p className="text-caption text-muted-foreground truncate">{orgName}</p>
          </div>
        )}
      </div>

      <SidebarNav orgId={orgId} collapsed={collapsed} />

      <SidebarProfile userEmail={userEmail} role={role} collapsed={collapsed} />
    </aside>
  );
}
