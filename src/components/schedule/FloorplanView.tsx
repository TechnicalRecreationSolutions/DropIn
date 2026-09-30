"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { useFacilityMap, type FacilityMapPayload } from "@/hooks/useFacilityMap";
import { formatSessionTime, minutesOfDayIn, nowAsSessionTime, sessionDateString } from "@/lib/utils/dates";
import { computeFloorplanStatus } from "@/lib/floorplan/spaceStatus";
import FacilityMapSvg from "@/components/facility-maps/renderer/FacilityMapSvg";
import type { RenderShape, RenderContextElement } from "@/components/facility-maps/renderer/types";
import SpaceDetailSheet from "./SpaceDetailSheet";
import TimeControl from "./TimeControl";
import FloorplanLegend, { FloorplanKey } from "./FloorplanLegend";

interface FloorplanViewProps {
  facilityId: string;
  sessions: ExpandedSession[];
  /**
   * A map to draw instead of fetching one — the landing page's sample
   * building, which has no row behind it. The fetch is skipped entirely (an
   * empty id disables the query), so its 60-second refetch never asks the API
   * about a facility that does not exist.
   */
  map?: FacilityMapPayload;
}

const DEFAULT_RANGE = { startMinutes: 360, endMinutes: 1320 }; // 6am–10pm fallback

// The scrub slider is "time of day at this building" — sessions carry no
// timezone (dropin/docs/RESUME-timezone-removal.md), so every position on it
// is read straight off the session-Date convention via the shared
// minutesOfDayIn/nowAsSessionTime, with the viewer presumed local to the
// facility, same as the rest of the app.

/**
 * Visual, tap-to-see-status alternative to the grid/list/map views — an org
 * builds a from-scratch diagram of the facility from preset-shaped pools/
 * courts (see the Map tab's ShapeCanvas builder), rendered here through the
 * shared illustrated engine (facility-maps/renderer). Recognition-first: a
 * visitor who doesn't know what "Lane 3" means can still find the right
 * spot by sight — water looks like water, courts carry their markings.
 *
 * Layout follows the space it is given, not the viewport (a container
 * query — the same component runs full-page, in a narrow widget iframe, and
 * on a lobby screen): narrow, it is one column — summary strip, full-width
 * map, time control, then FloorplanLegend — so the map keeps every pixel
 * of width on phones; wide, the legend moves beside the map.
 *
 * Every space carries one of three states at the viewed time — live
 * (org-accent wash + session name), starting soon (amber), or free — plus,
 * when a transition is minutes away, an alert drawn as an orange outline
 * and a tag ("Ends in 6 min", "→ Aquafit 7:30 PM"). The rules and
 * thresholds live in lib/floorplan/spaceStatus.ts. Tapping a space (or a
 * legend row) opens SpaceDetailSheet with the live session, cost, and
 * what's next in that spot.
 *
 * The time control previews the map at any time today (defaulting to the
 * current moment), spanning today's actual earliest-to-latest session time
 * — falling back to a fixed 6am–10pm window when there are no sessions
 * today, since no facility open/close-hours field exists to read instead.
 */
