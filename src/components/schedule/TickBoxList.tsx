"use client";

import { useEffect, type RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface TickBoxItem {
  value: string;
  label: string;
  detail?: string;
}

const RING_STYLE = { "--tw-ring-color": "var(--org-primary, #0066CC)" } as React.CSSProperties;

/**
 * Closes an open tick-box panel on a click outside `root` or on Escape, which
 * also hands focus back to `button`.
 */
export function useDismissable(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        button.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, root, button]);
}

/** What a closed tick-box picker says: "All …", the one choice, or a short list. */
export function summarizeTicks(items: TickBoxItem[], selected: string[], allLabel: string) {
  const picked = items.filter((i) => selected.includes(i.value)).map((i) => i.label);
  if (picked.length === 0) return allLabel;
  if (picked.length <= 2) return picked.join(", ");
  return `${picked.length} selected`;
}

/**
 * The open panel of a visitor-facing multi-select: a tick box per option and,
 * once anything is ticked, a "Clear …" link. Nothing ticked means "all", so
 * the list never carries an "All …" row of its own. Shared by the filter bar's
 * dropdowns and the Schedule picker in the header, so every multi-select a
 * patron meets looks and behaves the same.
 *
 * With `single`, ticking a row replaces the tick instead of adding to it —
 * one at a time, but still untickable back to "all", which is why these stay
 * checkboxes rather than radios (a radio cannot be unticked).
 *
 * Real inputs inside real labels, so each row is keyboard- and
 * screen-reader-operable with no extra roles. Colours are written out rather
 * than taken from tokens — this renders inside someone else's page (see
 * ScheduleFilterBar's `dark`).
 */
export default function TickBoxList({
  label,
  items,
  selected,
  onChange,
  dark,
  id,
  single = false,
  stackDetail = false,
  className,
}: {
  /** Names the group for screen readers and the "Clear …" link. */
  label: string;
  items: TickBoxItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  dark: boolean;
  id?: string;
  /** At most one ticked — see above. */
  single?: boolean;
  /** Each option's `detail` on a line under its name rather than beside it
   *  — for long details ("Building · Department") that would crowd the name. */
  stackDetail?: boolean;
  className?: string;
}) {
  function toggle(value: string) {
    if (single) return onChange(selected.includes(value) ? [] : [value]);
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className={cn(
        "absolute top-full left-0 z-30 mt-1 w-full min-w-[12rem] rounded-xl border p-1.5 text-left shadow-[0_4px_12px_rgba(17,17,19,0.12)]",
        dark ? "bg-gray-800 border-gray-600 text-gray-100" : "bg-white border-[#e4e4e7] text-[#111113]",
        className
      )}
    >
      <div className="max-h-64 overflow-y-auto">
        {items.map((item) => {
          const checked = selected.includes(item.value);
          return (
            <label
              key={item.value}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-normal",
                dark ? "hover:bg-white/5" : "hover:bg-[#f4f4f5]"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(item.value)}
                className="peer sr-only"
              />
              {/* Drawn box so it matches the field in both themes; the
                  real checkbox above is what focus and screen readers use. */}
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
                  checked ? "border-transparent" : dark ? "border-gray-400" : "border-[#86868d]"
                )}
                style={{ ...RING_STYLE, ...(checked ? { backgroundColor: "var(--org-primary, #0066CC)" } : {}) }}
              >
                {checked && <Check className="size-3 text-white" strokeWidth={3} />}
              </span>
              {stackDetail ? (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.detail && (
                    <span className={cn("truncate text-xs", dark ? "text-gray-300" : "text-[#5d5d63]")}>
                      {item.detail}
                    </span>
                  )}
                </span>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {/* Shrinks and truncates, capped at half the row, so it can
                      never squeeze the option's own name to nothing. */}
                  {item.detail && (
                    <span className={cn("min-w-0 max-w-1/2 truncate text-xs", dark ? "text-gray-300" : "text-[#5d5d63]")}>
                      {item.detail}
                    </span>
                  )}
                </>
              )}
            </label>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className={cn("mt-1 border-t px-2.5 pt-1.5 pb-1", dark ? "border-gray-600" : "border-[#efeff1]")}>
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn("text-xs font-medium underline underline-offset-2", dark ? "text-gray-300" : "text-[#5d5d63]")}
          >
            Clear {label.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
