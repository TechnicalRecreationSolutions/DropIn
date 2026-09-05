"use client";

import { AlertTriangle, Building2, Check, Layers, Globe } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WidgetFacility } from "./types";

interface ScopePickerProps {
  facilities: WidgetFacility[];
  departments: { id: string; name: string }[];
  facilityId: string;
  departmentId: string;
  onSelect: (facilityId: string, departmentId: string) => void;
  disabled?: boolean;
}

/**
 * Step 1 — which sessions this embed shows.
 *
 * This is the only control on the page that changes *which saved config you are
 * editing* (`widget_configs` is keyed by org + facility + department), so it is
 * deliberately the biggest, most physical-looking choice on the screen rather
 * than the two anonymous `<select>`s it replaces.
 */
export default function ScopePicker({
  facilities,
  departments,
  facilityId,
  departmentId,
  onSelect,
  disabled,
}: ScopePickerProps) {
  const selectedFacility = facilities.find((f) => f.id === facilityId);

  const tileClass = (active: boolean) =>
    cn(
      "relative flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all disabled:opacity-50",
      active
        ? "border-blue-600 ring-2 ring-blue-600/25 bg-blue-50/60 dark:bg-blue-950/30"
        : "border-border bg-card hover:border-blue-300 hover:bg-muted/50"
    );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => onSelect("", "")}
          disabled={disabled}
          aria-pressed={!facilityId}
          className={tileClass(!facilityId)}
        >
          <span className="inline-flex items-center justify-center size-9 rounded-lg bg-muted shrink-0">
            <Globe className="w-4.5 h-4.5 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">Everything we run</span>
            <span className="block text-xs text-muted-foreground truncate">
              Every building, in one schedule
            </span>
          </span>
          {!facilityId && <SelectedTick />}
        </button>

        {facilities.map((f) => {
          const active = facilityId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelect(f.id, "")}
              disabled={disabled}
              aria-pressed={active}
              className={tileClass(active)}
            >
              <span className="inline-flex items-center justify-center size-9 rounded-lg bg-muted shrink-0">
                <Building2 className="w-4.5 h-4.5 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground truncate">{f.name}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {f.isPublished ? "This building only" : "Draft — not visible to visitors"}
                </span>
              </span>
              {active && <SelectedTick />}
            </button>
          );
        })}
      </div>

      {/* Anonymous RLS can't read an unpublished facility, so the embed can't
          scope to one — it silently falls back to every building. Staff never
          see that, because their own preview *can* read it. */}
      {selectedFacility && !selectedFacility.isPublished && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-700 dark:text-amber-500" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            <span className="font-medium">{selectedFacility.name} isn&apos;t published.</span> Until
            it is, the embed on your website will show every building instead of just this one —
            even though the preview here shows it correctly.
          </p>
        </div>
      )}

      {facilityId && departments.length > 0 && (
        <div>
          <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-muted-foreground" />
            Narrow it to one department?
          </p>
          <div className="flex flex-wrap gap-2">
            <DeptPill
              label="All departments"
              active={!departmentId}
              disabled={disabled}
              onClick={() => onSelect(facilityId, "")}
            />
            {departments.map((d) => (
              <DeptPill
                key={d.id}
                label={d.name}
                active={departmentId === d.id}
                disabled={disabled}
                onClick={() => onSelect(facilityId, d.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectedTick() {
  return (
    <span className="absolute top-2 right-2 inline-flex items-center justify-center size-5 rounded-full bg-blue-600 text-white">
      <Check className="w-3 h-3" />
    </span>
  );
}

function DeptPill({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors disabled:opacity-50",
        active
          ? "bg-blue-600 border-blue-600 text-white"
          : "bg-card border-border text-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );
}
