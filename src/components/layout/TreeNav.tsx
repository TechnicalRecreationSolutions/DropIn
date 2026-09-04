"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import OrgImage from "@/components/media/OrgImage";
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
        "hidden lg:flex flex-col min-h-screen bg-sidebar text-sidebar-foreground shrink-0 border-r border-sidebar-border transition-[width] duration-200",
        collapsed ? "w-16" : "w-72"
      )}
    >
      <div
        className={cn(
          "border-b border-sidebar-border shrink-0",
          collapsed ? "px-2 py-4" : "px-4 py-4"
        )}
      >
        <div className={cn("flex items-center", collapsed ? "flex-col gap-3" : "justify-between gap-2 mb-1")}>
          <Link href="/dashboard" className="flex items-center gap-2 text-sidebar-primary font-bold text-lg">
            <MapPin className="size-4 shrink-0" />
            {!collapsed && "Dropin"}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors shrink-0"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            {orgLogoUrl && (
              <span className="relative size-5 rounded shrink-0 overflow-hidden bg-sidebar-accent">
                <OrgImage src={orgLogoUrl} alt="" sizes="20px" className="object-cover" />
              </span>
            )}
            <p className="text-xs text-sidebar-foreground/50 truncate">{orgName}</p>
          </div>
        )}
      </div>

      <SidebarNav orgId={orgId} collapsed={collapsed} />

      <SidebarProfile userEmail={userEmail} role={role} collapsed={collapsed} />
    </aside>
  );
}
