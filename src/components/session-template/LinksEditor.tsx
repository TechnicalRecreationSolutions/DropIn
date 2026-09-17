"use client";

import { Plus, Trash2, ArrowUp } from "lucide-react";
import { MAX_TEMPLATE_LINKS } from "@/lib/sessions/templateRelations";

export interface LinkDraft {
  label: string;
  url: string;
}

interface LinksEditorProps {
  links: LinkDraft[];
  onChange: (links: LinkDraft[]) => void;
}

/**
 * Edits a template's registration links — at most `MAX_TEMPLATE_LINKS`, ordered.
 *
 * The label is a required field and gets the wider input, because it is the
 * only part a visitor ever sees. "Register here" is actionable;
 * "https://anc.ca.saanich.bc.ca/mrmfinal/..." is noise on screen and unusable
 * on the printed schedule this product exists to replace.
 *
 * Order is the array order and is reordered by promotion rather than
 * drag-and-drop: there are at most three rows, and a dnd-kit context for three
 * rows costs more than it returns.
 */
export default function LinksEditor({ links, onChange }: LinksEditorProps) {
  function update(index: number, patch: Partial<LinkDraft>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  function remove(index: number) {
    onChange(links.filter((_, i) => i !== index));
  }

  function promote(index: number) {
    if (index === 0) return;
    const next = [...links];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  const fieldClass =
    "w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div>
      <p className="block text-sm font-medium text-foreground mb-1">Registration links</p>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">
          None yet — add one if this activity needs a booking or registration page.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link, index) => (
            <li key={index} className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <input
                  type="text"
                  value={link.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  maxLength={60}
                  required
                  placeholder="Register here"
                  aria-label={`Link ${index + 1} label`}
                  className={fieldClass}
                />
                <input
                  type="url"
                  value={link.url}
                  onChange={(e) => update(index, { url: e.target.value })}
                  required
                  placeholder="https://…"
                  aria-label={`Link ${index + 1} URL`}
                  className={`${fieldClass} font-mono text-xs`}
                />
              </div>
              <div className="flex flex-col gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => promote(index)}
                  disabled={index === 0}
                  className="p-2 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-30"
                  aria-label={`Move link ${index + 1} up`}
                  title="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="p-2 rounded-lg hover:bg-red-50 text-red-600"
                  aria-label={`Remove link ${index + 1}`}
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {links.length < MAX_TEMPLATE_LINKS && (
        <button
          type="button"
          onClick={() => onChange([...links, { label: "", url: "" }])}
          className="mt-2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 border-dashed border-border text-muted-foreground hover:border-blue-300 hover:text-foreground transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add link
        </button>
      )}

      <p className="text-xs text-muted-foreground mt-1">
        Up to {MAX_TEMPLATE_LINKS}. Shown as buttons in the session details, opening in a new tab.
        The label is what visitors read — the address itself is never shown.
      </p>
    </div>
  );
}
