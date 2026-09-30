"use client";

import { useState } from "react";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EditorTemplate } from "./ScheduleEditingContext";

interface TemplateRailProps {
  templates: EditorTemplate[];
  /** Null when the current scope spans schedules, so there's no single group to manage templates for. */
  manageTemplatesHref: string | null;
  /**
   * True only in Map, the one view with a real time axis to drop onto.
   * Everywhere else the rail is the same list rendered as a color key —
   * one component so the two can never show different templates.
   */
  draggable: boolean;
  /** Opens the create dialog with this template pre-picked, for views without a drop target. */
  onTemplateClick?: (template: EditorTemplate) => void;
}

/**
 * The editor's session-template rail. In Map each card is a dnd-kit drag
 * source; in Grid/List the same cards are click-to-place shortcuts, since a
 * flat list has no spatial position to drop onto.
 *
 * Styled per docs/DESIGN.md: a soft grey panel holding plain white cards —
 * a grip, the template's colour as a small square, its name and length. No
 * coloured left border.
 */
export default function TemplateRail({
  templates,
  manageTemplatesHref,
  draggable,
  onTemplateClick,
}: TemplateRailProps) {
  const [query, setQuery] = useState("");
  const terms = query.trim().toLowerCase();
  const shown = terms ? templates.filter((t) => t.name.toLowerCase().includes(terms)) : templates;

  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-muted p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">Templates</h2>
        {manageTemplatesHref && (
          <Link
            href={manageTemplatesHref}
            className="text-xs font-medium text-brand hover:underline underline-offset-4"
          >
            Manage
          </Link>
        )}
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl bg-card px-3 py-5 text-center">
          <p className="text-xs text-muted-foreground mb-2">
            {manageTemplatesHref
              ? "No templates yet."
              : "Pick a single schedule above to place sessions."}
          </p>
          {manageTemplatesHref && (
            <Link
              href={manageTemplatesHref}
              className="text-xs font-medium text-brand hover:underline underline-offset-4"
            >
              Create your first template →
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="-mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {draggable ? "Drag one onto a lane to place it." : "Click one, or a day’s +, to place a session."}
          </p>

          <label className="relative block">
            <span className="sr-only">Search templates</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates"
              className="h-9 w-full rounded-[10px] border border-input bg-card pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {shown.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No templates match “{query.trim()}”.</p>
          ) : (
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
              {shown.map((template) =>
                draggable ? (
                  <DraggableTemplateCard key={template.id} template={template} />
                ) : (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onClick={onTemplateClick ? () => onTemplateClick(template) : undefined}
                  />
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "45 m", "1 h", "3 h 45 m" — a length reads faster than a minute count. */
function formatLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

function TemplateCard({
  template,
  onClick,
  dragProps,
  isDragging,
  innerRef,
}: {
  template: EditorTemplate;
  onClick?: () => void;
  dragProps?: Record<string, unknown>;
  isDragging?: boolean;
  innerRef?: (node: HTMLElement | null) => void;
}) {
  const color = template.color ?? "#0066CC";

  return (
    <button
      type="button"
      ref={innerRef}
      onClick={onClick}
      {...dragProps}
      title={dragProps ? `Drag ${template.name} onto a lane` : undefined}
      className={cn(
        "flex w-48 flex-shrink-0 items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2.5 text-left transition-[opacity,box-shadow] lg:w-full",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragProps
          ? "cursor-grab active:cursor-grabbing touch-none hover:shadow-[0_1px_2px_rgba(17,17,19,0.08)]"
          : onClick
            ? "hover:bg-muted/60"
            : "",
        isDragging ? "opacity-40" : "opacity-100"
      )}
    >
      {dragProps && <GripVertical aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{template.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatLength(template.default_duration_minutes)}
      </span>
    </button>
  );
}

function DraggableTemplateCard({ template }: { template: EditorTemplate }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${template.id}`,
    data: { type: "template", template },
  });

  return (
    <TemplateCard
      template={template}
      innerRef={setNodeRef}
      dragProps={{ ...listeners, ...attributes }}
      isDragging={isDragging}
    />
  );
}
