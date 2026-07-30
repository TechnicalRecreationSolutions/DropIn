import Link from "next/link";
import type { BuilderTemplate } from "./TemplatePalette";

interface TemplateLegendProps {
  templates: BuilderTemplate[];
  manageTemplatesHref: string;
}

/**
 * Read-only color key for the List builder — List has no spatial surface
 * to drag a template onto, so this is purely a legend (not draggable, no
 * dnd-kit involvement at all). Creating a session in List happens via the
 * "+ Add session" button in each day's section instead.
 */
export default function TemplateLegend({ templates, manageTemplatesHref }: TemplateLegendProps) {
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
        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: template.color ?? "#3B82F6" }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{template.name}</p>
                <p className="text-xs text-gray-500">{template.default_duration_minutes} min</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
