"use client";

import { AlertTriangle, Check, Pipette } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeLuminance } from "@/lib/utils/color";

interface BrandColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

/** Recreation-brand-ish starting points, so nobody has to meet a raw colour wheel cold. */
export const BRAND_PRESETS: { hex: string; name: string }[] = [
  { hex: "#0066CC", name: "Dropin blue" },
  { hex: "#0F766E", name: "Teal" },
  { hex: "#166534", name: "Forest" },
  { hex: "#B91C1C", name: "Red" },
  { hex: "#C2410C", name: "Orange" },
  { hex: "#6D28D9", name: "Purple" },
  { hex: "#BE185D", name: "Magenta" },
  { hex: "#1F2937", name: "Charcoal" },
];

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** WCAG contrast ratio of white text on this colour — the header bar's actual pairing. */
function contrastWithWhite(hex: string): number {
  const l = relativeLuminance(hex);
  return 1.05 / (l + 0.05);
}

/**
 * Brand colour for the widget header bar (and, since it is the same
 * `widget_configs.primary_color`, the public schedule page).
 *
 * A bare `<input type="color">` gave no starting point, no way to paste the hex
 * a brand guide actually specifies, and no warning when the chosen colour makes
 * the header's white text unreadable. All three are the difference between a
 * widget that looks designed and one that looks broken on someone's site.
 */
export default function BrandColorField({ value, onChange, disabled }: BrandColorFieldProps) {
  const valid = HEX_RE.test(value);
  const lowContrast = valid && contrastWithWhite(value) < 4.5;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {BRAND_PRESETS.map(({ hex, name }) => {
          const active = value.toUpperCase() === hex.toUpperCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              disabled={disabled}
              title={name}
              aria-label={name}
              aria-pressed={active}
              className={cn(
                "size-9 rounded-full border-2 transition-transform flex items-center justify-center disabled:opacity-50",
                active ? "border-foreground scale-105" : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: hex }}
            >
              {active && <Check className="w-4 h-4 text-white drop-shadow" />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <label className="relative size-9 shrink-0 rounded-lg border border-border overflow-hidden cursor-pointer">
          <input
            type="color"
            value={valid ? value : "#0066CC"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            disabled={disabled}
            className="absolute -inset-2 w-[calc(100%+1rem)] h-[calc(100%+1rem)] cursor-pointer"
            aria-label="Pick a custom colour"
          />
          <Pipette className="absolute bottom-0.5 right-0.5 w-3 h-3 text-white mix-blend-difference pointer-events-none" />
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const next = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            onChange(next.toUpperCase().slice(0, 7));
          }}
          disabled={disabled}
          spellCheck={false}
          aria-label="Brand colour hex code"
          aria-invalid={!valid}
          className={cn(
            "w-32 px-3 py-2 border rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50",
            valid ? "border-border" : "border-red-400"
          )}
        />
        <span className="text-xs text-muted-foreground">Or paste your brand hex.</span>
      </div>

      {!valid && (
        <p className="text-xs text-red-600">Needs six hex digits, like #0066CC.</p>
      )}

      {lowContrast && (
        <p className="text-xs text-amber-700 dark:text-amber-500 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          The header bar puts white text on this colour, and it will be hard to read. A darker
          shade of the same hue holds up better.
        </p>
      )}
    </div>
  );
}
