"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import TickBoxList, {
  summarizeTicks,
  useDismissable,
  type TickBoxItem,
  type TickBoxMode,
  type TickBoxTheme,
} from "./TickBoxList";

/** The focus ring and ticks take the centre's colour (widget themes only). */
const RING_STYLE = { "--tw-ring-color": "var(--org-primary, #0066CC)" } as React.CSSProperties;

/**
 * The label, field and icon classes of a tick-box field, per theme.
 *
 * Widget values are written out, not tokens — see TickBoxTheme. A field's
 * border is what shows it is a control, so it holds 3:1 against its ground in
 * every theme (the app's `input` token is chosen for exactly that, DESIGN §3).
 * Exported because the widget's filter bar draws its search and date inputs
 * with the same field.
 */
export function fieldTheme(theme: TickBoxTheme) {
  if (theme === "app") {
    return {
      label: "text-label text-muted-foreground",
      muted: "text-muted-foreground",
      icon: "text-muted-foreground",
      field: cn(
        "h-10 w-full rounded-control border text-sm outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-offset-1",
        "bg-card border-input text-foreground hover:bg-muted focus-visible:ring-ring focus-visible:ring-offset-background"
      ),
      style: undefined,
    };
  }
  const dark = theme === "widget-dark";
  return {
    label: cn("text-xs font-medium", dark ? "text-gray-300" : "text-[#5d5d63]"),
    muted: dark ? "text-gray-300" : "text-[#5d5d63]",
    icon: dark ? "text-gray-400" : "text-[#5d5d63]",
    field: cn(
      "h-10 w-full rounded-[10px] border text-sm outline-none transition-colors",
      "focus-visible:ring-2 focus-visible:ring-offset-1",
      dark
        ? "bg-gray-800 border-gray-500 text-gray-100 focus-visible:ring-offset-gray-900"
        : "bg-white border-[#86868d] text-[#111113] focus-visible:ring-offset-white"
    ),
    style: RING_STYLE,
  };
}

/**
 * One picker: a small label above a field-shaped button that opens a
 * TickBoxList drawn in place beneath it (not in a portal — a portal is what
 * breaks inside a themed iframe, and in place is simpler everywhere else).
 * Escape or a click outside closes it; Escape hands focus back to the button.
 *
 * The widget's filter bar renders it with `theme="widget"`/`"widget-dark"`;
 * the dashboard's building switcher and department filter with `"app"`. Same
 * shape, same behaviour, different palette — see TickBoxTheme.
 *
 * `trigger="icon"` swaps the field for a square icon button carrying the same
 * list, for the collapsed (icon-only) sidebar.
 */
export default function TickBoxDropdown({
  id,
  label,
  allLabel,
  items,
  selected,
  onChange,
  theme,
  mode = "multi",
  value,
  emphasize,
  hideLabel = false,
  trigger = "field",
  icon: Icon,
  footer,
  stackDetail,
  className,
  buttonClassName,
  panelClassName,
}: {
  id: string;
  label: string;
  /** What the closed field says when nothing is ticked. */
  allLabel: string;
  items: TickBoxItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  theme: TickBoxTheme;
  mode?: TickBoxMode;
  /** Overrides the closed field's text (default: summarizeTicks). */
  value?: string;
  /** Semibold value — default: once anything is ticked. A radio whose pick is
   *  "All …" passes false, since nothing is being narrowed. */
  emphasize?: boolean;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  trigger?: "field" | "icon";
  icon?: LucideIcon;
  footer?: ReactNode;
  stackDetail?: boolean;
  className?: string;
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const t = fieldTheme(theme);

  useDismissable(open, () => setOpen(false), rootRef, buttonRef);

  const panelId = `${id}-options`;
  const shown = value ?? summarizeTicks(items, selected, allLabel);

  function handleChange(next: string[]) {
    onChange(next);
    // Nothing more to choose once a one-at-a-time pick is made.
    if (mode !== "multi") {
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className={cn("relative flex min-w-0 flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className={cn(t.label, (hideLabel || trigger === "icon") && "sr-only")}>
        {label}
      </span>
      {trigger === "icon" ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${label}: ${shown}`}
          title={`${label}: ${shown}`}
          className={cn(
            "flex size-10 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-muted text-foreground",
            buttonClassName
          )}
        >
          {Icon && <Icon aria-hidden className="size-4" />}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={`${id}-label ${id}-value`}
          className={cn(t.field, "flex items-center justify-between gap-2 pl-3 pr-2.5 text-left", buttonClassName)}
          style={t.style}
        >
          <span id={`${id}-value`} className={cn("truncate", (emphasize ?? selected.length > 0) && "font-semibold")}>
            {shown}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180", t.icon)}
          />
        </button>
      )}

      {open && (
        <TickBoxList
          id={panelId}
          label={label}
          items={items}
          selected={selected}
          onChange={handleChange}
          theme={theme}
          mode={mode}
          stackDetail={stackDetail}
          footer={footer}
          className={panelClassName}
        />
      )}
    </div>
  );
}
