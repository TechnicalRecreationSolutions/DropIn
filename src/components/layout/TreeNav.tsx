"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import OrgImage from "@/components/media/OrgImage";
import SidebarNav from "./SidebarNav";
import SidebarProfile from "./SidebarProfile";

interface TreeNavProps {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  userEmail: string | null;
  role: string;
}

/** Desktop sidebar shell: logo, Filters + Menu, and the profile footer. */
export default function TreeNav({ orgId, orgName, orgLogoUrl, userEmail, role }: TreeNavProps) {
  return (
    <aside className="hidden lg:flex flex-col w-72 min-h-screen bg-sidebar text-sidebar-foreground shrink-0 border-r border-sidebar-border">
      <div className="px-4 py-4 border-b border-sidebar-border shrink-0">
        <Link href="/" className="flex items-center gap-2 text-sidebar-primary font-bold text-lg mb-1">
          <MapPin className="size-4" />
          Dropin
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          {orgLogoUrl && (
            <span className="relative size-5 rounded shrink-0 overflow-hidden bg-sidebar-accent">
              <OrgImage src={orgLogoUrl} alt="" sizes="20px" className="object-cover" />
            </span>
          )}
          <p className="text-xs text-sidebar-foreground/50 truncate">{orgName}</p>
        </div>
      </div>

      <SidebarNav orgId={orgId} />

      <SidebarProfile userEmail={userEmail} role={role} />
    </aside>
  );
}
