"use client";

import { useRef } from "react";
import { minutesToTime } from "@/lib/utils/dates";

interface TimeControlProps {
  startMinutes: number;
  endMinutes: number;
  valueMinutes: number;
  /** Whether valueMinutes matches the current real time-of-day. */
  isNow: boolean;
  nowMinutes: number;
  onChange: (minutes: number) => void;
  onJumpToNow: () => void;
}

const KEYBOARD_STEP_MINUTES = 15;

/**
 * Horizontal time control under the floorplan — drag anywhere on the track
 * to preview the map at another time today, arrow keys step 15 minutes.
 * Replaces the earlier vertical side-scrubber: a bottom bar costs the map
 * no width on phones (where width is the scarce dimension) and matches how
 * people expect a timeline to lie.
 *
 * "Not now" is deliberately loud: the moment the value leaves the current
 * time, the handle and readout turn amber and the readout says "Viewing …",
 * while the Now button fills with the org accent to invite jumping back —
 * a visitor must never mistake a previewed 9 PM for what's happening now.
 * Plain pointer events, same convention as the app's other hand-rolled
 * drag interactions.
 */
export default function TimeControl({
  startMinutes,
  endMinutes,
  valueMinutes,
  isNow,
  nowMinutes,
  onChange,
  onJumpToNow,
}: TimeControlProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const range = Math.max(1, endMinutes - startMinutes);

  function minutesFromClientX(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(startMinutes + fraction * range);
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    onChange(minutesFromClientX(e.clientX));

    function handleMove(moveEvent: PointerEvent) {
      onChange(minutesFromClientX(moveEvent.clientX));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const clampToRange = (m: number) => Math.min(endMinutes, Math.max(startMinutes, m));
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(clampToRange(valueMinutes + KEYBOARD_STEP_MINUTES));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(clampToRange(valueMinutes - KEYBOARD_STEP_MINUTES));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(startMinutes);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(endMinutes);
    }
  }

  const valueFraction = (valueMinutes - startMinutes) / range;
  const nowFraction = (nowMinutes - startMinutes) / range;
  const nowInRange = nowMinutes >= startMinutes && nowMinutes <= endMinutes;

  const hourTicks = (() => {
    const ticks: number[] = [];
    const firstHour = Math.ceil(startMinutes / 60) * 60;
    for (let m = firstHour; m <= endMinutes; m += 60) ticks.push(m);
    return ticks;
  })();

  return (
    <div className="flex items-center gap-3 mt-3">
      <button
        type="button"
        onClick={onJumpToNow}
        disabled={isNow || !nowInRange}
        className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-full transition-colors shrink-0 ${
          isNow || !nowInRange ? "bg-muted text-muted-foreground/70" : "text-white"
        }`}
        style={
          isNow || !nowInRange ? undefined : { backgroundColor: "var(--org-accent, #2563eb)" }
        }
      >
        Now
      </button>

      {/* Tall touch target wrapping a slim visual track. */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="relative flex-1 h-8 cursor-pointer touch-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        role="slider"
        aria-label="Preview the map at another time today"
        aria-valuemin={startMinutes}
        aria-valuemax={endMinutes}
        aria-valuenow={valueMinutes}
        aria-valuetext={minutesToTime(valueMinutes)}
      >
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full bg-muted" />

        {hourTicks.map((m) => (
          <div
            key={m}
            className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-muted"
            style={{ left: `${((m - startMinutes) / range) * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {nowInRange && !isNow && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full opacity-60"
            style={{ left: `${nowFraction * 100}%`, backgroundColor: "var(--org-accent, #2563eb)" }}
            aria-hidden="true"
          />
        )}

        <div
          className="absolute top-1/2 w-5 h-5 rounded-full border-2 border-white shadow-md cursor-grab active:cursor-grabbing"
          style={{
            left: `${valueFraction * 100}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: isNow ? "var(--org-accent, #2563eb)" : "#D97706",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            handlePointerDown(e);
          }}
        />
      </div>

      <span
        className={`text-xs font-semibold whitespace-nowrap tabular-nums shrink-0 ${
          isNow ? "text-muted-foreground" : "text-amber-700"
        }`}
        aria-live="polite"
      >
        {isNow ? minutesToTime(valueMinutes) : `Viewing ${minutesToTime(valueMinutes)}`}
      </span>
    </div>
  );
}
