"use client";

/**
 * /dashboard/facilities, map first: the map fills the page, the list sits in
 * a 380 px panel on the right (desktop) or in a sheet under the map (phone).
 * docs/prompts/facilities-map.md is the brief; README.md beside this file is
 * the map of the code.
 *
 * All selection state lives here — the list and the pins only report clicks —
 * so the two can never disagree about which facility is selected.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Maximize2, Minus, Plus, Search, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { splitMainCluster } from "@/lib/geo/mainCluster";
import FacilityListRow from "./FacilityListRow";
import FacilityActions from "./FacilityActions";
import { countsLine, isLocated, type FacilityMapItem } from "./types";
import type { MapController } from "./FacilityMapCanvas";

const FacilityMapCanvas = dynamic(() => import("./FacilityMapCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-muted" aria-hidden />,
});

/** Room the camera leaves around pins: clears the card (300 px + gap) and the controls. */
const DESKTOP_PADDING = { top: 80, right: 80, bottom: 104, left: 340 };
/**
 * Padding is measured to a pin's tip, and the pin rises ~45 px above it with its
 * label ~35 px below. Phone: the top clears the off-map chips (16–48 px) plus a
 * pin; the bottom clears a label plus the sheet's 16 px overlap.
 */
const PHONE_PADDING = { top: 104, right: 72, bottom: 64, left: 48 };

interface FacilitiesMapViewProps {
  facilities: FacilityMapItem[];
  canCreate: boolean;
  token: string;
}

