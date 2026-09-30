"use client";

import { useState } from "react";
import { Check, ExternalLink, Monitor, Moon, RefreshCw, Smartphone, Sun, Tablet } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { BRAND_PRESETS } from "./BrandColorField";
import type { WidgetTheme } from "./types";

interface PreviewWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  /** Bumped by the parent to force a remount when `src` itself hasn't changed. */
  version: number;
  onRefresh: () => void;
  /** Plain-English description of the embed being previewed. */
  summary: string;
  dirty: boolean;
  primaryColor: string;
  onPrimaryColorChange: (hex: string) => void;
  theme: WidgetTheme;
  onThemeChange: (theme: WidgetTheme) => void;
}

const DEVICES = [
  { id: "desktop" as const, label: "Desktop", Icon: Monitor, width: null },
  { id: "tablet" as const, label: "Tablet", Icon: Tablet, width: 834 },
  { id: "phone" as const, label: "Phone", Icon: Smartphone, width: 390 },
];

/**
 * The widget as visitors will see it, at the size it will actually be.
 *
 * This started life as a 420px column pinned beside the controls, which put the
 * page's most important artifact in its smallest box and squeezed the four
 * steps into a form column narrower than the content it holds. As a window it
 * gets the whole screen, and the steps get the whole page.
 *
 * The tradeoff of a popup is that it breaks "change it and watch it change", so
 * the two most visual decisions — brand colour and light/dark — are repeated on
 * a strip along the bottom. They write to the same state the steps do, so a
 * tweak made here is a tweak made there, and it is still unpublished until the
 * publish bar says otherwise.
 *
 * The iframe is only mounted while the window is open: a hidden one cost every
 * visit to this page a full widget render nobody was looking at.
 */
export default function PreviewWindow({
  open,
  onOpenChange,
  src,
  version,
  onRefresh,
  summary,
  dirty,
  primaryColor,
  onPrimaryColorChange,
  theme,
  onThemeChange,
}: PreviewWindowProps) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const frameWidth = DEVICES.find((d) => d.id === device)?.width ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[92vh] p-0 overflow-hidden">
        <header className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-border pr-12">
          {/* Below sm the title takes the row to itself: beside the controls
              it had 80px, which wrapped it and hid the badge under them. */}
          <div className="min-w-0 flex-1 max-sm:basis-full">
            <DialogTitle className="text-card-title flex items-center gap-2">
              Live preview
              {dirty && (
                <Badge variant="warning">Unpublished changes</Badge>
              )}
            </DialogTitle>
            <p className="text-caption text-muted-foreground truncate">{summary}</p>
          </div>

          <div className="flex items-center gap-1">
            <div className="inline-flex rounded-full bg-muted p-1" role="group" aria-label="Preview size">
              {DEVICES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDevice(id)}
                  aria-pressed={device === id}
                  title={label}
                  className={cn(
                    "flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    device === id
                      ? "bg-raised text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              title="Reload the preview"
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw />
              <span className="sr-only">Reload the preview</span>
            </Button>
            <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <a href={src} target="_blank" rel="noopener noreferrer" title="Open the preview in a new tab">
                <ExternalLink />
                <span className="sr-only">Open the preview in a new tab</span>
              </a>
            </Button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-auto bg-muted p-3 sm:p-5 flex justify-center">
          <div
            className={cn(
              "h-full bg-card overflow-hidden",
              frameWidth
                ? "rounded-[1.75rem] border-[8px] border-foreground/80 shadow-xl max-w-full"
                : "w-full rounded-card border border-border shadow-card"
            )}
            style={frameWidth ? { width: frameWidth } : undefined}
          >
            {open && (
              <iframe
                key={`${src}-${version}`}
                src={src}
                className="w-full h-full block border-0"
                title="Widget preview"
              />
            )}
          </div>
        </div>

        <footer className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-t border-border">
          <span className="text-label text-muted-foreground">Quick tweaks</span>

          <div className="flex items-center gap-1.5" role="group" aria-label="Brand colour">
            {BRAND_PRESETS.map(({ hex, name }) => {
              const active = primaryColor.toUpperCase() === hex.toUpperCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onPrimaryColorChange(hex)}
                  title={name}
                  aria-label={name}
                  aria-pressed={active}
                  className={cn(
                    "size-6 rounded-full border-2 ring-1 ring-foreground/20 flex items-center justify-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active ? "border-foreground scale-110" : "border-transparent hover:scale-110"
                  )}
                  style={{ backgroundColor: hex }}
                >
                  {active && <Check className="w-3 h-3 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>

          <div className="inline-flex rounded-full bg-muted p-1" role="group" aria-label="Theme">
            {([
              { value: "light" as const, label: "Light", Icon: Sun },
              { value: "dark" as const, label: "Dark", Icon: Moon },
            ]).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => onThemeChange(value)}
                aria-pressed={theme === value}
                className={cn(
                  "flex items-center gap-1.5 h-7 px-3 rounded-full text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  theme === value ? "bg-raised text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <p className="text-label font-normal text-muted-foreground ml-auto hidden md:block">
            Real published sessions. Changes here are still unpublished until you publish them.
          </p>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
