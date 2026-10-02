"use client";

import Link from "next/link";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
      </SheetHeader>

      {/* Same as the desktop sidebar: the building switcher at the top. */}
      <SidebarNav orgId={orgId} orgName={orgName} orgLogoUrl={orgLogoUrl} onNavigate={close} />

      <SidebarProfile userEmail={userEmail} role={role} onNavigate={close} />
    </>
  );
}
