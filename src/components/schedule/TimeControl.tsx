"use client";

import { useRef } from "react";
import { minutesToTime } from "@/lib/utils/dates";
import { Button } from "@/components/ui/button";

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
 * "Not now" is deliberately plain to see: the moment the value leaves the
 * current time, the readout says "Previewing …" in the warning colour, the
 * handle and filled track turn the same colour, and a "Back to now" button
 * appears — a visitor must never mistake a previewed 9 PM for what's
 * happening now. Hour labels sit under the track, as on the Map view.
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

  // Hour labels under the track: at most about seven, on round hours.
  const hourLabels = (() => {
    const hours = range / 60;
    const step = hours <= 8 ? 2 : hours <= 14 ? 3 : 4;
    const labels: number[] = [];
    const first = Math.ceil(startMinutes / 60 / step) * step * 60;
    for (let m = first; m <= endMinutes; m += step * 60) labels.push(m);
    return labels;
  })();
  const hourLabel = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  };

  // The centre's colour while showing now; the warning colour while previewing.
  const tone = isNow ? "var(--org-primary, var(--brand))" : "var(--warning)";

  return (
    <div className="mt-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-[13px] font-semibold tabular-nums" aria-live="polite">
          {isNow ? (
            <>
              <span style={{ color: "var(--org-primary, var(--brand))" }}>Now</span>
              <span className="font-normal text-muted-foreground"> · {minutesToTime(valueMinutes)}</span>
            </>
          ) : (
            <span className="text-warning">Previewing {minutesToTime(valueMinutes)}</span>
          )}
        </p>
        {!isNow && nowInRange && (
          <Button type="button" variant="outline" size="sm" onClick={onJumpToNow}>
            Back to now
          </Button>
        )}
      </div>

      {/* Tall touch target wrapping a slim visual track. */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="relative mt-1 h-8 cursor-pointer touch-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        role="slider"
        aria-label="Preview the map at another time today"
        aria-valuemin={startMinutes}
        aria-valuemax={endMinutes}
        aria-valuenow={valueMinutes}
        aria-valuetext={minutesToTime(valueMinutes)}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border" />
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ width: `${valueFraction * 100}%`, backgroundColor: tone }}
        />

        {hourLabels.map((m) => (
          <div
            key={m}
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-card/90"
            style={{ left: `${((m - startMinutes) / range) * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {/* Where "now" is, while previewing another time. */}
        {nowInRange && !isNow && (
          <div
            className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full"
            style={{ left: `${nowFraction * 100}%`, backgroundColor: "var(--org-primary, var(--brand))" }}
            aria-hidden="true"
          />
        )}

        <div
          className="absolute top-1/2 size-5 cursor-grab rounded-full border-[3px] bg-card shadow-sm active:cursor-grabbing"
          style={{
            left: `${valueFraction * 100}%`,
            transform: "translate(-50%, -50%)",
            borderColor: tone,
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            handlePointerDown(e);
          }}
        />
      </div>

      <div className="relative h-4 text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
        {hourLabels.map((m) => {
          const f = (m - startMinutes) / range;
          return (
            <span
              key={m}
              className="absolute top-0 whitespace-nowrap"
              style={{
                left: `${f * 100}%`,
                transform: f < 0.04 ? "none" : f > 0.96 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {hourLabel(m)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
