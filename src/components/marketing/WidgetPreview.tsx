"use client";

import { useState } from "react";
import {
  LayoutGrid,
  List,
  Columns3,
  Table2,
  Image as ImageIcon,
  Waves,
  CircleDot,
  Dumbbell,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

type View = "grid" | "list" | "map" | "board" | "floorplan";

/** Mirrors ScheduleHeaderBar's OPTIONS — same values, order and icons as the real widget toggle. */
const VIEWS: { value: View; label: string; icon: typeof LayoutGrid; caption: string }[] = [
  {
    value: "grid",
    label: "Grid",
    icon: LayoutGrid,
    caption: "The whole week laid out like a calendar — the default most centres start with.",
  },
  {
    value: "list",
    label: "List",
    icon: List,
    caption: "A simple agenda. Easiest to scan on a phone.",
  },
  {
    value: "map",
    label: "Map",
    icon: Columns3,
    caption: "By room or lane, hour by hour — see what's booked where on a given day.",
  },
  {
    value: "board",
    label: "Board",
    icon: Table2,
    caption: "Grouped by department — Pool, Arena and Gym side by side.",
  },
  {
    value: "floorplan",
    label: "Floorplan",
    icon: ImageIcon,
    caption: "An illustrated diagram of your facility. Tap a space to see what's on right now.",
  },
];

const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const gridSessions: Record<string, { name: string; icon: typeof Waves }[]> = {
  Mon: [{ name: "Lane Swim", icon: Waves }],
  Tue: [{ name: "Aqua Fit", icon: Waves }, { name: "Skate", icon: CircleDot }],
  Wed: [{ name: "Lane Swim", icon: Waves }],
  Thu: [{ name: "Basketball", icon: Dumbbell }],
  Fri: [{ name: "Skate", icon: CircleDot }, { name: "Aqua Fit", icon: Waves }],
};

const listSessions = [
  { day: "Today", time: "6:00 AM", name: "Lane Swim", icon: Waves },
  { day: "Today", time: "4:00 PM", name: "Public Skate", icon: CircleDot },
  { day: "Tomorrow", time: "9:30 AM", name: "Aqua Fit", icon: Waves },
  { day: "Tomorrow", time: "6:30 PM", name: "Youth Basketball", icon: Dumbbell },
];

const boardColumns = [
  { name: "Pool", icon: Waves, items: ["Lane Swim — 6:00 AM", "Aqua Fit — 9:30 AM"] },
  { name: "Arena", icon: CircleDot, items: ["Public Skate — 4:00 PM"] },
  { name: "Gym", icon: Dumbbell, items: ["Youth Basketball — 6:30 PM"] },
];

/** One column per space, blocks positioned by rough time-of-day offset — same idea as WeeklyScheduleMap. */
const mapColumns = [
  { name: "Lane 1", blocks: [{ label: "Lane Swim", top: 8, height: 26 }] },
  { name: "Lane 2", blocks: [{ label: "Aqua Fit", top: 40, height: 22 }] },
  { name: "Court A", blocks: [{ label: "Skate", top: 20, height: 30 }] },
];

const floorplanSpaces = [
  { name: "Pool", top: "14%", left: "8%", width: "40%", height: "45%", live: true },
  { name: "Court A", top: "14%", left: "56%", width: "36%", height: "30%", live: true },
  { name: "Room B", top: "62%", left: "56%", width: "36%", height: "28%", live: false },
];

/**
 * Interactive mock of the embeddable schedule widget, mirroring the real
 * widget's header bar + view toggle (see ScheduleHeaderBar) so it reads as an
 * accurate preview rather than a generic illustration. No live data — just
 * enough of each of the five templates to show what a visitor actually sees,
 * and let a prospective customer click through them.
 */
export default function WidgetPreview() {
  const [view, setView] = useState<View>("grid");
  const active = VIEWS.find((v) => v.value === view)!;

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-center text-sm text-muted-foreground mb-4 h-10 flex items-center justify-center">
        {active.caption}
      </p>

      {/* Browser chrome to sell "this lives on your own site" */}
      <div className="rounded-t-xl bg-muted border border-border border-b-0 px-4 py-2.5 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 bg-card rounded-md border border-border px-3 py-1 text-xs text-muted-foreground/70">
          yourcentre.ca/schedule
        </div>
      </div>

      <div className="border border-border rounded-b-xl bg-card p-4 sm:p-6 shadow-lg">
        {/* The widget itself */}
        <div className="rounded-xl overflow-hidden border border-border">
          <div className="bg-blue-600 px-3 sm:px-4 py-3 flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
            <h3 className="text-white font-semibold text-sm">Drop-in Schedule</h3>
            <div className="inline-flex gap-0.5 rounded-full p-0.5 bg-white/20">
              {VIEWS.map((option) => {
                const Icon = option.icon;
                const isActive = view === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setView(option.value)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      isActive ? "bg-card text-blue-700 dark:text-blue-300" : "text-white/90 hover:text-white"
                    )}
                    aria-pressed={isActive}
                    aria-label={option.label}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 sm:p-4 bg-muted min-h-[220px]">
            {view === "grid" && (
              <div className="grid grid-cols-5 gap-1.5">
                {days.map((day) => (
                  <div key={day} className="min-w-0">
                    <p className="text-[11px] font-semibold text-muted-foreground text-center mb-1.5">
                      {day}
                    </p>
                    <div className="space-y-1">
                      {gridSessions[day].map((s) => (
                        <div
                          key={s.name}
                          className="bg-card border border-border rounded-md px-1 py-1.5 text-center"
                        >
                          <s.icon className="w-3 h-3 text-blue-600 dark:text-blue-400 mx-auto mb-0.5" />
                          <p className="text-[9px] leading-tight text-foreground truncate">
                            {s.name}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {view === "list" && (
              <div className="space-y-2">
                {listSessions.map((row, i) => (
                  <div key={i}>
                    {(i === 0 || listSessions[i - 1].day !== row.day) && (
                      <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1.5 mt-1 first:mt-0">
                        {row.day}
                      </p>
                    )}
                    <div className="flex items-center gap-3 bg-card rounded-lg border border-border px-3 py-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                        <row.icon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <p className="text-sm font-medium text-foreground flex-1 truncate">
                        {row.name}
                      </p>
                      <span className="text-xs text-muted-foreground shrink-0">{row.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {view === "map" && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-2">
                  Today
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {mapColumns.map((col) => (
                    <div key={col.name}>
                      <p className="text-[11px] font-medium text-muted-foreground text-center mb-1">
                        {col.name}
                      </p>
                      <div className="relative bg-card border border-border rounded-md h-24">
                        {col.blocks.map((b) => (
                          <div
                            key={b.label}
                            style={{ top: `${b.top}%`, height: `${b.height}%` }}
                            className="absolute inset-x-1 rounded bg-blue-100 border border-blue-200 px-1 py-0.5"
                          >
                            <p className="text-[8px] leading-tight text-blue-800 dark:text-blue-300 truncate">
                              {b.label}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {view === "board" && (
              <div className="grid grid-cols-3 gap-2">
                {boardColumns.map((col) => (
                  <div key={col.name} className="bg-card rounded-lg border border-border p-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <col.icon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <p className="text-xs font-semibold text-foreground">{col.name}</p>
                    </div>
                    <div className="space-y-1">
                      {col.items.map((item) => (
                        <div
                          key={item}
                          className="text-[10px] leading-tight text-muted-foreground bg-muted rounded px-1.5 py-1"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {view === "floorplan" && (
              <div>
                <div className="relative bg-card border border-border rounded-md h-48 overflow-hidden">
                  {floorplanSpaces.map((s) => (
                    <div
                      key={s.name}
                      style={{ top: s.top, left: s.left, width: s.width, height: s.height }}
                      className={cn(
                        "absolute rounded-lg border flex flex-col items-center justify-center gap-1",
                        s.live
                          ? "bg-blue-50 border-blue-200"
                          : "bg-muted border-border"
                      )}
                    >
                      {s.live && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                      <p
                        className={cn(
                          "text-[10px] font-medium",
                          s.live ? "text-blue-800 dark:text-blue-300" : "text-muted-foreground/70"
                        )}
                      >
                        {s.name}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Live now
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted" /> Nothing scheduled
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
