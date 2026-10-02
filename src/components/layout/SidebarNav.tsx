"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import OrgImage from "@/components/media/OrgImage";
import { useNavTree } from "@/hooks/useNavTree";
import { isScoped } from "@/lib/auth/roles";
import {
  allowsAllFacilities,
  facilitySwitchHref,
  isFacilityScoped,
  readRememberedFacility,
  rememberFacility,
  subscribeRememberedFacility,
} from "@/lib/dashboard/scope";
import FacilitySwitcher, { ALL_FACILITIES } from "./FacilitySwitcher";
import SidebarMenu from "./SidebarMenu";

interface SidebarNavProps {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  /** Called whenever a Menu link is clicked — used to close a mobile sheet on navigation. */
  onNavigate?: () => void;
  /** Icon-only mode for the collapsed desktop sidebar. */
  collapsed?: boolean;
}

/** Which facility a route is "inside", from the query string or the legacy `/facilities/[id]` path. */
function urlFacilityId(pathname: string, params: URLSearchParams): string | null {
  const fromPath = pathname.match(/^\/dashboard\/facilities\/([^/]+)/)?.[1];
  return params.get("facility") ?? (fromPath && fromPath !== "new" ? fromPath : null);
}

/**
 * The sidebar's body: the building switcher on top, the Menu below.
 *
 * The building in use is the URL's (`?facility=`, or the legacy path), else
 * the remembered one (lib/dashboard/scope.ts), else the first — the same
 * order every facility-scoped page resolves it in on the server, so the
 * switcher and the page cannot disagree. Switching navigates the page you are
 * on to the same kind of page in the new building (`facilitySwitchHref`); on
 * an org-wide page it only changes the remembered building and where the
 * Menu's links point.
 *
 * Department is not chosen here — it is a filter on the pages that have one
 * (docs/DESIGN.md "Scope and filters") — and a schedule is something you open
 * from the Schedules list, not a filter at all.
 *
 * Shared between the desktop <aside> and the mobile sheet.
 */
export default function SidebarNav({ orgId, orgName, orgLogoUrl, onNavigate, collapsed }: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data } = useNavTree(orgId);

  // null on the server: the switcher only renders once the tree has loaded,
  // which is always after hydration, so the server and client agree.
  const remembered = useSyncExternalStore(subscribeRememberedFacility, readRememberedFacility, () => null);

  const facilities = data?.facilities ?? [];
  const known = (id: string | null) => (id && facilities.some((f) => f.id === id) ? id : null);

  const fromUrl = known(urlFacilityId(pathname, new URLSearchParams(searchParams.toString())));
  // The building the Menu's links carry: never "all".
  const facilityId = fromUrl ?? known(remembered) ?? facilities[0]?.id ?? null;

  // "All facilities" only where it means something, only for the roles that
  // hold every building, and — as it always has there — when the URL names none.
  const offerAll = !!data && !isScoped(data.role) && allowsAllFacilities(pathname);
  const showingAll = offerAll && !searchParams.get("facility");
  const orgWide = !isFacilityScoped(pathname);

  // A building named by the URL is the one you are working in: remember it,
  // so the next bare link (the phone bar, a bookmark) opens here too.
  useEffect(() => {
    if (fromUrl) rememberFacility(fromUrl);
  }, [fromUrl]);

  function handleSwitch(value: string) {
    const next = value === ALL_FACILITIES ? null : value;
    if (next) rememberFacility(next);
    const href = facilitySwitchHref(pathname, new URLSearchParams(searchParams.toString()), next);
    if (href) router.push(href);
  }

  const switcher = data ? (
    <FacilitySwitcher
      facilities={facilities}
      departments={data.departments}
      scheduleGroups={data.scheduleGroups}
      value={showingAll ? ALL_FACILITIES : facilityId}
      onChange={handleSwitch}
      offerAll={offerAll}
      orgWide={orgWide}
      collapsed={collapsed}
    />
  ) : null;

  // With nothing to switch between, the org line keeps its place under "Dropin".
  const showOrgLine = !collapsed && facilities.length < 2;

  return (
    <>
      <div className="shrink-0">
        {showOrgLine && (
          <div className="flex items-center gap-2 min-w-0 px-4 pb-3">
            {orgLogoUrl && (
              <span className="relative size-5 rounded shrink-0 overflow-hidden bg-muted">
                <OrgImage src={orgLogoUrl} alt="" sizes="20px" className="object-cover" />
              </span>
            )}
            <p className="text-caption text-muted-foreground truncate">{orgName}</p>
          </div>
        )}
        {switcher}
        <div className="border-t border-border mx-4" />
      </div>
      <div className="sidebar-scroll flex-1 overflow-y-auto flex flex-col">
        <SidebarMenu
          // Defaults to the LEAST privileged role while the tree is loading, so a
          // slow network shows too little rather than briefly offering Billing to
          // a lifeguard. Fail closed, even in a loading state.
          role={data?.role ?? "aux"}
          facilityId={facilityId}
          analyticsAll={showingAll}
          hasFacility={facilities.length > 0}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      </div>
    </>
  );
}
