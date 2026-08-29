"use client";

import { useEffect, useRef } from "react";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface TrackPayload {
  event: "widget_view" | "facility_view" | "view_change" | "session_duration";
  orgId: string;
  facilityId?: string | null;
  viewTemplate?: ScheduleTemplate | null;
  durationMs?: number;
}

function send(payload: TrackPayload, keepalive: boolean) {
  const body = JSON.stringify({
    event: payload.event,
    orgId: payload.orgId,
    facilityId: payload.facilityId ?? null,
    viewTemplate: payload.viewTemplate ?? null,
    durationMs: payload.durationMs ?? null,
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    pathname: typeof window !== "undefined" ? window.location.pathname : null,
  });

  // sendBeacon is the only reliable way to deliver the final duration ping —
  // by the time it fires the page is already unloading, so a normal fetch
  // can be cancelled mid-flight. It requires a Blob with an explicit content
  // type; the route parses the body with request.json() regardless of what
  // content-type arrives, so a text/plain beacon still parses correctly.
  if (keepalive && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics/track", new Blob([body], { type: "application/json" }));
    return;
  }

  fetch("/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive,
  }).catch(() => {});
}

interface UseScheduleAnalyticsOptions {
  /** "widget_view" for the embedded iframe, "facility_view" for the public
   *  facility page. Pass null to skip the initial view ping entirely — the
   *  embed's own widget.js already fires widget_view once per load, so the
   *  React tree inside the iframe must not fire a second one. */
  viewEvent: "widget_view" | "facility_view" | null;
  orgId: string;
  facilityId?: string | null;
  view: ScheduleTemplate;
}

/**
 * Fires the view-type and time-on-page analytics for a schedule surface
 * (widget iframe or public facility page). Shared by WidgetScheduleClient
 * and FacilityScheduleClient so both report through the same three events:
 * an initial view, one `view_change` per template switch, and a single
 * `session_duration` on unload covering the whole visit.
 */
export function useScheduleAnalytics({ viewEvent, orgId, facilityId, view }: UseScheduleAnalyticsOptions) {
  const startedAt = useRef<number | null>(null);
  const firstView = useRef(true);

  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      if (viewEvent) {
        send({ event: viewEvent, orgId, facilityId, viewTemplate: view }, false);
      }
      return;
    }
    send({ event: "view_change", orgId, facilityId, viewTemplate: view }, false);
    // Only re-fires on a real template switch — viewEvent/orgId/facilityId
    // are stable for the lifetime of one widget/page mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    startedAt.current = Date.now();

    function reportDuration() {
      if (startedAt.current === null) return;
      const durationMs = Date.now() - startedAt.current;
      send({ event: "session_duration", orgId, facilityId, durationMs }, true);
    }

    // visibilitychange fires reliably on mobile (where "unload" often doesn't);
    // pagehide covers desktop tab close and back/forward navigation.
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") reportDuration();
    }

    window.addEventListener("pagehide", reportDuration);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", reportDuration);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // orgId/facilityId are stable for the mount's lifetime — startedAt is a
    // ref specifically so this effect never needs to re-run on view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
