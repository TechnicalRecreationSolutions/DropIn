import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/session";
import { getClaims } from "@/lib/auth/claims";
import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/utils/dates";
import DeckSheetPage from "@/components/schedule/DeckSheetPage";

/**
 * `/dashboard/schedule/deck` — the printable deck sheet (stage 4 of
 * docs/PLAN-internal-view.md). Spaces across, time down, one day: the hand-built
 * Excel sheet this product was asked to replace.
 *
 * Under the `(print)` route group, so it keeps the proxy's `/dashboard/*` auth
 * redirect but renders none of the dashboard chrome — see that group's layout.
 *
 * Staff-only, and unlike every other schedule surface there is no public variant
 * of it: the sheet carries holder names and setup notes, and `noindex` plus the
 * membership check below are the two reasons a link to it cannot become a leak.
 * It is deliberately not a `ScheduleTemplate`, so no widget configuration can
 * select it.
 */
/**
 * Blocking, unlike every other dashboard route (which sets `instant = true` and
 * streams inside a Suspense boundary). A deck sheet is printed, not navigated:
 * there is no perceived-latency win in showing a shell, and a partially
 * streamed page is the one outcome that must never reach a printer — half a
 * lane grid looks like a complete sheet. So this route reads cookies and
 * renders whole, or not at all.
 *
 * Without this the build fails outright: `getOrgContext()` reads cookies
 * outside a Suspense boundary, which cannot be prerendered.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Deck sheet",
  robots: { index: false, follow: false },
};

interface DeckPageProps {
  searchParams: Promise<{ facility?: string; date?: string }>;
}

export default async function DeckPage({ searchParams }: DeckPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) {
    // Same two cases OrgGuard separates: no session at all, or signed in with no
    // org yet. getClaims() is cache()d and already resolved, so this is free.
    const claims = await getClaims();
    redirect(claims ? "/dashboard/org/onboarding" : "/login");
  }

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam, date: dateParam } = await searchParams;

  const [{ data: facilityRows }, { data: spaceRows }] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgId).order("name"),
    supabase
      .from("spaces")
      .select("id, name, facility_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }),
  ]);

  const facilities = facilityRows ?? [];
  if (facilities.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground mb-1">Nothing to print yet</h1>
        <p className="text-sm text-muted-foreground">
          A deck sheet is one building&apos;s day. Add a facility and its spaces first.
        </p>
      </div>
    );
  }

  const facility = facilities.find((f) => f.id === facilityParam) ?? facilities[0];

  // A bad/absent date lands on today rather than erroring: this page is opened
  // from a print button, and refusing to render is the wrong answer on deck.
  const dateKey =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : localDateString();

  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <DeckSheetPage
      facilities={facilities}
      facilityId={facility.id}
      facilityName={facility.name}
      spaces={spaces}
      dateKey={dateKey}
    />
  );
}
