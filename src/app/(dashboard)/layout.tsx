import { Suspense } from "react";
import DashboardBottomNav from "@/components/layout/DashboardBottomNav";
import MobileTreeSheetProvider from "@/components/layout/MobileTreeSheetProvider";
import OrgGuard from "@/components/layout/OrgGuard";
import Providers from "@/components/layout/Providers";
import {
  TreeNavSection,
  TopbarSection,
  MobileSheetSection,
} from "@/components/layout/DashboardChromeSections";
import {
  TreeNavSkeleton,
  TopbarSkeleton,
  MobileSheetSkeleton,
  BottomNavSkeleton,
  DashboardPageSkeleton,
} from "@/components/layout/DashboardChromeSkeletons";

/**
 * Note that this component is not async and awaits nothing.
 *
 * Under Cache Components every route ships a prerendered static shell, and
 * anything this layout touches directly — awaited data, or request data such as
 * cookies and the pathname — blocks that shell for every page beneath it. So
 * each piece that needs request data sits behind its own Suspense boundary and
 * streams in independently.
 *
 * Two of those boundaries are less obvious than they look:
 *
 *   - The org lookup lives inside the *Section components, not here. Merely
 *     calling getOrgContext() from this component counts as reading cookies
 *     outside a boundary, even before the promise is awaited.
 *   - DashboardBottomNav calls usePathname(), which on a dynamic route is not
 *     known at prerender time. Without its own boundary it blocks the shell
 *     exactly like an uncached fetch would.
 *
 * The redirect that used to live here moved to <OrgGuard /> for the same
 * reason.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <MobileTreeSheetProvider
        sheetContent={
          <Suspense fallback={<MobileSheetSkeleton />}>
            <MobileSheetSection />
          </Suspense>
        }
      >
        <div className="flex min-h-screen bg-background">
          <Suspense fallback={<TreeNavSkeleton />}>
            <TreeNavSection />
          </Suspense>

          <div className="flex-1 flex flex-col min-w-0">
            <Suspense fallback={<TopbarSkeleton />}>
              <TopbarSection />
            </Suspense>

            {/* pb-20 adds bottom padding on mobile so content isn't hidden behind the tab bar */}
            <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
              <Suspense fallback={<DashboardPageSkeleton />}>
                {children}
              </Suspense>
            </main>
          </div>

          <Suspense fallback={<BottomNavSkeleton />}>
            <DashboardBottomNav />
          </Suspense>
        </div>
      </MobileTreeSheetProvider>

      {/* Renders nothing; redirects if the user has no org. */}
      <Suspense fallback={null}>
        <OrgGuard />
      </Suspense>
    </Providers>
  );
}