export default function FacilitiesMapView({ facilities, canCreate, token }: FacilitiesMapViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mapFailed, setMapFailed] = useState<string | null>(null);
  const controller = useRef<MapController | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const dark = useHtmlDark();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const desktop = useMediaQuery("(min-width: 1024px)");

  const located = useMemo(() => facilities.filter(isLocated), [facilities]);
  const { main, far } = useMemo(() => splitMainCluster(located), [located]);
  const mainIds = useMemo(() => main.map((f) => f.id), [main]);
  const farIds = useMemo(() => new Set(far.map((f) => f.id)), [far]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? facilities.filter(
            (f) => f.name.toLowerCase().includes(needle) || f.city.toLowerCase().includes(needle)
          )
        : facilities,
    [facilities, needle]
  );
  const visiblePins = useMemo(() => visible.filter(isLocated), [visible]);

  const showMap = located.length > 0 && !mapFailed;
  const selected = facilities.find((f) => f.id === selectedId) ?? null;

  const select = useCallback(
    (id: string, from: "list" | "map") => {
      setSelectedId(id);
      const f = facilities.find((x) => x.id === id);
      if (from === "list" && f && isLocated(f)) controller.current?.flyTo(id);
      if (from === "map") {
        rowRefs.current.get(id)?.scrollIntoView({
          block: "nearest",
          behavior: reducedMotion ? "auto" : "smooth",
        });
      }
    },
    [facilities, reducedMotion]
  );

  // Escape closes the card, from anywhere on the page.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const footer = `${facilities.length} ${facilities.length === 1 ? "facility" : "facilities"}${
    far.length > 0 && showMap ? ` · ${far.length} off this map` : ""
  }`;

  const addButton = canCreate ? (
    <Button asChild size="sm">
      <Link href="/dashboard/facilities/new">
        <Plus aria-hidden />
        Add facility
      </Link>
    </Button>
  ) : null;

  const list = (
    <ul className="divide-y divide-border">
      {visible.map((f) => (
        <li key={f.id}>
          <FacilityListRow
            ref={(el) => {
              if (el) rowRefs.current.set(f.id, el);
              else rowRefs.current.delete(f.id);
            }}
            facility={f}
            selected={f.id === selectedId}
            offMap={showMap && farIds.has(f.id)}
            // On a phone, and whenever there is no map to carry a card, the
            // selected row carries the actions itself.
            expanded={f.id === selectedId && (!desktop || !showMap)}
            onSelect={() => (f.id === selectedId ? setSelectedId(null) : select(f.id, "list"))}
            onHover={(over) => setHoveredId(over ? f.id : null)}
          />
        </li>
      ))}
      {visible.length === 0 && (
        <li className="px-4 py-8 text-center text-caption text-muted-foreground">
          No facility matches “{query.trim()}”.
        </li>
      )}
    </ul>
  );

  const search = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or city"
        aria-label="Search facilities by name or city"
        className="pl-9"
      />
    </div>
  );

  return (
    // Full bleed: cancel <main>'s padding (dashboard layout) on the sides and
    // top. On a phone the bottom padding stays — it clears the tab bar.
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mb-6 lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)]">
      {/* Phone title row. On a desktop the title lives in the right panel. */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:hidden">
        <h1 className="text-title text-foreground">Facilities</h1>
        {addButton}
      </div>

      {/* The map, or why there is none. */}
      <section
        aria-label="Facilities map"
        // On a phone the sheet overlaps the map's bottom 16 px; lift Mapbox's
        // logo and attribution out from under it (their terms want them seen).
        className="relative h-[45dvh] min-h-64 overflow-hidden bg-muted lg:h-full [&_.mapboxgl-ctrl-bottom-left]:mb-4 lg:[&_.mapboxgl-ctrl-bottom-left]:mb-0"
      >
        {showMap ? (
          <>
            <FacilityMapCanvas
              token={token}
              facilities={visiblePins}
              allPoints={located}
              mainIds={mainIds}
              selectedId={selectedId}
              hoveredId={hoveredId}
              dark={dark}
              reducedMotion={reducedMotion}
              padding={desktop ? DESKTOP_PADDING : PHONE_PADDING}
              onSelect={(id) => select(id, "map")}
              onFail={setMapFailed}
              controllerRef={controller}
            />

            {desktop && selected && (
              <SelectedCard facility={selected} onClose={() => setSelectedId(null)} />
            )}

            <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
              <div className="flex flex-col overflow-hidden rounded-control border border-border bg-card shadow-card">
                <MapButton label="Zoom in" onClick={() => controller.current?.zoomIn()}>
                  <Plus className="size-4" />
                </MapButton>
                <span className="h-px bg-border" aria-hidden />
                <MapButton label="Zoom out" onClick={() => controller.current?.zoomOut()}>
                  <Minus className="size-4" />
                </MapButton>
              </div>
              <button
                type="button"
                onClick={() => controller.current?.fitAll()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-card transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Maximize2 className="size-3.5" aria-hidden />
                Show all
              </button>
            </div>

            {far.length > 0 && (
              // Top-left on a phone (no card there, and the bottom is the
              // sheet's); bottom-right on a desktop, clear of the card.
              <ul className="absolute left-4 top-4 flex max-w-[calc(100%-6rem)] flex-col items-start gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:top-auto lg:max-w-[calc(100%-2rem)] lg:items-end">
                {far.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(f.id);
                        controller.current?.flyTo(f.id);
                      }}
                      className="inline-flex h-8 max-w-full items-center gap-1.5 truncate rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-card transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">
                        {f.name} · {f.city}, {f.province}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          // data-reason: why the map gave up (webgl, mapbox 401…) — for whoever
          // is debugging a preview origin the token is not restricted to.
          <div className="grid h-full place-items-center p-6 text-center" data-reason={mapFailed ?? undefined}>
            <div className="max-w-xs space-y-2">
              <MapPin className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="text-body text-muted-foreground">
                {mapFailed
                  ? "The map couldn’t load here. Every facility is in the list."
                  : "Add an address to a facility to see it on the map."}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* The list: a panel on the right, or a sheet that overlaps the map's
          bottom edge on a phone. */}
      <aside
        aria-label="Facilities"
        className="relative z-10 -mt-4 flex min-h-0 flex-col rounded-t-card border-border bg-background lg:mt-0 lg:rounded-none lg:border-l"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border lg:hidden" aria-hidden />
        <div className="space-y-3 px-4 pb-3 pt-3 lg:px-5 lg:pt-5">
          <div className="hidden items-center justify-between gap-3 lg:flex">
            <h1 className="text-title text-foreground">Facilities</h1>
            {addButton}
          </div>
          {search}
        </div>
        <div className="min-h-0 flex-1 border-t border-border lg:overflow-y-auto">{list}</div>
        <p className="border-t border-border px-4 py-3 text-caption text-muted-foreground lg:px-5">
          {footer}
        </p>
      </aside>
    </div>
  );
}

function SelectedCard({ facility, onClose }: { facility: FacilityMapItem; onClose(): void }) {
  return (
    <div
      role="region"
      aria-label={facility.name}
      className="absolute left-4 top-4 w-[300px] space-y-3 rounded-card border border-border bg-card p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-card-title text-foreground">{facility.name}</h2>
          <p className="text-caption text-muted-foreground">
            {facility.city}, {facility.province}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {facility.is_published ? <Badge variant="success">Published</Badge> : <Badge>Draft</Badge>}
        <Badge variant="outline">{countsLine(facility)}</Badge>
      </div>
      <FacilityActions facility={facility} />
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/**
 * Whether <html> carries `.dark`. The dashboard has no theme library: the top
 * bar and the account panel toggle that class directly, so it is watched.
 */
function useHtmlDark(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false
  );
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

