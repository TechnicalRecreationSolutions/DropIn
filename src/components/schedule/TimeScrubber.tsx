"use client";

import { useRef } from "react";
import { minutesToTime } from "@/lib/utils/dates";

interface TimeScrubberProps {
  startMinutes: number;
  endMinutes: number;
  valueMinutes: number;
  /** Whether valueMinutes matches the current real time-of-day — highlights the NOW marker and disables the Now button. */
  isNow: boolean;
  onChange: (minutes: number) => void;
  onJumpToNow: () => void;
  nowMinutes: number;
}

/**
 * Vertical draggable time track beside the floorplan — click or drag to
 * scrub to any time within today's open-to-close range (derived by the
 * caller from today's actual sessions). Plain pointer events, same
 * convention as ShapeCanvas.tsx's drag handlers, not a form <input
 * type="range"> — a vertical range input has inconsistent cross-browser
 * support/styling, while a plain positioned track+handle is trivial here
 * and matches this app's existing hand-rolled drag interactions.
 */
export default function TimeScrubber({
  startMinutes,
  endMinutes,
  valueMinutes,
  isNow,
  onChange,
  onJumpToNow,
  nowMinutes,
}: TimeScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const range = Math.max(1, endMinutes - startMinutes);

  function minutesFromClientY(clientY: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return Math.round(startMinutes + fraction * range);
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    onChange(minutesFromClientY(e.clientY));

    function handleMove(moveEvent: PointerEvent) {
      onChange(minutesFromClientY(moveEvent.clientY));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
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
    <div className="flex flex-col items-center gap-2 w-14 sm:w-16 shrink-0">
      <button
        type="button"
        onClick={onJumpToNow}
        disabled={isNow || !nowInRange}
        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full text-white disabled:opacity-40 transition-opacity"
        style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
      >
        Now
      </button>

      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className="relative flex-1 w-2 rounded-full bg-gray-200 cursor-pointer touch-none min-h-[200px]"
        role="slider"
        aria-label="Time of day"
        aria-valuemin={startMinutes}
        aria-valuemax={endMinutes}
        aria-valuenow={valueMinutes}
        aria-valuetext={minutesToTime(valueMinutes)}
      >
        {hourTicks.map((m) => (
          <div
            key={m}
            className="absolute -left-1 w-4 h-px bg-gray-300"
            style={{ top: `${((m - startMinutes) / range) * 100}%` }}
          />
        ))}

        {nowInRange && !isNow && (
          <div
            className="absolute -left-1 w-4 h-0.5 rounded-full opacity-50"
            style={{ top: `${nowFraction * 100}%`, backgroundColor: "var(--org-accent, #2563eb)" }}
            aria-hidden="true"
          />
        )}

        <div
          className="absolute left-1/2 w-5 h-5 rounded-full border-2 border-white shadow-md cursor-grab active:cursor-grabbing"
          style={{
            top: `${valueFraction * 100}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: "var(--org-accent, #2563eb)",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            handlePointerDown(e);
          }}
        />
      </div>

      <span className="text-[11px] font-medium text-gray-600 whitespace-nowrap tabular-nums">
        {minutesToTime(valueMinutes)}
      </span>
    </div>
  );
}
