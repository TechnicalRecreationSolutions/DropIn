"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { StudioSection } from "./types";

/** One tile's content. Everything but `label` is hidden below 640px, where tiles become chips. */
export interface SectionTile {
  section: StudioSection;
  /** 13px muted line; also the chip's text below 640px. */
  label: string;
  /** 18px semibold line. */
  value: React.ReactNode;
  /** 13px line under the value. */
  note: React.ReactNode;
  /** `warning` colours the note — Install's "Copy the code again". */
  noteTone?: "muted" | "warning" | "success";
  /** The amber dot: this section holds an unpublished change (or, for Install, stale code). */
  attention?: boolean;
  /** A 1-based step number, in the first-run checklist. */
  step?: number;
}

interface SectionTilesProps {
  tiles: SectionTile[];
  active: StudioSection;
  onSelect: (section: StudioSection) => void;
  /** For screen readers: what the row is. */
  label: string;
}

export const tabId = (s: StudioSection) => `widget-tab-${s}`;
export const panelId = (s: StudioSection) => `widget-panel-${s}`;

/**
 * The studio's navigation. The tiles *are* the tabs — there is no separate tab
 * bar — so each one is a real `role="tab"` with arrow-key movement (Left/Right,
 * Home/End; selection follows focus, as in a native tab strip), and its panel
 * opens below.
 *
 * Three shapes from one element, by width: four summary tiles in a row at
 * desktop, a 2 × 2 grid below 1180px, and a horizontal row of chips (label and
 * dot only) below 640px. One element rather than three, so there is only ever
 * one tablist and one set of ids.
 */
export default function SectionTiles({ tiles, active, onSelect, label }: SectionTilesProps) {
  const refs = useRef<Partial<Record<StudioSection, HTMLButtonElement | null>>>({});

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % tiles.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tiles.length) % tiles.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tiles.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = tiles[next].section;
    onSelect(target);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 studio:grid-cols-4"
    >
      {tiles.map((tile, index) => {
        const selected = tile.section === active;
        return (
          <button
            key={tile.section}
            ref={(el) => {
              refs.current[tile.section] = el;
            }}
            type="button"
            role="tab"
            id={tabId(tile.section)}
            aria-selected={selected}
            aria-controls={panelId(tile.section)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tile.section)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // Chip below 640px…
              "flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              // …a tile from 640px up.
              "sm:min-h-[104px] sm:flex-col sm:items-stretch sm:gap-0 sm:whitespace-normal sm:rounded-card sm:p-4",
              selected ? "border-foreground ring-1 ring-foreground" : "border-border hover:bg-muted"
            )}
          >
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground max-sm:text-body max-sm:font-medium max-sm:text-foreground">
              {tile.step !== undefined && (
                <span
                  aria-hidden
                  className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-label font-semibold tabular-nums text-foreground"
                >
                  {tile.step}
                </span>
              )}
              {tile.label}
              {tile.attention && (
                <>
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
                  <span className="sr-only"> (needs attention)</span>
                </>
              )}
            </span>
            <span className="mt-1 hidden items-center gap-2 text-heading text-foreground sm:flex">{tile.value}</span>
            <span
              className={cn(
                "mt-0.5 hidden items-center gap-1 text-caption sm:flex",
                tile.noteTone === "warning"
                  ? "text-warning"
                  : tile.noteTone === "success"
                    ? "text-success"
                    : "text-muted-foreground"
              )}
            >
              {tile.noteTone === "success" && <Check aria-hidden className="size-3.5" />}
              {tile.note}
            </span>
          </button>
        );
      })}
    </div>
  );
}
