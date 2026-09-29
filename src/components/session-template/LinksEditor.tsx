"use client";

import { Plus, Trash2, ArrowUp } from "lucide-react";
import { MAX_TEMPLATE_LINKS } from "@/lib/sessions/templateRelations";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-sm font-medium text-foreground">Registration links</p>
        <InfoTip>
          Up to {MAX_TEMPLATE_LINKS}. Shown as buttons in the session details. Visitors see the label, not
          the address.
        </InfoTip>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None yet — add one if this activity needs a booking or registration page.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link, index) => (
            <li key={index} className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <Input
                  type="text"
                  value={link.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  maxLength={60}
                  required
                  placeholder="Register here"
                  aria-label={`Link ${index + 1} label`}
                />
                <Input
                  type="url"
                  value={link.url}
                  onChange={(e) => update(index, { url: e.target.value })}
                  required
                  placeholder="https://…"
                  aria-label={`Link ${index + 1} URL`}
                  className="font-mono text-xs md:text-xs"
                />
              </div>
              <div className="flex flex-col gap-1 pt-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => promote(index)}
                  disabled={index === 0}
                  className="text-muted-foreground"
                  aria-label={`Move link ${index + 1} up`}
                  title="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove link ${index + 1}`}
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {links.length < MAX_TEMPLATE_LINKS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...links, { label: "", url: "" }])}
          className="mt-2"
        >
          <Plus className="w-3 h-3" />
          Add link
        </Button>
      )}

    </div>
  );
}
