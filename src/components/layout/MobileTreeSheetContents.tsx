"use client";

import Link from "next/link";
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
      <SheetHeader className="px-4 pt-4 pb-2 pr-14 shrink-0">
        <SheetTitle asChild>
          <Link
            href="/dashboard"
            className="self-start rounded-sm text-lg font-bold leading-8 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={close}
          >
            Dropin
          </Link>
        </SheetTitle>
        <div className="flex items-center gap-2 min-w-0">
          {orgLogoUrl && (
            <span className="relative size-5 rounded shrink-0 overflow-hidden bg-muted">
              <OrgImage src={orgLogoUrl} alt="" sizes="20px" className="object-cover" />
            </span>
          )}
          <p className="text-caption text-muted-foreground truncate">{orgName}</p>
        </div>
      </SheetHeader>

      <SidebarNav orgId={orgId} onNavigate={close} />

      <SidebarProfile userEmail={userEmail} role={role} onNavigate={close} />
    </>
  );
}
