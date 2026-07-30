"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import TreeNavContent, { bottomLinks } from "./TreeNavContent";
import TreeNavNode from "./TreeNavNode";

const MobileTreeSheetContext = createContext<{ open: () => void } | null>(null);

/** Lets DashboardTopbar's hamburger and DashboardBottomNav's Browse tab open the same sheet instance. */
export function useMobileTreeSheet() {
  const ctx = useContext(MobileTreeSheetContext);
  if (!ctx) throw new Error("useMobileTreeSheet must be used within MobileTreeSheetProvider");
  return ctx;
}

interface MobileTreeSheetProviderProps {
  orgId: string;
  orgName: string;
  children: React.ReactNode;
}

export default function MobileTreeSheetProvider({ orgId, orgName, children }: MobileTreeSheetProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <MobileTreeSheetContext.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="left"
          className="w-3/4 max-w-xs bg-sidebar text-sidebar-foreground border-sidebar-border p-0 flex flex-col gap-0"
        >
          <SheetHeader className="px-4 py-4 border-b border-sidebar-border shrink-0">
            <SheetTitle asChild>
              <Link
                href="/"
                className="flex items-center gap-2 text-sidebar-primary font-bold text-lg mb-1"
                onClick={() => setIsOpen(false)}
              >
                <MapPin className="size-4" />
                Dropin
              </Link>
            </SheetTitle>
            <p className="text-xs text-sidebar-foreground/50 truncate">{orgName}</p>
          </SheetHeader>

          <TreeNavContent orgId={orgId} onNavigate={() => setIsOpen(false)} />

          <div className="px-2 py-3 border-t border-sidebar-border space-y-0.5 shrink-0">
            {bottomLinks.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <div key={item.href} onClick={() => setIsOpen(false)}>
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
        </SheetContent>
      </Sheet>
    </MobileTreeSheetContext.Provider>
  );
}
