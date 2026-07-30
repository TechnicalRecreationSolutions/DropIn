import type { CSSProperties } from "react";
import { isLightColor } from "@/lib/utils/color";

interface OrgThemeProviderProps {
  /** Hex color, e.g. widget_configs.primary_color. Expected pre-validated ^#[0-9A-Fa-f]{6}$. */
  primaryColor: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Scopes the org-brand color-mix() theme (see globals.css's .org-theme
 * block) to the public schedule UI. Sets --org-primary from the org's own
 * widget_configs.primary_color and --org-text-mix (how hard to darken it
 * for on-tint text contrast — light brand colors need more darkening than
 * this alone can't be reasoned about in pure CSS). No client interactivity
 * needed, so this stays server-renderable.
 */
export default function OrgThemeProvider({ primaryColor, children, className }: OrgThemeProviderProps) {
  const textMixPercent = isLightColor(primaryColor) ? 55 : 25;

  return (
    <div
      className={`org-theme ${className ?? ""}`}
      style={
        {
          "--org-primary": primaryColor,
          "--org-text-mix": `${textMixPercent}%`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
