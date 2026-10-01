"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import TickBoxList, { useDismissable } from "./TickBoxList";
import { cn } from "@/lib/utils/cn";
import {
  SCOPE_LEVELS,
  scopeOptions,
  setLevel,
  summarizeLevel,
  ticked,
  type ScopeLevel,
  type ScopeSchedule,
  type ScopeSelection,
} from "@/lib/schedule/scopeSelection";

const LEVEL_LABELS: Record<ScopeLevel, string> = {
  facility: "Facility",
  department: "Department",
  schedule: "Schedule",
};

/**
 * The visitor-facing "which schedule am I looking at" control: Facility /
 * Department / Schedule in the header bar's switcher row. One component for
 * the real widget (ScheduleHeaderBar's `scope`) and the landing hero (passed
 * as `scopeControl`, with its handwritten note in `after`), so the marketing
 * picture cannot drift from what a patron gets. What a pick *means* lives in
 * lib/schedule/scopeSelection.ts, which both build their data from.
 *
 * Each level is a tick-box list like the filter bar's: nothing ticked is
 * "All …". `multi` names the levels the org lets visitors tick several of
 * (widget_configs.multi_select_levels); the others take one at a time, and
 * clicking the ticked one goes back to "All". Changing a level re-fits the
 * ones below it. All three always show, even with one option: together they
 * say where the schedule on screen is, which a label alone cannot when two
 * buildings both have a pool.
 */
export default function ScheduleScopeFilters({
  tree,
  selection,
  onChange,
  multi = [],
  after,
  dark = false,
  className,
}: {
  tree: ScopeSchedule[];
  selection: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
  multi?: ScopeLevel[];
  /** Rendered at the end of the row — the hero's handwritten note. */
  after?: ReactNode;
  /** The widget's dark theme — written out, see ScheduleHeaderBar's `dark`. */
  dark?: boolean;
  className?: string;
}) {
  if (tree.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Choose a schedule"
      // Phones: facility on its own row, department + schedule share the
      // next — every row comes out of the schedule below. Wider, one row that
      // wraps, for an embed in a narrow column.
      className={cn("grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center", className)}
    >
      {SCOPE_LEVELS.map((level) => {
        const options = scopeOptions(tree, selection, level);
        const selected = ticked(selection, level);
        return (
          <TickPicker
            key={level}
            label={LEVEL_LABELS[level]}
            className={level === "facility" ? "col-span-2" : undefined}
            // The right-hand column on phones opens its list leftward, so it
            // stays on screen.
            alignEnd={level === "schedule"}
            single={!multi.includes(level)}
            dark={dark}
            items={options}
            selected={selected}
            value={summarizeLevel(options, selected, level)}
            onChange={(ids) => onChange(setLevel(tree, selection, level, ids))}
          />
        );
      })}
      {after}
    </div>
  );
}

/**
 * A pill-shaped button in the switcher row that opens a TickBoxList beneath
 * it — the filter bar's tick boxes, in the header's shape. `single` closes
 * the panel on a pick, since there is nothing more to choose.
 */
function TickPicker({
  label,
  value,
  items,
  selected,
  onChange,
  single = false,
  alignEnd = false,
  dark,
  className,
}: {
  label: string;
  /** The button's text after "Label:". */
  value: string;
  items: { value: string; label: string; detail?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
  alignEnd?: boolean;
  dark: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  useDismissable(open, () => setOpen(false), rootRef, buttonRef);

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-auto w-full min-w-0 items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-fit sm:max-w-80 sm:min-w-44 sm:text-sm",
          dark
            ? "border-white/15 bg-white/10 text-white hover:bg-white/15"
            : "border-border bg-card text-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "hidden sm:inline",
              dark ? "text-white/60" : "text-muted-foreground",
            )}
          >
            {label}:
          </span>
          <span className="truncate">{value}</span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform",
            dark ? "text-white/75" : "text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <TickBoxList
          single={single}
          label={label}
          items={items}
          selected={selected}
          onChange={(next) => {
            onChange(next);
            if (single) {
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
          dark={dark}
          stackDetail
          // As wide as its longest name allows, never off a phone's screen.
          className={cn(
            "w-max min-w-full max-w-[calc(100vw-2rem)] sm:min-w-56 sm:max-w-88",
            alignEnd && "max-sm:right-0 max-sm:left-auto",
          )}
        />
      )}
    </div>
  );
}
