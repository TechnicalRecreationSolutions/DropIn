"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, LocateFixed, MapPin, Search, Star, X, Loader2 } from "lucide-react";
import OrgImage from "@/components/media/OrgImage";
import { cn } from "@/lib/utils/cn";
import { filterFacilities, sortByDistance } from "@/lib/directory/filter";
import { useSavedFacilities } from "@/lib/directory/savedFacilities";
import { DIRECTORY_ATTRIBUTION, type DirectoryFacility, type DirectorySport } from "@/lib/directory/types";

type GeoStatus = "idle" | "locating" | "on" | "denied" | "unavailable";
type Result = DirectoryFacility & { distanceKm: number | null };

const GEO_MESSAGE: Partial<Record<GeoStatus, string>> = {
  denied: "Location is blocked for this site. Allow it in your browser settings, or search by city instead.",
  unavailable: "We couldn’t get your location. Try again, or search by city instead.",
};

interface FindClientProps {
  /** null when the directory could not be read. */
  listings: DirectoryFacility[] | null;
}

/**
 * The resident-facing directory: search, sport filter, "near me", and saved
 * centres. Everything happens in the browser over the listing set the server
 * rendered — the same data and the same filter functions as
 * /api/public/v1/directory — so the visitor's location never leaves the device.
 *
 * The search and sport live in the URL (replaceState, no navigation) so a
 * result list can be shared or come back on Back. Location deliberately does
 * not: a shared link should not carry someone's position.
 */
