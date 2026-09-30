"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play, SlidersHorizontal } from "lucide-react";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import ScheduleView from "@/components/schedule/ScheduleView";
import FloorplanView from "@/components/schedule/FloorplanView";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import ScheduleFilterBar from "@/components/schedule/ScheduleFilterBar";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import { SessionTrackingContext } from "@/components/schedule/SessionModal";
import {
  EMPTY_FILTER_STATE,
  activeFilterCount,
  filterSessions,
  type SessionFilterKey,
  type SessionFilterState,
} from "@/lib/schedule/sessionFilters";
import { cn } from "@/lib/utils/cn";
import type { ScheduleTemplate } from "@/types/schedule.types";
import { Hand } from "./ui";
import { DEMO_SCOPES, demoSessionsForWeek } from "./heroWidgetSample";

const VIEWS: ScheduleTemplate[] = ["grid", "list", "map", "board", "floorplan"];
const VIEW_LABELS: Record<ScheduleTemplate, string> = {
  grid: "Grid",
  list: "List",
  map: "Map",
  board: "Board",
  floorplan: "Floorplan",
};
const FILTERS: SessionFilterKey[] = ["search", "activity", "day", "time"];

/** How long each view stays up before the next one. */
const DWELL_MS = 6000;

const MAP_CAPTIONS: Record<string, string> = {
  pool: "one column per lane",
  gym: "one column per court",
  "sport-court": "one column per court",
  arena: "one column per sheet of ice",
  field: "one column per field",
  racquets: "one column per court",
  studios: "one column per room",
};

/** The handwritten note beside the widget, one per view. */
function captionFor(view: ScheduleTemplate, scopeId: string): string {
  switch (view) {
    case "grid":
      return "the whole week at a glance";
    case "list":
      return "starts at today";
    case "map":
      return MAP_CAPTIONS[scopeId] ?? "one column per space";
    case "board":
      return "reads like the printed schedule";
    case "floorplan":
      return "tap a space to see what's on";
  }
}

/**
 * The hero's product picture: the real public widget, running on a sample
 * week (see heroWidgetSample.ts).
 *
 * It is assembled the way WidgetScheduleClient assembles the embed — header
 * bar with the schedule switcher and view toggle, filter bar, then the view —
 * from the same components, so the landing page cannot drift from what a
 * patron sees. What differs: the data comes from the sample instead of
 * /api/sessions/expand, session clicks are not counted (SessionTrackingContext),
 * the floorplan is handed its map instead of fetching one, and there is no
 * print button (it would print this page).
 *
 * It cycles through the five views on its own, then moves to the next space in
 * the switcher and goes round again — with seven spaces the switcher is a
 * dropdown (ScheduleScopeSwitcher), so the tour is what shows the range. It
 * keeps going until the visitor does anything
 * with it — a click, a key, a drag of the floorplan's time slider — and then
 * stops for good, so a view is never pulled away from someone reading it. It
 * pauses while hovered or off-screen, never starts for a visitor who prefers
 * reduced motion, and has its own play/pause button (WCAG 2.2.2).
 *
 * The card has a fixed height and the schedule scrolls inside it: the views
 * are very different heights, and a hero that changed height every six
 * seconds would move the whole page under the reader.
 */
