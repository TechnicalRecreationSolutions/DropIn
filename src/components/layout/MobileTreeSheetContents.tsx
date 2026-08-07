"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin } from "lucide-react";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import TreeNavContent, { bottomLinks } from "./TreeNavContent";
import TreeNavNode from "./TreeNavNode";
import { useMobileTreeSheet } from "./MobileTreeSheetProvider";

interface MobileTreeSheetContentsProps {
  orgId: string;
  orgName: string;
}

/** The org-specific body of the mobile sheet. Closes the sheet on navigation. */
export default function MobileTreeSheetContents({
  orgId,
  orgName,
}: MobileTreeSheetContentsProps) {
  const pathname = usePathname();
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
        <p className="text-xs text-sidebar-foreground/50 truncate">{orgName}</p>
      </SheetHeader>

      <TreeNavContent orgId={orgId} onNavigate={close} />

      <div className="px-2 py-3 border-t border-sidebar-border space-y-0.5 shrink-0">
        {bottomLinks.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <div key={item.href} onClick={close}>
              <TreeNavNode
                href={item.href}
                label={item.label}
                icon={item.icon}
                depth={0}
                isActive={isActive}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
