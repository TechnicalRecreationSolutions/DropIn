"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";

export interface BuilderTemplate {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  default_space_ids: string[];
}

interface TemplatePaletteProps {
  templates: BuilderTemplate[];
  manageTemplatesHref: string;
}

/**
 * Sidebar/drawer of draggable session templates. Drag a card onto a
 * SpaceColumn cell to place a new session. Reuses no existing component —
 * this is the palette side of the new drag-and-drop builder.
 */
export default function TemplatePalette({ templates, manageTemplatesHref }: TemplatePaletteProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Session templates</h2>
        <Link href={manageTemplatesHref} className="text-xs font-medium text-blue-600 hover:text-blue-700">
          Manage
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-xs text-gray-500 mb-2">No templates yet.</p>
          <Link href={manageTemplatesHref} className="text-xs font-medium text-blue-600 hover:text-blue-700">
            Create your first template →
          </Link>
        </div>
      ) : (
        <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          {templates.map((template) => (
            <DraggableTemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4 hidden sm:block">
        Drag a template onto the schedule to place a recurring session there.
      </p>
    </div>
  );
}

function DraggableTemplateCard({ template }: { template: BuilderTemplate }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${template.id}`,
    data: { type: "template", template },
  });

  const color = template.color ?? "#3B82F6";

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex-shrink-0 w-40 sm:w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-grab active:cursor-grabbing touch-none transition-opacity",
        isDragging ? "opacity-40" : "opacity-100 hover:bg-gray-50"
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
