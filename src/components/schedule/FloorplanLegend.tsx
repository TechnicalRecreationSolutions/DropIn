"use client";

import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { formatSessionTime } from "@/lib/utils/dates";
import { minutesLabel, type FloorplanStatus } from "@/lib/floorplan/spaceStatus";
import { MAP_COLORS, SURFACES } from "@/components/facility-maps/renderer/style";
import { cn } from "@/lib/utils/cn";

interface FloorplanLegendProps {
  status: FloorplanStatus;
  /** Space id → the name shown on the map (label override ?? space name). */
  spaceNames: ReadonlyMap<string, string>;
  viewingNow: boolean;
  viewedTimeLabel: string;
  onSpaceClick: (spaceId: string) => void;
}

/** Rows shown under "Up next" — enough to plan around without becoming the grid view. */
const UPCOMING_LIMIT = 5;

/**
 * The panel beside the floorplan: what is about to change, what is on, and
 * what is next, as white cards on a grey panel like the template rail. The
 * colour key lives under the map itself (FloorplanKey). Built to be read from across a
 * lobby as much as tapped on a phone, so every row is one session (a lesson
 * over six lanes is one row, not six) and the most time-sensitive section,
 * "Heads up", comes first.
 *
 * Everything is relative to the viewed time, so scrubbing the time control
 * re-plays the panel for that moment the same way it re-plays the map.
 */
export default function FloorplanLegend({
  status,
  spaceNames,
  viewingNow,
  viewedTimeLabel,
  onSpaceClick,
}: FloorplanLegendProps) {
  const names = (ids: string[]) => {
    const list = ids.map((id) => spaceNames.get(id) ?? "").filter(Boolean);
    return list.length <= 3 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2} more`;
  };
  const upcoming = status.upcoming.slice(0, UPCOMING_LIMIT);

  return (
    <div className="space-y-5 rounded-[20px] bg-muted p-4 text-sm">
      {status.alerts.length > 0 && (
        <Section title="Heads up" tone="alert" count={status.alerts.length}>
          {status.alerts.map((a) => {
            const title = sessionDisplayLabel(a.session);
            let headline: string;
            let detail: string;
            if (a.alert.kind === "changeover" && a.nextSession) {
              headline = `${title} → ${sessionDisplayLabel(a.nextSession)}`;
              detail = `Changeover ${minutesLabel(a.minutesAway)} · ${formatSessionTime(a.nextSession.start)}`;
            } else if (a.alert.kind === "ending") {
              headline = title;
              detail = `Ends ${minutesLabel(a.minutesAway)} · ${formatSessionTime(a.session.end)}`;
            } else {
              headline = title;
              detail = `Starts ${minutesLabel(a.minutesAway)} · ${formatSessionTime(a.session.start)}`;
            }
            return (
              <Row
                key={a.key}
                state="alert"
                headline={headline}
                detail={detail}
                where={names(a.spaceIds)}
                onClick={() => onSpaceClick(a.spaceIds[0])}
              />
            );
          })}
        </Section>
      )}

      <Section title={viewingNow ? "On now" : `On at ${viewedTimeLabel}`} count={status.live.length}>
        {status.live.length === 0 ? (
          <Empty>Nothing running{viewingNow ? " right now" : ""}.</Empty>
        ) : (
          status.live.map(({ session, spaceIds }) => (
            <Row
              key={session.key}
              state="live"
              headline={sessionDisplayLabel(session)}
              detail={`Until ${formatSessionTime(session.end)}`}
              where={names(spaceIds)}
              onClick={() => onSpaceClick(spaceIds[0])}
            />
          ))
        )}
      </Section>

      <Section title="Up next" count={status.upcoming.length}>
        {upcoming.length === 0 ? (
          <Empty>Nothing else today.</Empty>
        ) : (
          upcoming.map(({ session, spaceIds }) => (
            <Row
              key={session.key}
              state="soon"
              headline={sessionDisplayLabel(session)}
              detail={`${formatSessionTime(session.start)} – ${formatSessionTime(session.end)}`}
              where={names(spaceIds)}
              onClick={() => onSpaceClick(spaceIds[0])}
            />
          ))
        )}
        {status.upcoming.length > UPCOMING_LIMIT && (
          <p className="text-xs text-muted-foreground px-1 pt-1">
            +{status.upcoming.length - UPCOMING_LIMIT} more later today
          </p>
        )}
      </Section>
    </div>
  );
}

export type MapState = "live" | "soon" | "alert" | "none";

/** A small square drawn the way the map draws that state. */
export function StateSwatch({ state, className }: { state: MapState; className?: string }) {
  const style: React.CSSProperties =
    state === "live"
      ? { backgroundColor: SURFACES.live.fill, border: `2px solid ${SURFACES.live.edge}` }
      : state === "soon"
        ? { backgroundColor: SURFACES.soon.fill, border: `1.5px dashed ${SURFACES.soon.edge}` }
        : state === "alert"
          ? { backgroundColor: "#ffffff", border: `2.5px solid ${MAP_COLORS.alert}` }
          : { backgroundColor: "#ffffff", border: "1.5px solid #e4e4e7" };
  return <span aria-hidden="true" className={cn("size-3.5 shrink-0 rounded-[4px]", className)} style={style} />;
}

/** The colour key, in a row under the map, like the legend under the landing page's pictures. */
export function FloorplanKey() {
  const items: { state: MapState; label: string }[] = [
    { state: "live", label: "On now" },
    { state: "soon", label: "Starts within an hour" },
    { state: "alert", label: "Changing in a few minutes" },
    { state: "none", label: "Nothing on" },
  ];
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.state} className="flex items-center gap-2">
          <StateSwatch state={item.state} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone?: "alert";
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-1.5 px-1 text-[13px] font-semibold">
        <span style={tone === "alert" ? { color: MAP_COLORS.alert } : undefined} className={tone === "alert" ? undefined : "text-foreground"}>
          {title}
        </span>
        {!!count && <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>}
      </h3>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}

function Row({
  state,
  headline,
  detail,
  where,
  onClick,
}: {
  state: MapState;
  headline: string;
  detail: string;
  where: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full gap-2.5 rounded-[12px] border border-transparent bg-card px-3 py-2.5 text-left transition-colors hover:border-border"
      >
        <StateSwatch state={state} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-foreground">{headline}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">{detail}</span>
          {where && <span className="block truncate text-xs text-muted-foreground">{where}</span>}
        </span>
      </button>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-1 text-[13px] text-muted-foreground">{children}</li>;
}