export default function FloorplanView({ facilityId, sessions, map }: FloorplanViewProps) {
  const query = useFacilityMap(map ? "" : facilityId);
  const data = map ?? query.data;
  const isLoading = !map && query.isLoading;
  const isError = !map && query.isError;
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  // Ticks every 30s so a visitor who leaves the tab open doesn't get stuck
  // looking at the live/soon status from whenever the page happened to load —
  // without this, nothing ever re-renders the component and `now` freezes.
  const [now, setNow] = useState(() => nowAsSessionTime());
  useEffect(() => {
    const id = setInterval(() => setNow(nowAsSessionTime()), 30_000);
    return () => clearInterval(id);
  }, []);

  const todaysRange = useMemo(() => {
    const todayKey = sessionDateString(now);
    const todaysSessions = sessions.filter((s) => sessionDateString(s.start) === todayKey);
    if (todaysSessions.length === 0) return DEFAULT_RANGE;

    const starts = todaysSessions.map((s) => minutesOfDayIn(s.start));
    const ends = todaysSessions.map((s) => minutesOfDayIn(s.end));
    return { startMinutes: Math.min(...starts), endMinutes: Math.max(...ends) };
  }, [sessions, now]);

  const nowMinutes = minutesOfDayIn(now);
  const clampToRange = (minutes: number) =>
    Math.min(todaysRange.endMinutes, Math.max(todaysRange.startMinutes, minutes));

  // null = actively following "now" (each tick moves scrubMinutes forward);
  // a number = the visitor dragged the scrubber, pinning it to that time
  // until they hit "Now" again. Deriving scrubMinutes instead of syncing it
  // via an effect means the tick above needs no setState of its own.
  const [manualMinutes, setManualMinutes] = useState<number | null>(null);
  const scrubMinutes = manualMinutes ?? clampToRange(nowMinutes);
  const isViewingNow = manualMinutes === null;

  function handleScrub(minutes: number) {
    setManualMinutes(minutes);
  }

  function handleJumpToNow() {
    setManualMinutes(null);
  }

  // The session-Date-convention instant at which the wall clock reads
  // `scrubMinutes` today — today's date comes from the ticking `now`, the
  // time-of-day is overwritten to the scrub position.
  const scrubDate = useMemo(() => {
    return new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      Math.floor(scrubMinutes / 60), scrubMinutes % 60
    ));
  }, [scrubMinutes, now]);

  const viewedTimeLabel = formatSessionTime(scrubDate);

  const dataHotspots = data?.hotspots;
  const dataContextElements = data?.contextElements;

  const renderShapes: RenderShape[] = useMemo(() => {
    if (!dataHotspots) return [];
    return dataHotspots.map((h) => ({
      key: h.id,
      spaceId: h.space_id,
      x: Number(h.x),
      y: Number(h.y),
      width: Number(h.width),
      height: Number(h.height),
      rotation: Number(h.rotation),
      // ?? guard: rows served before migration 019 ran have no preset_key.
      presetKey: h.preset_key ?? "generic-large",
      displayName: h.label ?? h.spaceName,
      groupId: h.group_id,
      laneIndex: h.lane_index,
    }));
  }, [dataHotspots]);

  const renderContext: RenderContextElement[] = useMemo(() => {
    if (!dataContextElements) return [];
    return dataContextElements.map((c) => ({
      key: c.id,
      kind: c.kind,
      x: Number(c.x),
      y: Number(c.y),
      width: Number(c.width),
      height: Number(c.height),
      rotation: Number(c.rotation),
      label: c.label,
    }));
  }, [dataContextElements]);

  // Only spaces actually on the map count — for the status, the summary
  // and the legend alike.
  const floorplanStatus = useMemo(
    () => computeFloorplanStatus(sessions, scrubDate, new Set(renderShapes.map((s) => s.spaceId))),
    [sessions, scrubDate, renderShapes]
  );
  const { statusBySpaceId, liveSessionBySpaceId, nextSessionBySpaceId } = floorplanStatus;

  const spaceNames = useMemo(
    () => new Map(renderShapes.map((s) => [s.spaceId, s.displayName])),
    [renderShapes]
  );

  const summary = useMemo(() => {
    const mappedSpaceIds = new Set(renderShapes.map((s) => s.spaceId));
    let live = 0;
    let soon = 0;
    for (const [spaceId, info] of statusBySpaceId) {
      if (!mappedSpaceIds.has(spaceId)) continue;
      if (info.status === "live") live += 1;
      else soon += 1;
    }
    let nextStart: Date | null = null;
    for (const [spaceId, session] of nextSessionBySpaceId) {
      if (!mappedSpaceIds.has(spaceId)) continue;
      if (!nextStart || session.start < nextStart) nextStart = session.start;
    }
    // Whether anything already ran here today before the viewed time — the
    // difference between "no sessions today" and "no MORE sessions today",
    // which a visitor reading the map in the evening needs to tell apart.
    const today = sessionDateString(scrubDate);
    const hadEarlier = sessions.some(
      (s) =>
        sessionDateString(s.start) === today &&
        s.end <= scrubDate &&
        s.spaceIds.some((id) => mappedSpaceIds.has(id))
    );
    return { live, soon, free: mappedSpaceIds.size - live - soon, nextStart, hadEarlier };
  }, [renderShapes, statusBySpaceId, nextSessionBySpaceId, sessions, scrubDate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground/70 text-sm">
        Loading facility map…
      </div>
    );
  }

  if (isError || !data?.facilityMap) {
    return (
      <div className="p-4 sm:p-6">
        <div className="text-center py-14 px-6 bg-muted border border-dashed border-border rounded-[16px]">
          <svg viewBox="0 0 80 48" className="w-20 h-12 mx-auto mb-3" aria-hidden="true">
            <rect x="2" y="2" width="76" height="44" rx="6" fill="#f4f4f5" stroke="#e4e4e7" strokeWidth="2" />
            <rect x="10" y="10" width="34" height="20" rx="3" fill="#e6f0fa" />
            <rect x="50" y="10" width="20" height="28" rx="3" fill="#f7ecdf" />
            <rect x="10" y="34" width="24" height="6" rx="3" fill="#e9e9ec" />
          </svg>
          <p className="text-sm font-semibold text-muted-foreground">No floor map yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">
            This facility hasn&apos;t published a map of its spaces. Try the grid or list view to
            browse the schedule.
          </p>
        </div>
      </div>
    );
  }

  const { facilityMap, hotspots } = data;
  const selectedHotspot = hotspots.find((h) => h.space_id === selectedSpaceId) ?? null;

  return (
    <div className="p-4 sm:p-6 @container">
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_300px] @4xl:items-start">
        {/* The map card: a heading and one-line summary, the map, the time
            scrub and the colour key, like the pictures on the landing page. */}
        <div className="min-w-0 rounded-[20px] border border-border bg-card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              {isViewingNow ? "Right now" : `At ${viewedTimeLabel}`}
            </h3>
            <p className="text-[13px] text-muted-foreground">
              {summary.live > 0 || summary.soon > 0
                ? [
                    summary.live > 0 && `${summary.live} on`,
                    summary.soon > 0 && `${summary.soon} starting soon`,
                    summary.free > 0 && `${summary.free} with nothing on`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : summary.nextStart
                  ? `Quiet ${isViewingNow ? "right now" : "then"}. Next session at ${formatSessionTime(summary.nextStart)}`
                  : !summary.hadEarlier
                    ? "No sessions here today"
                    : isViewingNow
                      ? "No more sessions today"
                      : `No more sessions after ${viewedTimeLabel}`}
            </p>
          </div>

          <FacilityMapSvg
            className="overflow-hidden rounded-[14px]"
            canvasWidth={Number(facilityMap.canvas_width)}
            canvasHeight={Number(facilityMap.canvas_height)}
            shapes={renderShapes}
            contextElements={renderContext}
            statusBySpaceId={statusBySpaceId}
            selectedSpaceId={selectedSpaceId}
            onSpaceClick={setSelectedSpaceId}
          />

          <TimeControl
            startMinutes={todaysRange.startMinutes}
            endMinutes={todaysRange.endMinutes}
            valueMinutes={scrubMinutes}
            isNow={isViewingNow}
            nowMinutes={nowMinutes}
            onChange={handleScrub}
            onJumpToNow={handleJumpToNow}
          />

          <FloorplanKey />
        </div>

        <FloorplanLegend
          status={floorplanStatus}
          spaceNames={spaceNames}
          viewingNow={isViewingNow}
          viewedTimeLabel={viewedTimeLabel}
          onSpaceClick={setSelectedSpaceId}
        />
      </div>

      {selectedHotspot && (
        <SpaceDetailSheet
          spaceName={selectedHotspot.label ?? selectedHotspot.spaceName}
          spaceCapacity={selectedHotspot.spaceCapacity}
          liveSession={liveSessionBySpaceId.get(selectedHotspot.space_id) ?? null}
          nextSession={nextSessionBySpaceId.get(selectedHotspot.space_id) ?? null}
          viewingNow={isViewingNow}
          viewedTimeLabel={viewedTimeLabel}
          onClose={() => setSelectedSpaceId(null)}
        />
      )}
    </div>
  );
}
