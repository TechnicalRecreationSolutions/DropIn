"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import OrgImage from "@/components/media/OrgImage";
import SidebarNav from "./SidebarNav";
import SidebarProfile from "./SidebarProfile";
import { useMobileTreeSheet } from "./MobileTreeSheetProvider";

interface MobileTreeSheetContentsProps {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  userEmail: string | null;
  role: string;
}

/** The org-specific body of the mobile sheet — mirrors the desktop sidebar. Closes the sheet on navigation. */
export default function MobileTreeSheetContents({
  orgId,
  orgName,
  orgLogoUrl,
  userEmail,
  role,
}: MobileTreeSheetContentsProps) {
  const { close } = useMobileTreeSheet();

  return (
    <>
      <SheetHeader className="px-4 py-4 border-b border-sidebar-border shrink-0">
        <SheetTitle asChild>
          <Link
            href="/"
            className="flex items-center gap-2 text-sidebar-primary font-bold text-lg mb-1"
            onClick={close}
          >
            <MapPin className="size-4" />
            Dropin
          </Link>
        </SheetTitle>
        <div className="flex items-center gap-2 min-w-0">
          {orgLogoUrl && (
            <span className="relative size-5 rounded shrink-0 overflow-hidden bg-sidebar-accent">
              <OrgImage src={orgLogoUrl} alt="" sizes="20px" className="object-cover" />
            </span>
          )}
          <p className="text-xs text-sidebar-foreground/50 truncate">{orgName}</p>
        </div>
      </SheetHeader>

      <SidebarNav orgId={orgId} onNavigate={close} />

      <SidebarProfile userEmail={userEmail} role={role} onNavigate={close} />
    </>
  );
}
