"use client";

import { useState, useSyncExternalStore } from "react";
import { Maximize2, Monitor, Moon, Smartphone, Sun, Tablet } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { WidgetTheme } from "./types";

type Device = "desktop" | "tablet" | "phone";

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "100%",
  tablet: "640px",
  phone: "380px",
};

interface PreviewPanelProps {
  /** The debounced `/widget/[orgId]?preview=1…` URL. */
  src: string;
  /** Bumped by the studio to reload after a publish, when `src` itself hasn't changed. */
  version: number;
  dirty: boolean;
  /** Preview-only. Never the snippet's theme setting — see WidgetStudio. */
  theme: WidgetTheme;
  onThemeChange: (theme: WidgetTheme) => void;
  onOpenFullScreen: () => void;
}

const PHONE_QUERY = "(max-width: 639px)";

function subscribePhone(onChange: () => void) {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * The widget as visitors will see it, beside the settings — always there.
 *
 * It was a popup for a while (`PreviewWindow`, still the full-screen view),
 * which saved a render on every visit but broke "change it and watch it
 * change": every tweak meant opening a window. Now the settings card is
 * 520px, which leaves the preview the larger column, and the popup is only
 * for seeing it at full size.
 *
 * The iframe is mounted once and stays mounted while the page is open.
 * Switching section tiles, collapsing it below 1180px, or picking a device
 * frame never remounts it: collapsing is CSS (`hidden`), and the device only
 * changes the frame's width. A remount would reload the whole widget and drop
 * whatever the admin had clicked to inside it. It reloads only when `src`
 * changes (a setting changed) or `version` is bumped (a publish).
 *
 * Light/Dark here is the preview's own. The real theme is a snippet option in
 * Install; this toggle starts from it but never writes back to it.
 */
export default function PreviewPanel({
  src,
  version,
  dirty,
  theme,
  onThemeChange,
  onOpenFullScreen,
}: PreviewPanelProps) {
  /** null = not picked yet: Phone on a phone, Desktop everywhere else. */
  const [picked, setPicked] = useState<Device | null>(null);
  const onPhone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const device: Device = picked ?? (onPhone ? "phone" : "desktop");

  /** Below 1180px only — at desktop width the preview is always shown. */
  const [expanded, setExpanded] = useState(false);

  return (
    <section aria-labelledby="widget-preview-title" className="rounded-panel bg-muted p-2 studio:p-4">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 pl-2 studio:pl-0">
        <div className="mr-auto flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 id="widget-preview-title" className="text-card-title text-foreground">
            Preview
          </h2>
          {dirty && <span className="text-caption text-warning">Showing unpublished changes</span>}
        </div>

        <div className={cn("flex flex-wrap items-center gap-2", !expanded && "max-studio:hidden")}>
          <Segmented
            label="Preview size"
            value={device}
            onChange={setPicked}
            options={[
              { value: "desktop", label: "Desktop", icon: Monitor },
              { value: "tablet", label: "Tablet", icon: Tablet },
              { value: "phone", label: "Phone", icon: Smartphone },
            ]}
            iconOnly={onPhone}
          />
          <Segmented
            label="Preview theme"
            value={theme}
            onChange={onThemeChange}
            options={[
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
            ]}
            iconOnly={onPhone}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onOpenFullScreen}
            aria-label="Open the preview full screen"
            title="Open the preview full screen"
            className="touch-target"
          >
            <Maximize2 />
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="widget-preview-frame"
          className="touch-target studio:hidden"
        >
          {expanded ? "Hide" : "Show"}
        </Button>
      </div>

      <div
        id="widget-preview-frame"
        className={cn("mt-3 studio:mt-4", !expanded && "max-studio:hidden")}
      >
        <div
          className="mx-auto overflow-hidden rounded-card border border-border bg-card transition-[max-width] duration-200"
          style={{ maxWidth: DEVICE_WIDTH[device] }}
        >
          <iframe
            key={version}
            src={src}
            title="Widget preview"
            className="block h-[640px] w-full border-0 studio:h-[720px]"
          />
        </div>
        <p className="mt-2 px-2 text-caption text-muted-foreground">
          Your real sessions. Light and dark here only change this preview.
        </p>
      </div>
    </section>
  );
}
