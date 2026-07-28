"use client";

import { useMemo, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { useFacilityMap } from "@/hooks/useFacilityMap";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";
import { formatTime } from "@/lib/utils/dates";
import FacilityMapSvg from "@/components/facility-maps/renderer/FacilityMapSvg";
import type { RenderShape, RenderContextElement, SpaceStatusInfo } from "@/components/facility-maps/renderer/types";
import HotspotPopover from "./HotspotPopover";
import TimeScrubber from "./TimeScrubber";

interface FloorplanViewProps {
  facilityId: string;
  sessions: ExpandedSession[];
}

const DEFAULT_RANGE = { startMinutes: 360, endMinutes: 1320 }; // 6am–10pm fallback

/** A session starting within this many minutes of the viewed time shows as "starting soon". */
const SOON_THRESHOLD_MINUTES = 60;

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Visual, tap-to-see-status alternative to the grid/list/map views — an org
 * builds a from-scratch diagram of the facility from preset-shaped pools/
 * courts (see the Map tab's ShapeCanvas builder), rendered here through the
 * shared illustrated engine (facility-maps/renderer). Recognition-first: a
 * visitor who doesn't know what "Lane 3" means can still find the right
 * spot by sight — water looks like water, courts carry their markings.
 *
 * Every space carries one of three visual states at the viewed time:
 * live (org-accent wash + session name), starting soon (amber wash, within
 * SOON_THRESHOLD_MINUTES), or free (its plain material). Live wins when
 * both would apply.
 *
 * A vertical time scrubber beside the diagram lets a visitor explore any
 * time today, not just right now — the whole map's status recomputes for
 * whatever time is selected, defaulting to the current moment. The
 * scrubbable range spans today's actual earliest-to-latest session time
 * (falling back to a fixed 6am–10pm window if there are no sessions today),
 * since no facility open/close-hours field exists to read instead.
 */
export default function FloorplanView({ facilityId, sessions }: FloorplanViewProps) {
  const { data, isLoading, isError } = useFacilityMap(facilityId);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  const todaysRange = useMemo(() => {
    const now = new Date();
    const todaysSessions = sessions.filter((s) => s.start.toDateString() === now.toDateString());
    if (todaysSessions.length === 0) return DEFAULT_RANGE;

    const starts = todaysSessions.map((s) => minutesOfDay(s.start));
    const ends = todaysSessions.map((s) => minutesOfDay(s.end));
    return { startMinutes: Math.min(...starts), endMinutes: Math.max(...ends) };
  }, [sessions]);

  const nowMinutes = minutesOfDay(new Date());
  const [scrubMinutes, setScrubMinutes] = useState<number>(() =>
    Math.min(todaysRange.endMinutes, Math.max(todaysRange.startMinutes, nowMinutes))
  );

  const isViewingNow = scrubMinutes === nowMinutes;

  const scrubDate = useMemo(() => {
    const d = new Date();
    d.setHours(Math.floor(scrubMinutes / 60), scrubMinutes % 60, 0, 0);
    return d;
  }, [scrubMinutes]);

  const liveSessionBySpaceId = useMemo(() => {
    const map = new Map<string, ExpandedSession>();
    for (const session of sessions) {
      if (!session.spaceId) continue;
      const { isLive } = getSessionLiveStatus(session, scrubDate);
      if (isLive) map.set(session.spaceId, session);
    }
    return map;
  }, [sessions, scrubDate]);

  // live > soon > free per space; "soon" is the next session starting within
  // the threshold of the viewed time, today.
  const statusBySpaceId = useMemo(() => {
    const map = new Map<string, SpaceStatusInfo>();
    for (const [spaceId, session] of liveSessionBySpaceId) {
      map.set(spaceId, {
        status: "live",
        title: session.templateName ?? session.scheduleGroupName,
        timeLabel: `ends ${formatTime(session.end)}`,
      });
    }

    const soonCutoff = new Date(scrubDate.getTime() + SOON_THRESHOLD_MINUTES * 60_000);
    const upcomingBySpaceId = new Map<string, ExpandedSession>();
    for (const session of sessions) {
      if (!session.spaceId || map.has(session.spaceId)) continue;
      if (session.start.toDateString() !== scrubDate.toDateString()) continue;
      if (session.start <= scrubDate || session.start > soonCutoff) continue;
      const earliest = upcomingBySpaceId.get(session.spaceId);
      if (!earliest || session.start < earliest.start) upcomingBySpaceId.set(session.spaceId, session);
    }
    for (const [spaceId, session] of upcomingBySpaceId) {
      map.set(spaceId, {
        status: "soon",
        title: session.templateName ?? session.scheduleGroupName,
        timeLabel: `starts ${formatTime(session.start)}`,
      });
    }
    return map;
  }, [liveSessionBySpaceId, sessions, scrubDate]);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
        Loading facility map…
      </div>
    );
  }

  if (isError || !data?.facilityMap) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-sm font-medium">No facility map available</p>
      </div>
    );
  }

  const { facilityMap, hotspots } = data;
  const selectedHotspot = hotspots.find((h) => h.space_id === selectedSpaceId) ?? null;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex gap-3 items-stretch">
        <FacilityMapSvg
          className="flex-1 self-start rounded-xl overflow-hidden border border-gray-200"
          canvasWidth={Number(facilityMap.canvas_width)}
          canvasHeight={Number(facilityMap.canvas_height)}
          shapes={renderShapes}
          contextElements={renderContext}
          statusBySpaceId={statusBySpaceId}
          selectedSpaceId={selectedSpaceId}
          onSpaceClick={setSelectedSpaceId}
        />

        <TimeScrubber
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
      </div>

      {selectedHotspot && (
        <HotspotPopover
          spaceName={selectedHotspot.label ?? selectedHotspot.spaceName}
          spaceCapacity={selectedHotspot.spaceCapacity}
          liveSession={liveSessionBySpaceId.get(selectedHotspot.space_id) ?? null}
          viewingNow={isViewingNow}
          onClose={() => setSelectedSpaceId(null)}
        />
      )}
    </div>
  );
}
