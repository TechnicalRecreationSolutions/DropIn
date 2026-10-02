"use client";

/**
 * The Mapbox map on /dashboard/facilities. Loaded only there, through
 * `next/dynamic({ ssr: false })` in FacilitiesMapView — the rest of the
 * dashboard never downloads mapbox-gl or its CSS.
 *
 * Owns the map instance and nothing else: which facility is selected or
 * hovered lives in FacilitiesMapView and arrives as props, so the list and
 * the pins can never disagree. The parent moves the camera through the
 * imperative handle (`flyTo`, `fitAll`, `fitMain`), because "the user picked
 * a row" is an event, not a state the map should re-derive on every render.
 *
 * Pins are DOM markers whose contents are rendered by React through portals,
 * so they use the same tokens, icons and focus ring as the rest of the page,
 * and survive a style swap (light ↔ dark) untouched. At 50+ facilities they
 * should become a clustered symbol layer instead; no organization is near that.
 *
 * Uses the CSP build: its worker is a file on this origin rather than a blob
 * URL, so the CSP keeps worker-src 'self' (src/lib/security/csp.ts).
 */

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import mapboxgl from "mapbox-gl/dist/mapbox-gl-csp";
import "mapbox-gl/dist/mapbox-gl.css";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import OrgImage from "@/components/media/OrgImage";
import { boundsOf } from "@/lib/geo/mainCluster";
import type { LocatedFacility } from "./types";

mapboxgl.workerUrl = "/mapbox-gl-csp-worker.js";

const STYLE = {
  light: "mapbox://styles/mapbox/light-v11",
  dark: "mapbox://styles/mapbox/dark-v11",
} as const;

/** One building on its own: a street-level view rather than a fitted box. */
const SINGLE_ZOOM = 15;
const MAX_FIT_ZOOM = 15;

export interface MapController {
  flyTo(id: string): void;
  fitMain(): void;
  fitAll(): void;
  zoomIn(): void;
  zoomOut(): void;
}

interface FacilityMapCanvasProps {
  token: string;
  /** Every located facility that passes the search. */
  facilities: LocatedFacility[];
  /** Ids the opening view fits (the main cluster). */
  mainIds: string[];
  /** Ids of every located facility, search aside — what "Show all" fits. */
  allPoints: LocatedFacility[];
  selectedId: string | null;
  hoveredId: string | null;
  dark: boolean;
  reducedMotion: boolean;
  /** Room the camera leaves for the floating card and controls, in px. */
  padding: { top: number; right: number; bottom: number; left: number };
  onSelect(id: string): void;
  /** The map could not start or its tiles were refused — show the list alone. */
  onFail(reason: string): void;
  controllerRef: Ref<MapController | null>;
}