export default function FindClient({ listings }: FindClientProps) {
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [sport, setSport] = useState(() => params.get("sport") ?? "");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const { saved, toggle } = useSavedFacilities();

  const all = useMemo(() => listings ?? [], [listings]);

  const sports = useMemo(() => {
    const byId = new Map<string, DirectorySport>();
    for (const f of all) for (const s of f.sports) byId.set(s.id, s);
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);

  const results: Result[] = useMemo(() => {
    const matched = filterFacilities(all, { q: query, sport });
    return origin
      ? sortByDistance(matched, origin)
      : matched.map((f) => ({ ...f, distanceKm: null }));
  }, [all, query, sport, origin]);

  const savedResults = useMemo(() => {
    const byId = new Map(all.map((f) => [f.id, f]));
    return saved.flatMap((id) => {
      const f = byId.get(id);
      return f ? [f] : [];
    });
  }, [all, saved]);

  function syncUrl(next: { q?: string; sport?: string }) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function changeQuery(value: string) {
    setQuery(value);
    syncUrl({ q: value.trim() });
  }

  function changeSport(value: string) {
    setSport(value);
    syncUrl({ sport: value });
  }

  function clearFilters() {
    setQuery("");
    setSport("");
    syncUrl({ q: "", sport: "" });
  }

  function locate() {
    if (geoStatus === "on") {
      setOrigin(null);
      setGeoStatus("idle");
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setGeoStatus("on");
      },
      (error) => setGeoStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }

  if (listings === null) {
    return (
      <div role="alert" className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="font-medium text-foreground">The directory is unavailable right now.</p>
        <p className="mt-1 text-sm text-muted-foreground">Please try again in a minute.</p>
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <Building2 className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 font-medium text-foreground">No centres are listed yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">Check back soon — centres are joining Dropin.</p>
        <ForCentresLink className="mt-4" />
      </div>
    );
  }

  const filtering = query.trim() !== "" || sport !== "";
  const geoMessage = GEO_MESSAGE[geoStatus];

  return (
    <div>
      {/* Controls */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search by centre name or city</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder="Centre name or city"
              maxLength={80}
              enterKeyHint="search"
              className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => changeQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={locate}
            disabled={geoStatus === "locating"}
            aria-pressed={geoStatus === "on"}
            className={cn(
              "inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors disabled:opacity-70",
              geoStatus === "on"
                ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                : "border-border bg-card text-foreground hover:bg-muted"
            )}
          >
            {geoStatus === "locating" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <LocateFixed className="size-4" aria-hidden />
            )}
            {geoStatus === "on" ? "Sorted by distance" : geoStatus === "locating" ? "Finding you…" : "Use my location"}
          </button>
        </div>

        {geoMessage && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{geoMessage}</p>
        )}
        {geoStatus === "on" && (
          <p className="text-xs text-muted-foreground">
            Your location is only used on this device to sort results.{" "}
            <button type="button" onClick={locate} className="underline underline-offset-2 hover:text-foreground">
              Stop using it
            </button>
          </p>
        )}

        {sports.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div role="group" aria-label="Filter by sport" className="flex gap-2 pb-1">
              <SportChip label="All sports" active={sport === ""} onClick={() => changeSport("")} />
              {sports.map((s) => (
                <SportChip
                  key={s.id}
                  label={s.label}
                  active={sport === s.id}
                  onClick={() => changeSport(sport === s.id ? "" : s.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Saved centres — only while browsing, so a search shows just its matches */}
      {!filtering && savedResults.length > 0 && (
        <section aria-labelledby="saved-heading" className="mt-8">
          <h2 id="saved-heading" className="text-sm font-semibold text-foreground">Your saved centres</h2>
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {savedResults.map((f) => (
              <li key={f.id} className="shrink-0">
                <Link
                  href={f.path}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <Star className="size-4 fill-amber-400 text-amber-500" aria-hidden />
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Results */}
      <section aria-labelledby="results-heading" className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="results-heading" className="text-sm font-semibold text-foreground">
            {filtering ? "Matching centres" : "All centres"}
          </h2>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {results.length} {results.length === 1 ? "centre" : "centres"}
          </p>
        </div>

        {results.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <p className="font-medium text-foreground">
              {query.trim() ? `No centres match “${query.trim()}”` : "No centres match these filters"}
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium text-blue-600 hover:bg-muted dark:text-blue-400"
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {results.map((f) => (
              <li key={f.id}>
                <FacilityResult
                  facility={f}
                  saved={saved.includes(f.id)}
                  onToggleSaved={() => toggle(f.id)}
                  highlightSport={sport}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {DIRECTORY_ATTRIBUTION}
          </a>
          . Centres choose whether to be listed.
        </p>
        <ForCentresLink />
      </footer>
    </div>
  );
}

function SportChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors",
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-border bg-card text-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

const MAX_SPORTS_SHOWN = 4;

function FacilityResult({
  facility,
  saved,
  onToggleSaved,
  highlightSport,
}: {
  facility: Result;
  saved: boolean;
  onToggleSaved: () => void;
  highlightSport: string;
}) {
  const shown = facility.sports.slice(0, MAX_SPORTS_SHOWN);
  const hidden = facility.sports.length - shown.length;

  return (
    <article className="relative flex h-full gap-3 rounded-xl border border-border bg-card p-3 transition-shadow focus-within:ring-2 focus-within:ring-blue-500 hover:shadow-md sm:p-4">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-20">
        {facility.photoUrl ? (
          <OrgImage src={facility.photoUrl} alt="" sizes="80px" className="object-cover" />
        ) : (
          <Building2 className="absolute inset-0 m-auto size-7 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1 pr-10">
        <h3 className="font-semibold leading-snug text-foreground">
          {/* The whole card is the link target; the star sits above it. */}
          <Link href={facility.path} className="outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']">
            {facility.name}
          </Link>
        </h3>
        <p className="truncate text-sm text-muted-foreground">{facility.organization.name}</p>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {facility.address.city}, {facility.address.province}
          </span>
          {facility.distanceKm !== null && (
            <span className="shrink-0 font-medium text-foreground">· {formatDistance(facility.distanceKm)}</span>
          )}
        </p>
        {shown.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Sports">
            {shown.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  s.id === highlightSport
                    ? "bg-blue-600 text-white"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {s.label}
              </li>
            ))}
            {hidden > 0 && (
              <li className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">+{hidden}</li>
            )}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onToggleSaved}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${facility.name} from saved` : `Save ${facility.name}`}
        className="absolute right-1.5 top-1.5 z-10 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Star className={cn("size-5", saved && "fill-amber-400 text-amber-500")} />
      </button>
    </article>
  );
}

function ForCentresLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400", className)}
    >
      Run a recreation centre? List your schedule →
    </Link>
  );
}
