"use client";

import { useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface FacilityWithCoords {
  id: string;
  slug: string;
  name: string;
  city: string;
  province: string;
  lat: number | null;
  lng: number | null;
}

interface FacilityMapProps {
  facilities: FacilityWithCoords[];
  onFacilityHover?: (facilityId: string | null) => void;
  onFacilityClick?: (facilitySlug: string) => void;
  /** Default map center — falls back to Calgary if no facilities have coords */
  defaultCenter?: [number, number];
}

/**
 * Mapbox GL JS facility discovery map.
 *
 * Renders blue pins for each facility that has geocoded coordinates.
 * Hovering a pin highlights the corresponding FacilityCard in the list,
 * and vice versa (controlled via onFacilityHover callback).
 *
 * Uses a ref-based imperative pattern — Mapbox needs to own the DOM node.
 */
export default function FacilityMap({
  facilities,
  onFacilityHover,
  onFacilityClick,
  defaultCenter = [-114.0719, 51.0447], // Calgary
}: FacilityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  }, []);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: defaultCenter,
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      clearMarkers();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render markers whenever facilities change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const addMarkers = () => {
      clearMarkers();

      const located = facilities.filter((f) => f.lat != null && f.lng != null);
      if (located.length === 0) return;

      // Fit map to all markers
      const bounds = new mapboxgl.LngLatBounds();

      located.forEach((facility) => {
        const el = document.createElement("div");
        el.className = "dropin-marker";
        el.style.cssText = `
          width: 28px; height: 28px; border-radius: 50%;
          background: #2563eb; border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          cursor: pointer; transition: transform 0.15s, background 0.15s;
        `;

        el.addEventListener("mouseenter", () => {
          el.style.background = "#1d4ed8";
          el.style.transform = "scale(1.2)";
          onFacilityHover?.(facility.id);
        });
        el.addEventListener("mouseleave", () => {
          el.style.background = "#2563eb";
          el.style.transform = "scale(1)";
          onFacilityHover?.(null);
        });
        el.addEventListener("click", () => {
          onFacilityClick?.(facility.slug);
        });

        const popup = new mapboxgl.Popup({ offset: 16, closeButton: false })
          .setHTML(`
            <div style="font-family:sans-serif;padding:4px 2px">
              <p style="font-weight:600;font-size:13px;margin:0">${facility.name}</p>
              <p style="color:#6b7280;font-size:11px;margin:2px 0 0">${facility.city}, ${facility.province}</p>
            </div>
          `);

        const marker = new mapboxgl.Marker(el)
          .setLngLat([facility.lng!, facility.lat!])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
        bounds.extend([facility.lng!, facility.lat!]);
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 800 });
      }
    };

    if (map.isStyleLoaded()) {
      addMarkers();
    } else {
      map.once("load", addMarkers);
    }
  }, [facilities, clearMarkers, onFacilityHover, onFacilityClick]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-xl overflow-hidden"
      aria-label="Facility map"
    />
  );
}