export default function FacilityMapCanvas({
  token,
  facilities,
  mainIds,
  allPoints,
  selectedId,
  hoveredId,
  dark,
  reducedMotion,
  padding,
  onSelect,
  onFail,
  controllerRef,
}: FacilityMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef(new Map<string, mapboxgl.Marker>());
  const [markerEls, setMarkerEls] = useState<Map<string, HTMLElement>>(new Map());
  // Latest values for callbacks registered once at map creation.
  const live = useRef({ onFail, onSelect, reducedMotion, padding, allPoints, mainIds });
  useEffect(() => {
    live.current = { onFail, onSelect, reducedMotion, padding, allPoints, mainIds };
  });

  function fit(points: LocatedFacility[], animate: boolean) {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    const { padding: pad, reducedMotion: still } = live.current;
    const duration = animate && !still ? 600 : 0;
    if (points.length === 1) {
      map.easeTo({ center: [points[0].lng, points[0].lat], zoom: SINGLE_ZOOM, padding: pad, duration });
      return;
    }
    map.fitBounds(boundsOf(points), { padding: pad, maxZoom: MAX_FIT_ZOOM, duration });
  }

  useImperativeHandle(controllerRef, () => ({
    flyTo(id) {
      const map = mapRef.current;
      const f = live.current.allPoints.find((p) => p.id === id);
      if (!map || !f) return;
      const { padding: pad, reducedMotion: still } = live.current;
      const options = { center: [f.lng, f.lat] as [number, number], zoom: Math.max(map.getZoom(), 13), padding: pad };
      if (still) map.jumpTo(options);
      else map.easeTo({ ...options, duration: 700 });
    },
    fitMain() {
      const ids = new Set(live.current.mainIds);
      fit(live.current.allPoints.filter((p) => ids.has(p.id)), true);
    },
    fitAll() {
      fit(live.current.allPoints, true);
    },
    zoomIn() {
      mapRef.current?.zoomIn({ duration: live.current.reducedMotion ? 0 : 250 });
    },
    zoomOut() {
      mapRef.current?.zoomOut({ duration: live.current.reducedMotion ? 0 : 250 });
    },
  }));

  // Create the map once. The style follows `dark` in the effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!mapboxgl.supported()) {
      live.current.onFail("webgl");
      return;
    }
    mapboxgl.accessToken = token;
    const ids = new Set(live.current.mainIds);
    const opening = live.current.allPoints.filter((p) => ids.has(p.id));
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container,
        style: dark ? STYLE.dark : STYLE.light,
        // Spread, not `key: undefined` — mapbox-gl treats an explicit
        // undefined centre as a value and fails with "Invalid LngLat (NaN, NaN)".
        ...(opening.length > 1
          ? { bounds: boundsOf(opening), fitBoundsOptions: { padding: live.current.padding, maxZoom: MAX_FIT_ZOOM } }
          : { center: [opening[0].lng, opening[0].lat] as [number, number], zoom: SINGLE_ZOOM }),
        attributionControl: false,
        // Rotation means nothing on a map of buildings, and a stray
        // right-drag leaving it tilted is a support question.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: false,
      });
    } catch (err) {
      live.current.onFail(err instanceof Error ? err.message : "init");
      return;
    }
    map.touchZoomRotate.disableRotation();
    // Required by Mapbox's terms. Compact keeps it to an (i) until asked.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    map.getCanvas().setAttribute("aria-label", "Map of your facilities. The list beside it has every facility and action.");

    // A refused token (wrong origin, revoked) arrives as a 401/403 on the
    // style or tile request — the map would sit there grey. Hand over to the
    // list instead.
    map.on("error", (e) => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) live.current.onFail(`mapbox ${status}`);
    });

    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
    // `dark` is read once for the opening style; the next effect follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Theme: the dashboard flips `.dark` on <html>; FacilitiesMapView watches it.
  const shownStyle = useRef(dark);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || shownStyle.current === dark) return;
    shownStyle.current = dark;
    map.setStyle(dark ? STYLE.dark : STYLE.light);
  }, [dark]);

  // Markers: add/remove to match `facilities` (the search filters pins too).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Map(facilities.map((f) => [f.id, f]));
    let changed = false;
    for (const [id, marker] of markersRef.current) {
      if (!want.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
        changed = true;
      }
    }
    for (const f of facilities) {
      const existing = markersRef.current.get(f.id);
      if (existing) {
        existing.setLngLat([f.lng, f.lat]);
        continue;
      }
      const el = document.createElement("div");
      el.className = "facility-pin";
      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([f.lng, f.lat])
        .addTo(map);
      markersRef.current.set(f.id, marker);
      changed = true;
    }
    if (changed) {
      setMarkerEls(new Map([...markersRef.current].map(([id, m]) => [id, m.getElement()])));
    }
  }, [facilities]);

  // Raise the hovered and the selected pin above their neighbours.
  useEffect(() => {
    for (const [id, m] of markersRef.current) {
      m.getElement().style.zIndex = id === selectedId ? "3" : id === hoveredId ? "2" : "";
    }
  }, [selectedId, hoveredId, markerEls]);

  const byId = new Map(facilities.map((f) => [f.id, f]));

  return (
    <>
      {/* The container is sized by a wrapper, not positioned itself:
          mapbox-gl.css gives .mapboxgl-map `position: relative`, which beats
          `absolute` on the same element and collapses the map to 0 px. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="size-full" />
      </div>
      {[...markerEls].map(([id, el]) => {
        const f = byId.get(id);
        if (!f) return null;
        return createPortal(
          <FacilityPin
            facility={f}
            selected={id === selectedId}
            raised={id === hoveredId}
            onSelect={() => onSelect(id)}
          />,
          el,
          id
        );
      })}
    </>
  );
}

/**
 * A 36 px teardrop in ink (brand when selected) with a 3 px ring, and the
 * name in a solid pill under it — solid so the label keeps 4.5:1 over any
 * tile. The whole thing is one button.
 */
function FacilityPin({
  facility,
  selected,
  raised,
  onSelect,
}: {
  facility: LocatedFacility;
  selected: boolean;
  raised: boolean;
  onSelect(): void;
}) {
  const photo = facility.photo_urls[0] ?? null;
  return (
    <button
      type="button"
      aria-label={facility.name}
      aria-pressed={selected}
      onClick={(e) => {
        // The map would otherwise also see the click.
        e.stopPropagation();
        onSelect();
      }}
      className="group relative block size-9 cursor-pointer rounded-full focus-visible:outline-none"
      // The teardrop's point, rotated out of the box, reaches ~7 px below it.
      style={{ marginBottom: 7 }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full rounded-br-none rotate-45 ring-[3px] ring-card shadow-card transition-[background-color,transform] duration-150 group-focus-visible:ring-ring",
          selected ? "bg-brand" : "bg-primary",
          (selected || raised) && "scale-110"
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute inset-[5px] grid place-items-center overflow-hidden rounded-full",
          selected ? "text-brand-foreground" : "text-primary-foreground"
        )}
      >
        {photo ? (
          <OrgImage src={photo} alt="" sizes="26px" className="object-cover" />
        ) : (
          <Building2 className="size-4" />
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 top-[calc(100%+12px)] max-w-36 -translate-x-1/2 truncate rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap shadow-card",
          selected ? "border-brand bg-brand-subtle text-brand-strong" : "border-border bg-card text-foreground"
        )}
      >
        {facility.name}
      </span>
    </button>
  );
}
