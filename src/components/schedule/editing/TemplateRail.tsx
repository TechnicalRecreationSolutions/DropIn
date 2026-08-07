"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
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
 */
export default function TemplateRail({
  templates,
  manageTemplatesHref,
  draggable,
  onTemplateClick,
}: TemplateRailProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Session templates</h2>
        {manageTemplatesHref && (
          <Link
            href={manageTemplatesHref}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Manage
          </Link>
        )}
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-gray-500 mb-2">
            {manageTemplatesHref
              ? "No templates yet."
              : "Pick a single schedule above to place sessions."}
          </p>
          {manageTemplatesHref && (
            <Link
              href={manageTemplatesHref}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Create your first template →
            </Link>
          )}
        </div>
      ) : (
        <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
          {templates.map((template) =>
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

      {templates.length > 0 && (
        <p className="text-xs text-gray-400 mt-4 hidden lg:block">
          {draggable
            ? "Drag a template onto a space and time to place it."
            : "Click a template, or a day's +, to place a session."}
        </p>
      )}
    </div>
  );
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
  const color = template.color ?? "#3B82F6";

  return (
    <button
      type="button"
      ref={innerRef}
      onClick={onClick}
      {...dragProps}
      className={cn(
        "flex-shrink-0 w-40 lg:w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-opacity",
        dragProps ? "cursor-grab active:cursor-grabbing touch-none" : onClick ? "hover:bg-gray-50" : "",
        isDragging ? "opacity-40" : "opacity-100"
      )}
      style={{ borderColor: color, borderLeftWidth: 4 }}
    >
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{template.name}</p>
        <p className="text-xs text-gray-500">{template.default_duration_minutes} min</p>
      </div>
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
