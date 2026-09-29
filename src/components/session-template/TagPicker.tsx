"use client";

import { useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeLuminance } from "@/lib/utils/color";

export interface TagOption {
  id: string;
  label: string;
  color: string;
}

interface TagPickerProps {
  facilityId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /**
   * Fires with the facility's whole vocabulary on load, and again after a tag
   * is created here. The form uses it to draw the live card preview, which
   * needs each selected tag's label and colour — `selectedIds` alone is only
   * enough to save, not to show anyone what they are building.
   */
  onVocabularyChange?: (tags: TagOption[]) => void;
}

const TAG_COLORS = [
  "#DC2626", // red
  "#EA580C", // orange
  "#CA8A04", // amber
  "#16A34A", // green
  "#0891B2", // cyan
  "#2563EB", // blue
  "#7C3AED", // violet
  "#DB2777", // pink
  "#4B5563", // grey
];

function textOn(background: string): string {
  return relativeLuminance(background) > 0.4 ? "#1f2937" : "#ffffff";
}

/**
 * Picks tags for a template from the facility's vocabulary, and adds to that
 * vocabulary when the word staff want isn't in it yet.
 *
 * Creating from here is deliberate — sending someone to a separate admin screen
 * mid-form is how you end up with a free-text field instead — but it creates
 * through POST /api/tags like anything else, so the case-insensitive uniqueness
 * constraint still applies. Type a word the facility already has in another
 * capitalisation and you get told, rather than quietly minting the duplicate
 * that makes a printed legend useless.
 *
 * Order matters and is the order of `selectedIds`: the first two reach a
 * session card, the rest only the detail modal.
 */
export default function TagPicker({
  facilityId,
  selectedIds,
  onChange,
  onVocabularyChange,
}: TagPickerProps) {
  const [tags, setTags] = useState<TagOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tags?facilityId=${facilityId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTags(data.tags ?? []);
        onVocabularyChange?.(data.tags ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `onVocabularyChange` is required to be stable by the parent (useCallback);
    // an inline arrow would make this effect refetch the vocabulary every render.
  }, [facilityId, onVocabularyChange]);

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((t) => t !== id) : [...selectedIds, id]
    );
  }

  async function createTag(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;

    setSaving(true);
    setError(null);

    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facility_id: facilityId, label, color: newColor }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Could not create that tag.");
      setSaving(false);
      return;
    }

    // Both calls sit outside any updater function. Notifying the parent from
    // inside `setTags(prev => …)` reads as the natural place to do it and is a
    // real bug: React may invoke an updater during render, so the parent's
    // setState lands mid-render and warns "Cannot update a component while
    // rendering a different component". Updaters have to stay pure.
    const next = [...tags, data.tag];
    setTags(next);
    onVocabularyChange?.(next);
    // Selected immediately — nobody adds a word to the vocabulary mid-form for
    // a template they did not want it on.
    onChange([...selectedIds, data.tag.id]);
    setNewLabel("");
    setCreating(false);
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-sm font-medium text-foreground">Tags</p>
        <InfoTip>
          Shown on every session placed from this template, in all views and on the printed board. The
          first two appear on the card, the rest in the session details. Tags replace the asterisks and
          colour keys of a printed schedule.
        </InfoTip>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tags…</p>
      ) : (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {tags.map((tag) => {
              const selected = selectedIds.includes(tag.id);
              const position = selectedIds.indexOf(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected ? "border-transparent" : "border-border opacity-60 hover:opacity-100"
                  )}
                  style={
                    selected
                      ? { backgroundColor: tag.color, color: textOn(tag.color) }
                      : { color: tag.color }
                  }
                  aria-pressed={selected}
                >
                  {selected && <Check className="w-3 h-3 shrink-0" />}
                  {tag.label}
                  {/* Only the first two reach a card, so which position a tag
                      holds is real information, not decoration. */}
                  {selected && position < 2 && (
                    <span className="text-[9px] opacity-80">on card</span>
                  )}
                </button>
              );
            })}

            {!creating && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreating(true)}
                className="border-dashed text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-3 h-3" />
                New tag
              </Button>
            )}
          </div>

          {tags.length === 0 && !creating && (
            <p className="text-xs text-muted-foreground mt-1">No tags yet for this facility.</p>
          )}

          {creating && (
            // Not a nested <form>: this component is rendered inside the
            // template form, and nesting them is invalid HTML that makes the
            // inner submit save the outer one.
            <div className="mt-3 p-3 rounded-banner bg-muted">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createTag(e);
                    }
                  }}
                  maxLength={40}
                  autoFocus
                  placeholder="Women's Only, 55+, Lessons"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setCreating(false);
                    setNewLabel("");
                    setError(null);
                  }}
                  className="text-muted-foreground hover:bg-card"
                  aria-label="Cancel new tag"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {TAG_COLORS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setNewColor(preset)}
                    className={cn(
                      "w-6 h-6 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
                      newColor === preset && "ring-2 ring-ring ring-offset-2 ring-offset-muted scale-110"
                    )}
                    style={{ backgroundColor: preset }}
                    aria-label={`Use colour ${preset}`}
                    aria-pressed={newColor === preset}
                  />
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={createTag}
                disabled={saving || !newLabel.trim()}
                className="mt-3 w-full"
              >
                {saving ? "Adding…" : "Add to this facility's tags"}
              </Button>

              {error && (
                <p role="alert" className="text-xs text-destructive mt-2">
                  {error}
                </p>
              )}
            </div>
          )}

        </>
      )}
    </div>
  );
}
