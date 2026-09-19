import type { ExpandedSession } from "@/types/schedule.types";
import type { SpaceAlert, SpaceStatusInfo } from "@/components/facility-maps/renderer/types";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";
import { formatSessionTime, sessionDateString } from "@/lib/utils/dates";

/**
 * What the floorplan shows at one moment: each space's state, plus the
 * session-level lists the legend panel reads. Pure — FloorplanView calls it
 * with the scrub position, and a harness can call it with a fixed clock.
 *
 * States per space, most urgent first:
 *   live      — a session is running (org-accent wash)
 *   soon      — the next session starts within SOON_MINUTES (amber wash)
 *   free      — neither (absent from the map)
 *
 * On top of the state, an `alert` marks the moments staff and visitors need
 * to notice. It is drawn as an outline + tag, not a new fill, so the map
 * does not turn into a traffic light:
 *   changeover — live session ends within ALERT_MINUTES and another session
 *                starts in the same space within CHANGEOVER_GAP_MINUTES of
 *                that end ("→ Aquafit 7:30")
 *   ending     — live session ends within ALERT_MINUTES, nothing follows
 *   starting   — next session starts within ALERT_MINUTES
 */

/** A session starting within this many minutes of the viewed time shows as "starting soon". */
export const SOON_MINUTES = 60;
/** How close an end or start must be before the space gets an alert. */
export const ALERT_MINUTES = 15;
/** A following session this soon after the live one ends counts as a changeover. */
export const CHANGEOVER_GAP_MINUTES = 15;

const MINUTE = 60_000;

/** One session occurrence and the mapped spaces it occupies. */
export interface SessionOnMap {
  session: ExpandedSession;
  spaceIds: string[];
}

export interface AlertOnMap {
  /** Stable React key — one alert per session occurrence and kind. */
  key: string;
  alert: SpaceAlert;
  session: ExpandedSession;
  /** For a changeover, the session taking over. */
  nextSession: ExpandedSession | null;
  spaceIds: string[];
  /** Minutes from the viewed time to the moment the alert is about. */
  minutesAway: number;
}

export interface FloorplanStatus {
  statusBySpaceId: Map<string, SpaceStatusInfo>;
  liveSessionBySpaceId: Map<string, ExpandedSession>;
  nextSessionBySpaceId: Map<string, ExpandedSession>;
  /** Running now, soonest-ending first. */
  live: SessionOnMap[];
  /** Starting later today, soonest first. */
  upcoming: SessionOnMap[];
  /** Soonest first. */
  alerts: AlertOnMap[];
}

/** "in 6 min" / "now" — minutes rounded up, so a 30-second gap never reads "0 min". */
export function minutesLabel(minutes: number): string {
  return minutes <= 0 ? "now" : `in ${minutes} min`;
}

/** "6m" / "now" — the short-tag form of minutesLabel. */
function shortMinutes(minutes: number): string {
  return minutes <= 0 ? "now" : `${minutes}m`;
}

function minutesUntil(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / MINUTE));
}

export function computeFloorplanStatus(
  sessions: ExpandedSession[],
  at: Date,
  mappedSpaceIds: ReadonlySet<string>
): FloorplanStatus {
  const liveSessionBySpaceId = new Map<string, ExpandedSession>();
  const nextSessionBySpaceId = new Map<string, ExpandedSession>();
  const liveByKey = new Map<string, SessionOnMap>();
  const upcomingByKey = new Map<string, SessionOnMap>();
  const today = sessionDateString(at);

  for (const session of sessions) {
    const spaceIds = session.spaceIds.filter((id) => mappedSpaceIds.has(id));
    if (spaceIds.length === 0) continue;

    if (getSessionLiveStatus(session, at).isLive) {
      for (const id of spaceIds) liveSessionBySpaceId.set(id, session);
      liveByKey.set(session.key, { session, spaceIds });
      continue;
    }

    if (sessionDateString(session.start) !== today || session.start <= at) continue;
    upcomingByKey.set(session.key, { session, spaceIds });
    for (const id of spaceIds) {
      const earliest = nextSessionBySpaceId.get(id);
      if (!earliest || session.start < earliest.start) nextSessionBySpaceId.set(id, session);
    }
  }

  const statusBySpaceId = new Map<string, SpaceStatusInfo>();
  const alertsByKey = new Map<string, AlertOnMap>();

  function addAlert(
    kind: SpaceAlert["kind"],
    session: ExpandedSession,
    nextSession: ExpandedSession | null,
    spaceId: string,
    minutesAway: number,
    alert: SpaceAlert
  ) {
    // One entry per session (and, for a changeover, per following session):
    // a lesson across six lanes is one thing ending, not six.
    const key = `${kind}:${session.key}:${nextSession?.key ?? ""}`;
    const existing = alertsByKey.get(key);
    if (existing) existing.spaceIds.push(spaceId);
    else alertsByKey.set(key, { key, alert, session, nextSession, spaceIds: [spaceId], minutesAway });
  }

  for (const [spaceId, session] of liveSessionBySpaceId) {
    const info: SpaceStatusInfo = {
      status: "live",
      title: sessionDisplayLabel(session),
      timeLabel: `ends ${formatSessionTime(session.end)}`,
    };

    const endsIn = minutesUntil(at, session.end);
    if (endsIn <= ALERT_MINUTES) {
      const next = nextSessionBySpaceId.get(spaceId) ?? null;
      const handsOver =
        next !== null && next.start.getTime() - session.end.getTime() <= CHANGEOVER_GAP_MINUTES * MINUTE;
      info.alert = handsOver
        ? {
            kind: "changeover",
            tag: `→ ${sessionDisplayLabel(next)} ${formatSessionTime(next.start)}`,
            shortTag: `→ ${formatSessionTime(next.start)}`,
          }
        : { kind: "ending", tag: `Ends ${minutesLabel(endsIn)}`, shortTag: `Ends ${shortMinutes(endsIn)}` };
      addAlert(info.alert.kind, session, handsOver ? next : null, spaceId, endsIn, info.alert);
    }
    statusBySpaceId.set(spaceId, info);
  }

  const soonCutoff = at.getTime() + SOON_MINUTES * MINUTE;
  for (const [spaceId, session] of nextSessionBySpaceId) {
    if (statusBySpaceId.has(spaceId) || session.start.getTime() > soonCutoff) continue;
    const info: SpaceStatusInfo = {
      status: "soon",
      title: sessionDisplayLabel(session),
      timeLabel: `starts ${formatSessionTime(session.start)}`,
    };
    const startsIn = minutesUntil(at, session.start);
    if (startsIn <= ALERT_MINUTES) {
      info.alert = {
        kind: "starting",
        tag: `Starts ${minutesLabel(startsIn)}`,
        shortTag: `Starts ${shortMinutes(startsIn)}`,
      };
      addAlert("starting", session, null, spaceId, startsIn, info.alert);
    }
    statusBySpaceId.set(spaceId, info);
  }

  return {
    statusBySpaceId,
    liveSessionBySpaceId,
    nextSessionBySpaceId,
    live: [...liveByKey.values()].sort((a, b) => a.session.end.getTime() - b.session.end.getTime()),
    upcoming: [...upcomingByKey.values()].sort(
      (a, b) => a.session.start.getTime() - b.session.start.getTime()
    ),
    alerts: [...alertsByKey.values()].sort((a, b) => a.minutesAway - b.minutesAway),
  };
}
