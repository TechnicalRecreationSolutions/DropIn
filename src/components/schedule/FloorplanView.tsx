"use client";

import { useMemo, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { useFacilityMap } from "@/hooks/useFacilityMap";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";
import { formatTimeIn, minutesOfDayIn } from "@/lib/utils/dates";
import { zonedDateString, zonedTimeToUtc } from "@/lib/utils/timezone";
import FacilityMapSvg from "@/components/facility-maps/renderer/FacilityMapSvg";
import type { RenderShape, RenderContextElement, SpaceStatusInfo } from "@/components/facility-maps/renderer/types";
import SpaceDetailSheet from "./SpaceDetailSheet";
import TimeControl from "./TimeControl";

interface FloorplanViewProps {
  facilityId: string;
  sessions: ExpandedSession[];
}

const DEFAULT_RANGE = { startMinutes: 360, endMinutes: 1320 }; // 6am–10pm fallback

/** A session starting within this many minutes of the viewed time shows as "starting soon". */
const SOON_THRESHOLD_MINUTES = 60;

// The scrub slider is "time of day at this building", so every position on it
// is resolved in the building's zone via the shared minutesOfDayIn — otherwise
// the track spans the wrong hours and the "now" marker sits in the wrong place
// for any reader elsewhere.

/**
 * Visual, tap-to-see-status alternative to the grid/list/map views — an org
 * builds a from-scratch diagram of the facility from preset-shaped pools/
 * courts (see the Map tab's ShapeCanvas builder), rendered here through the
 * shared illustrated engine (facility-maps/renderer). Recognition-first: a
 * visitor who doesn't know what "Lane 3" means can still find the right
 * spot by sight — water looks like water, courts carry their markings.
 *
 * Layout is a single column — summary strip, full-width map, time control —
 * so the map keeps every pixel of width on phones. Every space carries one
 * of three visual states at the viewed time: live (org-accent wash +
 * session name), starting soon (amber, within SOON_THRESHOLD_MINUTES), or
 * free (its plain material); live wins when both would apply. The summary
 * strip doubles as the color legend. Tapping a space opens
 * SpaceDetailSheet with the live session, cost, and what's next in that
 * spot.
 *
 * The time control previews the map at any time today (defaulting to the
 * current moment), spanning today's actual earliest-to-latest session time
 * — falling back to a fixed 6am–10pm window when there are no sessions
 * today, since no facility open/close-hours field exists to read instead.
 */
export default function FloorplanView({ facilityId, sessions }: FloorplanViewProps) {
  const { data, isLoading, isError } = useFacilityMap(facilityId);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  // Every session on one floorplan is in one building, so the first one's zone
  // is the building's. Falls back to the runtime zone only when there is
  // nothing to render anyway.
  const zone = sessions[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const todaysRange = useMemo(() => {
    const todayKey = zonedDateString(new Date(), zone);
    const todaysSessions = sessions.filter((s) => zonedDateString(s.start, zone) === todayKey);
    if (todaysSessions.length === 0) return DEFAULT_RANGE;

    const starts = todaysSessions.map((s) => minutesOfDayIn(s.start, zone));
    const ends = todaysSessions.map((s) => minutesOfDayIn(s.end, zone));
    return { startMinutes: Math.min(...starts), endMinutes: Math.max(...ends) };
  }, [sessions, zone]);

  const nowMinutes = minutesOfDayIn(new Date(), zone);
  const [scrubMinutes, setScrubMinutes] = useState<number>(() =>
    Math.min(todaysRange.endMinutes, Math.max(todaysRange.startMinutes, nowMinutes))
  );

  const isViewingNow = scrubMinutes === nowMinutes;

  // The instant at which the building's wall clock reads `scrubMinutes` today.
  // Built through the zone rather than with setHours, which would set the
  // reader's wall clock instead and slide every comparison below by the offset
  // between them.
  const scrubDate = useMemo(() => {
    const hh = String(Math.floor(scrubMinutes / 60)).padStart(2, "0");
    const mm = String(scrubMinutes % 60).padStart(2, "0");
    return zonedTimeToUtc(zonedDateString(new Date(), zone), `${hh}:${mm}`, zone);
  }, [scrubMinutes, zone]);

  const viewedTimeLabel = formatTimeIn(scrubDate, zone);

  const liveSessionBySpaceId = useMemo(() => {
    const map = new Map<string, ExpandedSession>();
    for (const session of sessions) {
      if (session.spaceIds.length === 0) continue;
      const { isLive } = getSessionLiveStatus(session, scrubDate);
      if (!isLive) continue;
      for (const spaceId of session.spaceIds) map.set(spaceId, session);
    }
    return map;
  }, [sessions, scrubDate]);

  // Earliest session starting after the viewed time (today) per space — for
  // the detail sheet's "Next up here" and the summary's "next session at".
  const nextSessionBySpaceId = useMemo(() => {
    const map = new Map<string, ExpandedSession>();
    for (const session of sessions) {
      if (session.spaceIds.length === 0) continue;
      if (zonedDateString(session.start, zone) !== zonedDateString(scrubDate, zone)) continue;
      if (session.start <= scrubDate) continue;
      for (const spaceId of session.spaceIds) {
        const earliest = map.get(spaceId);
        if (!earliest || session.start < earliest.start) map.set(spaceId, session);
      }
    }
    return map;
  }, [sessions, scrubDate, zone]);

  // live > soon > free per space; "soon" is the next session starting within
  // the threshold of the viewed time.
  const statusBySpaceId = useMemo(() => {
    const map = new Map<string, SpaceStatusInfo>();
    for (const [spaceId, session] of liveSessionBySpaceId) {
      map.set(spaceId, {
        status: "live",
        title: session.templateName ?? session.scheduleGroupName,
        timeLabel: `ends ${formatTimeIn(session.end, session.timezone)}`,
      });
    }
    const soonCutoff = new Date(scrubDate.getTime() + SOON_THRESHOLD_MINUTES * 60_000);
    for (const [spaceId, session] of nextSessionBySpaceId) {
      if (map.has(spaceId) || session.start > soonCutoff) continue;
      map.set(spaceId, {
        status: "soon",
        title: session.templateName ?? session.scheduleGroupName,
        timeLabel: `starts ${formatTimeIn(session.start, session.timezone)}`,
      });
    }
    return map;
  }, [liveSessionBySpaceId, nextSessionBySpaceId, scrubDate]);

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

  // Summary counts cover only spaces actually on the map.
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
    return { live, soon, free: mappedSpaceIds.size - live - soon, nextStart };
  }, [renderShapes, statusBySpaceId, nextSessionBySpaceId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
        Loading facility map…
      </div>
    );
  }

  if (isError || !data?.facilityMap) {
    return (
      <div className="p-4 sm:p-6">
        <div className="text-center py-14 px-6 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
          <svg viewBox="0 0 80 48" className="w-20 h-12 mx-auto mb-3" aria-hidden="true">
            <rect x="2" y="2" width="76" height="44" rx="6" fill="#F3F1EC" stroke="#D5CFC4" strokeWidth="2" />
            <rect x="10" y="10" width="34" height="20" rx="3" fill="#C6E0EB" />
            <rect x="50" y="10" width="20" height="28" rx="3" fill="#E4C6A8" />
            <rect x="10" y="34" width="24" height="6" rx="3" fill="#E3DED5" />
          </svg>
          <p className="text-sm font-semibold text-gray-600">No floor map yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
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
    <div className="p-4 sm:p-6">
      {/* Summary strip — doubles as the status color legend. */}
      <div className="flex items-center gap-4 flex-wrap mb-3 text-xs font-medium text-gray-600">
        {summary.live > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
            />
            {summary.live} on {isViewingNow ? "now" : `at ${viewedTimeLabel}`}
          </span>
        )}
        {summary.soon > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            {summary.soon} starting soon
          </span>
        )}
        {summary.live === 0 && summary.soon === 0 && (
          <span className="text-gray-400">
            {summary.nextStart
              ? `Quiet ${isViewingNow ? "right now" : `at ${viewedTimeLabel}`} — next session at ${formatTimeIn(summary.nextStart, zone)}`
              : "No sessions here today"}
          </span>
        )}
        {summary.free > 0 && (summary.live > 0 || summary.soon > 0) && (
          <span className="text-gray-400 ml-auto">{summary.free} free</span>
        )}
      </div>

      <FacilityMapSvg
        className="rounded-xl overflow-hidden border border-gray-200"
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
        onChange={setScrubMinutes}
        onJumpToNow={() =>
          setScrubMinutes(Math.min(todaysRange.endMinutes, Math.max(todaysRange.startMinutes, nowMinutes)))
        }
      />

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