export default function LiveWidgetDemo({
  heightClass,
}: {
  heightClass: string;
}) {
  const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
  const [view, setView] = useState<ScheduleTemplate>("grid");
  const [scopeId, setScopeId] = useState(DEMO_SCOPES[0].id);
  const [filters, setFilters] =
    useState<SessionFilterState>(EMPTY_FILTER_STATE);
  // Phones only: the filters stack one per row there, and in a card of fixed
  // height four of them left the schedule a sliver. From sm up they are one
  // row and always shown.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = activeFilterCount(filters);

  const scope = DEMO_SCOPES.find((s) => s.id === scopeId) ?? DEMO_SCOPES[0];
  const allSessions = useMemo(
    () => demoSessionsForWeek(scope.id, weekStart),
    [scope.id, weekStart],
  );
  const visibleSessions = useMemo(
    () => filterSessions(allSessions, filters),
    [allSessions, filters],
  );

  // Filters are named after one schedule's activities and spaces; carried to
  // another schedule they would match nothing and read as an empty week.
  function changeScope(id: string) {
    setScopeId(id);
    setFilters(EMPTY_FILTER_STATE);
  }

  // ── Rotation ────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Read at first render, which is safe only because HeroWidget never
  // prerenders this component — there is no server pass without a window.
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hovering, setHovering] = useState(false);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      {
        threshold: 0.35,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The progress bar under the widget is the clock: the next view comes when
  // its fill animation ends, so pausing it (hover, off-screen) pauses the tour
  // at exactly the point the bar shows, and resuming does not restart the wait.
  const advancing = playing && !hovering && onScreen;
  const advance = () => {
    const next = (VIEWS.indexOf(view) + 1) % VIEWS.length;
    if (next === 0) {
      const i = DEMO_SCOPES.findIndex((s) => s.id === scope.id);
      changeScope(DEMO_SCOPES[(i + 1) % DEMO_SCOPES.length].id);
    }
    setView(VIEWS[next]);
  };

  // Each view starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view, scope.id]);

  // Anything the visitor does inside the widget ends the tour. `click` rather
  // than `pointerdown`, so a thumb scrolling the page past it on a phone does
  // not count as using it; `input` catches the floorplan's time slider.
  const stop = () => setPlaying(false);

  return (
    <div ref={rootRef} className="relative">
      <Hand
        key={`${view}-${scope.id}`}
        className="absolute -top-12 right-6 hidden -rotate-[3deg] text-[26px] animate-in fade-in duration-500 lg:block"
      >
        {captionFor(view, scope.id)} ↓
      </Hand>

      {/* The space picker is a dropdown at seven spaces, which is easy to read
          as a title. This note says what it does: beside it where there is
          room (lg+), above the card otherwise, where the view note gives way. */}
      <Hand
        tone="teal"
        className="absolute -top-10 left-3 -rotate-2 text-[22px] sm:-top-12 sm:left-4 sm:text-[26px] lg:hidden"
      >
        works for every department and space ↓
      </Hand>

      <SessionTrackingContext.Provider value={false}>
        <OrgThemeProvider primaryColor="#0066CC">
          <div
            onClickCapture={stop}
            onKeyDownCapture={stop}
            onInputCapture={stop}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            className={cn(
              "relative flex flex-col rounded-[20px] border border-[#e4e4e7] bg-white text-left text-gray-900 shadow-[0_1px_2px_rgba(17,17,19,0.05),0_12px_32px_-12px_rgba(17,17,19,0.12)]",
              heightClass,
            )}
          >
            <Hand
              tone="teal"
              className="pointer-events-none absolute top-[64px] left-[262px] z-10 hidden -rotate-2 text-[26px] lg:block"
            >
              ← works for every department and space
            </Hand>
            <ScheduleHeaderBar
              title="Drop-in schedule"
              view={view}
              onChange={setView}
              allowedViews={VIEWS}
              scopeOptions={DEMO_SCOPES.map((s) => ({
                id: s.id,
                label: s.label,
                context: s.context,
              }))}
              activeScopeId={scope.id}
              onScopeChange={changeScope}
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5 text-[13px] font-medium text-gray-700 sm:hidden"
            >
              <SlidersHorizontal aria-hidden className="size-4 text-gray-500" />
              Filters{filterCount > 0 ? ` · ${filterCount}` : ""}
              <ChevronDown
                aria-hidden
                className={cn(
                  "ml-auto size-4 text-gray-500 transition-transform",
                  filtersOpen && "rotate-180",
                )}
              />
            </button>
            <div className={cn(!filtersOpen && "hidden", "sm:block")}>
              <ScheduleFilterBar
                sessions={allSessions}
                matchCount={visibleSessions.length}
                enabled={FILTERS}
                state={filters}
                onChange={setFilters}
                weekStart={weekStart}
                onWeekChange={setWeekStart}
              />
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4"
              role="region"
              aria-label={`Sample schedule, ${VIEW_LABELS[view]} view`}
            >
              {visibleSessions.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">
                  <p>No sessions match your filters this week.</p>
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTER_STATE)}
                    className="mt-2 text-xs font-medium underline underline-offset-2"
                    style={{ color: "var(--org-primary, #0066CC)" }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : view === "floorplan" ? (
                <FloorplanView
                  key={scope.id}
                  facilityId={scope.facilityId}
                  sessions={visibleSessions}
                  map={scope.map}
                />
              ) : (
                <ScheduleView
                  template={view}
                  sessions={visibleSessions}
                  weekStart={weekStart}
                  onWeekChange={setWeekStart}
                  month={month}
                  onMonthChange={setMonth}
                />
              )}
            </div>
          </div>
        </OrgThemeProvider>
      </SessionTrackingContext.Provider>

      {/* The tour's own controls: where it is, and a way to stop or restart it. */}
      <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-[#5d5d63]">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="inline-flex size-8 items-center justify-center rounded-full border border-[#e4e4e7] bg-white text-[#111113] transition-colors hover:bg-[#f4f4f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc]"
          aria-label={
            playing
              ? "Stop cycling through the views"
              : "Cycle through the views"
          }
        >
          {playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5 translate-x-px" />
          )}
        </button>
        <ol className="flex items-center gap-1.5" aria-label="Views">
          {VIEWS.map((v) => {
            const active = v === view;
            return (
              <li key={v}>
                <button
                  type="button"
                  onClick={() => {
                    setView(v);
                    setPlaying(false);
                  }}
                  aria-current={active ? "true" : undefined}
                  aria-label={`${VIEW_LABELS[v]} view`}
                  className="relative block h-1.5 w-7 overflow-hidden rounded-full bg-[#e4e4e7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc]"
                >
                  {active && (
                    <span
                      // Restarts with each view; frozen while the tour is paused.
                      key={`${v}-${scope.id}`}
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full bg-[#0066cc]",
                        playing ? "hero-dwell" : "w-full",
                      )}
                      onAnimationEnd={advance}
                      style={
                        playing
                          ? {
                              animationDuration: `${DWELL_MS}ms`,
                              animationPlayState: advancing
                                ? "running"
                                : "paused",
                            }
                          : undefined
                      }
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <span className="hidden sm:inline">
          Sample schedule ·{" "}
          {playing ? "click anything to explore" : "it's live, try it"}
        </span>
      </div>
    </div>
  );
}
