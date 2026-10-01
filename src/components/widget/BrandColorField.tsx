"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeLuminance } from "@/lib/utils/color";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
 *
 * The swatches and the chip are the org's own colours, so they are drawn with
 * inline styles — the one place on this page a hex reaches the dashboard.
 */
export default function BrandColorField({ value, onChange, disabled }: BrandColorFieldProps) {
  const valid = HEX_RE.test(value);
  const lowContrast = valid && contrastWithWhite(value) < 4.5;

  return (
    <div className="space-y-3">
      {/* 32px swatches with a 44px tap area. The chosen one gets a white gap
          then an ink ring, which reads on every preset, Charcoal included. */}
      <div className="flex flex-wrap gap-3" role="group" aria-label="Preset colours">
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
                "touch-target size-8 rounded-full transition-shadow duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50",
                active
                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                  : "ring-1 ring-inset ring-foreground/15"
              )}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="relative w-36">
          {/* The chip is the native picker: tap it for a colour wheel. */}
          <label className="touch-target absolute left-2.5 top-1/2 z-[1] size-5 -translate-y-1/2 overflow-hidden rounded-full ring-1 ring-inset ring-foreground/15 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <span aria-hidden className="absolute inset-0" style={{ backgroundColor: valid ? value : "transparent" }} />
            <input
              type="color"
              value={valid ? value : "#0066CC"}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              disabled={disabled}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              aria-label="Pick a custom colour"
            />
          </label>
          <Input
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
            className="pl-10 font-mono uppercase"
          />
        </div>
        <span className="text-caption text-muted-foreground">Or paste your brand hex.</span>
      </div>

      {!valid && (
        <FieldError className="mt-0">Needs six hex digits, like #0066CC.</FieldError>
      )}

      {lowContrast && (
        <p className="text-caption text-warning flex items-start gap-1.5">
          <AlertTriangle className="size-4 shrink-0 mt-px" />
          The header bar puts white text on this colour, and it will be hard to read. A darker
          shade of the same hue holds up better.
        </p>
      )}
    </div>
  );
}
