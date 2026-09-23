"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CalendarRange, Check, ChevronDown, Download, Loader2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/analytics/csv";
import {
  MAX_RANGE_DAYS,
  RANGE_PRESETS,
  formatRangeLabel,
  parseAnalyticsRange,
  toLocalDay,
  type RangePresetId,
} from "@/lib/analytics/range";
import { cn } from "@/lib/utils/cn";

/**
 * The analytics page's controls: period, facility, export.
 *
 * All three are URL state (`?range` / `?from`+`?to` / `?facility`), which is
 * what makes a particular view of the numbers something staff can bookmark
 * and paste into an email — and what lets the export route read exactly the
 * same inputs the page did, so the download always matches the screen.
 *
 * It lives in the page's static shell rather than inside the streaming body.
 * On a client navigation `useSearchParams()` resolves synchronously from the
 * router, so the controls stay mounted and usable while the new numbers are
 * still arriving; rendered inside the body they would blink out to a skeleton
 * every time somebody changed the period.
 */

export interface AnalyticsToolbarProps {
  facilities: { id: string; name: string }[];
  /**
   * Which CSVs this page offers. Defaults to Engagement's four.
   *
   * Passed in rather than derived from the pathname: the three pages already
   * differ in what they can export AND in who may, and a toolbar that guessed
   * from the URL would be a third place the section's two permissions are
   * encoded. The export route enforces the real answer either way.
   */
  datasets?: { id: ExportDataset; label: string; description: string }[];
}

export function AnalyticsToolbar({
  facilities,
  datasets = EXPORT_DATASETS,
}: AnalyticsToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const range = parseAnalyticsRange({
    range: searchParams.get("range") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const facilityId = searchParams.get("facility");

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => {
      router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false });
    });
  }

  function applyPreset(preset: RangePresetId) {
    navigate((params) => {
      params.delete("from");
      params.delete("to");
      params.set("range", preset);
    });
  }

  function applyCustom(from: string, to: string) {
    navigate((params) => {
      params.delete("range");
      params.set("from", from);
      params.set("to", to);
    });
  }

  // The export links carry the current period and facility so a download is
  // always the view on screen, never a silently different default window.
  const exportQuery = new URLSearchParams();
  if (range.preset === "custom") {
    exportQuery.set("from", range.from);
    exportQuery.set("to", range.to);
  } else {
    exportQuery.set("range", range.preset);
  }
  if (facilityId) exportQuery.set("facility", facilityId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <RangePicker range={range} onPreset={applyPreset} onCustom={applyCustom} />

      {facilities.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg">
              <Building2 aria-hidden />
              <span className="max-w-[10rem] truncate">
                {facilities.find((f) => f.id === facilityId)?.name ?? "All facilities"}
              </span>
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            <DropdownMenuItem onSelect={() => navigate((p) => p.delete("facility"))}>
              <Check className={cn("size-4", facilityId ? "opacity-0" : "opacity-100")} aria-hidden />
              All facilities
            </DropdownMenuItem>
            {facilities.map((facility) => (
              <DropdownMenuItem
                key={facility.id}
                onSelect={() => navigate((p) => p.set("facility", facility.id))}
              >
                <Check
                  className={cn("size-4", facilityId === facility.id ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                {facility.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isPending && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Updating
        </span>
      )}

      <div className="ms-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg">
              <Download aria-hidden />
              Export
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              CSV for {formatRangeLabel(range).toLowerCase()}
            </DropdownMenuLabel>
            {datasets.map((dataset) => (
              <DropdownMenuItem key={dataset.id} asChild>
                {/* A plain link, not a fetch-and-blob: the browser's own
                    download handling is what makes this work on iOS Safari,
                    and it keeps the session cookie on the request. */}
                <a href={`/api/analytics/export?${exportQuery}&dataset=${dataset.id}`} download>
                  <span className="flex flex-col gap-0.5">
                    <span>{dataset.label}</span>
                    <span className="text-xs text-muted-foreground">{dataset.description}</span>
                  </span>
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface RangePickerProps {
  range: ReturnType<typeof parseAnalyticsRange>;
  onPreset: (preset: RangePresetId) => void;
  onCustom: (from: string, to: string) => void;
}

/**
 * Presets first, typed dates second.
 *
 * Native `<input type="date">` rather than a hand-built calendar grid: on a
 * phone it opens the platform date wheel, which is the control people already
 * know, and it costs nothing to ship. A custom calendar would be the third
 * date-picking UI in this app to keep in step with the other two.
 */
function RangePicker({ range, onPreset, onCustom }: RangePickerProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const today = toLocalDay(new Date());

  const invalid = !from || !to || from > to;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening always starts from what is on screen, not from whatever
        // half-typed range was abandoned last time.
        if (next) {
          setFrom(range.from);
          setTo(range.to);
        }
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button variant="outline" size="lg">
          <CalendarRange aria-hidden />
          {formatRangeLabel(range)}
          <ChevronDown aria-hidden />
        </Button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="grid grid-cols-2 gap-1.5">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onPreset(preset.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  range.preset === preset.id
                    ? "bg-accent/15 font-medium text-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                <Check
                  className={cn("size-3.5 shrink-0", range.preset === preset.id ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Custom range
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-xs text-muted-foreground">
                From
                <input
                  type="date"
                  value={from}
                  max={today}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex-1 text-xs text-muted-foreground">
                To
                <input
                  type="date"
                  value={to}
                  max={today}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
              <Button
                size="lg"
                disabled={invalid}
                onClick={() => {
                  onCustom(from, to);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {invalid
                ? "Pick a start on or before the end date."
                : `Up to ${MAX_RANGE_DAYS} days. Currently ${range.days} day${range.days === 1 ? "" : "s"}, ${range.from} to ${range.to}.`}
            </p>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
