"use client";

import { ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

/** One switchable schedule in a multi-schedule widget. */
export interface ScheduleScope {
  id: string;
  /** The visitor-facing name the org typed. */
  label: string;
  /** "Aquatic Centre › Aquatics › Lane Swim", minus anything the label already says. */
  context?: string;
}

interface ScheduleScopeSwitcherProps {
  scopes: ScheduleScope[];
  activeId: string;
  onChange: (id: string) => void;
  /** Renders on the org-coloured header bar (white-on-tint) rather than on a card. */
  onTint?: boolean;
  className?: string;
}

/**
 * The visitor-facing "which schedule am I looking at" control.
 *
 * Two shapes, one API, because two options and twenty options are different
 * problems: up to four scopes render as a pill row — every choice visible, one
 * tap to switch, and no way to miss that switching is possible — and five or
 * more fall back to a dropdown, which is the only thing that survives twenty
 * entries in a 320px embed.
 *
 * This is deliberately a shared component rather than something the widget owns
 * privately: the dashboard's filter editor renders *this*, so what an admin
 * builds and what a visitor gets cannot drift apart. It used to be a drawing of
 * pills in the editor and a dropdown in the widget, which is precisely the kind
 * of divergence a mock guarantees eventually.
 */
export default function ScheduleScopeSwitcher({
  scopes,
  activeId,
  onChange,
  onTint = false,
  className,
}: ScheduleScopeSwitcherProps) {
  if (scopes.length < 2) return null;

  const active = scopes.find((s) => s.id === activeId) ?? scopes[0];
  const asPills = scopes.length <= 4;

  return (
    // The group wraps the context line as well as the controls: "Showing
    // Aquatic Centre › Aquatics" is part of understanding the choice, not a
    // caption beside it.
    <div role="group" aria-label="Choose a schedule" className={cn("min-w-0 w-full", className)}>
      {asPills ? (
        <div
          // Scrolls rather than wraps: four labels of unknown length inside a
          // 320px embed will not fit, and a wrapped pill row pushes the
          // schedule itself below the fold on a phone.
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {scopes.map((scope) => {
            const isActive = scope.id === active.id;
            return (
              <button
                key={scope.id}
                type="button"
                onClick={() => onChange(scope.id)}
                aria-pressed={isActive}
                title={scope.context || scope.label}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors whitespace-nowrap",
                  onTint
                    ? isActive
                      ? "bg-white shadow-sm"
                      : "text-white/85 hover:text-white bg-white/15 hover:bg-white/25"
                    : isActive
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                )}
                style={onTint && isActive ? { color: "var(--org-primary)" } : undefined}
              >
                {scope.label}
              </button>
            );
          })}
        </div>
      ) : (
        <Select value={active.id} onValueChange={onChange}>
          <SelectTrigger
            aria-label="Choose a schedule"
            className={cn(
              "h-auto w-full sm:w-fit sm:min-w-56 gap-2 rounded-full px-3 py-1.5 text-xs sm:text-sm font-medium",
              onTint
                ? "border-0 bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/50 [&_svg]:!text-white"
                : "border-border bg-card text-foreground"
            )}
          >
            {/*
              Radix's SelectValue only derives its text from the matching
              SelectItem once that item has mounted client-side (SelectContent
              isn't in the DOM until first opened), so left to its default this
              renders empty until hydration plus a first open. Passing children
              explicitly is Radix's documented override, and is what makes the
              active label server-render.
            */}
            <SelectValue>{active.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {scopes.map((scope) => (
              <SelectItem key={scope.id} value={scope.id}>
                <span className="flex flex-col items-start">
                  <span>{scope.label}</span>
                  {scope.context && (
                    <span className="text-[11px] text-muted-foreground">{scope.context}</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {active.context && (
        <p
          className={cn(
            "mt-1.5 text-[11px] truncate flex items-center gap-1",
            onTint ? "text-white/75" : "text-muted-foreground"
          )}
        >
          {/* Not decorative: with two buildings that both have a pool, the
              label alone cannot say which schedule is on screen. */}
          <ChevronDown className="w-3 h-3 shrink-0 -rotate-90" aria-hidden="true" />
          Showing {active.context}
        </p>
      )}
    </div>
  );
}
