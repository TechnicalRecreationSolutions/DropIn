"use client";

import { useEffect, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface TickBoxItem {
  value: string;
  label: string;
  detail?: string;
}

/**
 * Where a tick-box list is drawn, which decides where its colours come from.
 *
 * - `widget` / `widget-dark`: the public widget. Colours are written out —
 *   this renders inside an iframe on someone else's page, where the
 *   dashboard's tokens and `.dark` class do not exist — and ticks and focus
 *   rings take the centre's brand colour (`--org-primary`).
 * - `app`: the dashboard. Tokens only, so dark mode works and Dropin's own
 *   palette is used (docs/DESIGN.md §3).
 *
 * Neither side's palette may leak into the other, which is why this is a
 * closed set rather than a class-name escape hatch.
 */
export type TickBoxTheme = "widget" | "widget-dark" | "app";

/**
 * - `multi`: tick as many as you like; nothing ticked means "all".
 * - `single`: one at a time, but the ticked row can be unticked back to "all"
 *   — which is why these stay checkboxes (a radio cannot be unticked).
 * - `radio`: exactly one, always. Real radios (drawn as the same tick box);
 *   picking the ticked row does nothing, and there is no "Clear" link. For a
 *   choice with no "all" meaning, such as the dashboard's building switcher.
 */
export type TickBoxMode = "multi" | "single" | "radio";

const RING_STYLE = { "--tw-ring-color": "var(--org-primary, #0066CC)" } as React.CSSProperties;

/**
 * The colour half of every class string below, per theme. The widget values
 * are exactly what this file wrote out before the app theme existed — the
 * widget's markup must not change (scripts/verify/verify-bl.mjs compares it).
 */
function listTheme(theme: TickBoxTheme) {
  if (theme === "app") {
    return {
      panel: "bg-card border-border text-foreground shadow-md",
      row: "hover:bg-muted",
      rowChecked: undefined,
      boxOff: "border-input",
      boxOn: "border-transparent bg-brand",
      boxRing: "peer-focus-visible:ring-ring peer-focus-visible:ring-offset-card",
      tick: "text-brand-foreground",
      detail: "text-muted-foreground",
      detailChecked: undefined,
      divider: "border-border",
      branded: false,
    };
  }
  const dark = theme === "widget-dark";
  return {
    panel: dark ? "bg-gray-800 border-gray-600 text-gray-100" : "bg-white border-[#e4e4e7] text-[#111113]",
    row: dark ? "hover:bg-white/5" : "hover:bg-[#f4f4f5]",
    rowChecked: undefined,
    boxOff: dark ? "border-gray-400" : "border-[#86868d]",
    boxOn: "border-transparent",
    boxRing: undefined,
    tick: "text-white",
    detail: dark ? "text-gray-300" : "text-[#5d5d63]",
    detailChecked: undefined,
    divider: dark ? "border-gray-600" : "border-[#efeff1]",
    branded: true,
  };
}

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
 * The open panel of a tick-box picker: a tick box per option and, once
 * anything is ticked, a "Clear …" link. Nothing ticked means "all", so the
 * list never carries an "All …" row of its own (except in `radio` mode, where
 * a caller that has an "all" offers it as an ordinary option). Shared by the
 * widget's filter bar and Schedule picker and by the dashboard's building
 * switcher and department filter, so every picker in the product looks and
 * behaves the same.
 *
 * Real inputs inside real labels, so each row is keyboard- and
 * screen-reader-operable with no extra roles.
 */
export default function TickBoxList({
  label,
  items,
  selected,
  onChange,
  dark = false,
  theme: themeProp,
  id,
  single = false,
  mode: modeProp,
  stackDetail = false,
  footer,
  className,
}: {
  /** Names the group for screen readers and the "Clear …" link. */
  label: string;
  items: TickBoxItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** The widget's dark theme. Shorthand for `theme="widget-dark"`. */
  dark?: boolean;
  /** Overrides `dark`; see TickBoxTheme. */
  theme?: TickBoxTheme;
  id?: string;
  /** Shorthand for `mode="single"`. */
  single?: boolean;
  mode?: TickBoxMode;
  /** Each option's `detail` on a line under its name rather than beside it
   *  — for long details ("Building · Department") that would crowd the name. */
  stackDetail?: boolean;
  /** A muted line under the options — for saying what the choice does here. */
  footer?: ReactNode;
  className?: string;
}) {
  const theme = themeProp ?? (dark ? "widget-dark" : "widget");
  const mode = modeProp ?? (single ? "single" : "multi");
  const t = listTheme(theme);
  const radio = mode === "radio";

  function toggle(value: string) {
    if (radio) return selected.includes(value) ? undefined : onChange([value]);
    if (mode === "single") return onChange(selected.includes(value) ? [] : [value]);
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div
      id={id}
      role={radio ? "radiogroup" : "group"}
      aria-label={label}
      className={cn(
        "absolute top-full left-0 z-30 mt-1 w-full min-w-[12rem] rounded-xl border p-1.5 text-left",
        t.branded && "shadow-[0_4px_12px_rgba(17,17,19,0.12)]",
        t.panel,
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
                t.row,
                checked && t.rowChecked
              )}
            >
              <input
                type={radio ? "radio" : "checkbox"}
                checked={checked}
                onChange={() => toggle(item.value)}
                className="peer sr-only"
              />
              {/* Drawn box so it matches the field in both themes; the
                  real input above is what focus and screen readers use. */}
              <span
                aria-hidden
                className={cn(
                  // A square tick box in every mode, radios included, so every
                  // picker in the product shows the widget's box.
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
                  t.boxRing,
                  checked ? t.boxOn : t.boxOff
                )}
                style={
                  t.branded
                    ? { ...RING_STYLE, ...(checked ? { backgroundColor: "var(--org-primary, #0066CC)" } : {}) }
                    : undefined
                }
              >
                {checked && <Check className={cn("size-3", t.tick)} strokeWidth={3} />}
              </span>
              {stackDetail ? (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.detail && (
                    <span className={cn("truncate text-xs", t.detail, checked && t.detailChecked)}>
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
                    <span className={cn("min-w-0 max-w-1/2 truncate text-xs", t.detail, checked && t.detailChecked)}>
                      {item.detail}
                    </span>
                  )}
                </>
              )}
            </label>
          );
        })}
      </div>
      {!radio && selected.length > 0 && (
        <div className={cn("mt-1 border-t px-2.5 pt-1.5 pb-1", t.divider)}>
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn("text-xs font-medium underline underline-offset-2", t.detail)}
          >
            Clear {label.toLowerCase()}
          </button>
        </div>
      )}
      {footer && (
        <p className={cn("mt-1 border-t px-2.5 pt-1.5 pb-1 text-xs", t.divider, t.detail)}>{footer}</p>
      )}
    </div>
  );
}
