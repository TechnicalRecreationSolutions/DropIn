"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const MobileTreeSheetContext = createContext<{
  open: () => void;
  close: () => void;
} | null>(null);

/**
 * Lets DashboardTopbar's hamburger and DashboardBottomNav's Browse tab open the
 * same sheet instance, and lets the sheet's own contents close it.
 *
 * `close` is read from context rather than passed as a prop because the sheet
 * body is rendered on the server (it needs the org context) and a server
 * component cannot be handed a client callback.
 */
export function useMobileTreeSheet() {
  const ctx = useContext(MobileTreeSheetContext);
  if (!ctx) throw new Error("useMobileTreeSheet must be used within MobileTreeSheetProvider");
  return ctx;
}

interface MobileTreeSheetProviderProps {
  /**
   * The org-specific sheet body, rendered on the server and passed in already
   * wrapped in its own Suspense boundary.
   */
  sheetContent: React.ReactNode;
  children: React.ReactNode;
}

/**
 * This component wraps {children}, so it must never suspend or touch request
 * data — either would block every page under the dashboard layout from
 * rendering, and would keep the route from producing a static shell. It holds
 * sheet state and nothing else; everything org-specific arrives via
 * `sheetContent`.
 */
export default function MobileTreeSheetProvider({
  sheetContent,
  children,
}: MobileTreeSheetProviderProps) {
  const [isOpen, setIsOpen] = useState(false);

  const value = useMemo(
    () => ({ open: () => setIsOpen(true), close: () => setIsOpen(false) }),
    []
  );

  return (
    <MobileTreeSheetContext.Provider value={value}>
      {children}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="left"
          className="w-3/4 max-w-xs bg-sidebar text-sidebar-foreground border-sidebar-border p-0 flex flex-col gap-0"
        >
          {sheetContent}
        </SheetContent>
      </Sheet>
    </MobileTreeSheetContext.Provider>
  );
}
