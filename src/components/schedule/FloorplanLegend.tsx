"use client";

import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { formatSessionTime } from "@/lib/utils/dates";
import { minutesLabel, type FloorplanStatus } from "@/lib/floorplan/spaceStatus";
import { MAP_COLORS } from "@/components/facility-maps/renderer/style";

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
 * The panel beside the floorplan: what the colors mean, then what is about
 * to change, what is on, and what is next. Built to be read from across a
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
    <div className="rounded-xl border border-border bg-card p-4 space-y-4 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {viewingNow ? "Right now" : `At ${viewedTimeLabel}`}
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <KeyItem label="In use">
            <span className="w-3.5 h-3.5 rounded" style={{ backgroundColor: "var(--org-accent, #2563eb)", opacity: 0.8 }} />
          </KeyItem>
          <KeyItem label="Starts within 1 hr">
            <span className="w-3.5 h-3.5 rounded" style={{ backgroundColor: MAP_COLORS.soonFill, opacity: 0.6 }} />
          </KeyItem>
          <KeyItem label="Changing soon">
            <span className="w-3.5 h-3.5 rounded border-[3px]" style={{ borderColor: MAP_COLORS.alert }} />
          </KeyItem>
          <KeyItem label="Free">
            <span className="w-3.5 h-3.5 rounded border border-border bg-muted" />
          </KeyItem>
        </ul>
      </div>

      {status.alerts.length > 0 && (
        <Section title="Heads up" tone="alert">
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
                accent={MAP_COLORS.alert}
                headline={headline}
                detail={detail}
                where={names(a.spaceIds)}
                onClick={() => onSpaceClick(a.spaceIds[0])}
              />
            );
          })}
        </Section>
      )}

      <Section title={viewingNow ? "On now" : "On at this time"}>
        {status.live.length === 0 ? (
          <Empty>Nothing running{viewingNow ? " right now" : ""}.</Empty>
        ) : (
          status.live.map(({ session, spaceIds }) => (
            <Row
              key={session.key}
              accent="var(--org-accent, #2563eb)"
              headline={sessionDisplayLabel(session)}
              detail={`Until ${formatSessionTime(session.end)}`}
              where={names(spaceIds)}
              onClick={() => onSpaceClick(spaceIds[0])}
            />
          ))
        )}
      </Section>

      <Section title="Up next">
        {upcoming.length === 0 ? (
          <Empty>Nothing else today.</Empty>
        ) : (
          upcoming.map(({ session, spaceIds }) => (
            <Row
              key={session.key}
              accent={MAP_COLORS.soonStroke}
              headline={sessionDisplayLabel(session)}
              detail={`${formatSessionTime(session.start)} – ${formatSessionTime(session.end)}`}
              where={names(spaceIds)}
              onClick={() => onSpaceClick(spaceIds[0])}
            />
          ))
        )}
        {status.upcoming.length > UPCOMING_LIMIT && (
          <p className="text-xs text-muted-foreground/70 pt-1">
            +{status.upcoming.length - UPCOMING_LIMIT} more later today
          </p>
        )}
      </Section>
    </div>
  );
}

function KeyItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="flex shrink-0" aria-hidden="true">
        {children}
      </span>
      {label}
    </li>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "alert";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-1.5"
        style={tone === "alert" ? { color: MAP_COLORS.alert } : undefined}
      >
        <span className={tone === "alert" ? undefined : "text-muted-foreground"}>{title}</span>
      </h3>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function Row({
  accent,
  headline,
  detail,
  where,
  onClick,
}: {
  accent: string;
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
        className="w-full flex gap-2.5 text-left rounded-lg px-2 py-1.5 -mx-2 hover:bg-muted transition-colors"
      >
        <span className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: accent }} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-medium text-foreground truncate">{headline}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
          {where && <span className="block text-xs text-muted-foreground/80 truncate">{where}</span>}
        </span>
      </button>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="text-xs text-muted-foreground/70">{children}</li>;
}
