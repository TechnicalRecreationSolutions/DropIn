"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ImageUpload from "@/components/media/ImageUpload";
import type { Database } from "@/types/database.types";

type Entry = Database["public"]["Tables"]["brochure_entries"]["Row"];

interface EntryEditDialogProps {
  entry: Entry | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Edits an entry's own copy.
 *
 * Nothing here touches the session or program the entry came from. The copy was
 * snapshotted at pull time and now belongs to the brochure — rewording an entry
 * must not rewrite the source, and re-pulling is the only direction copy ever
 * flows back (migration 031, publication freezing).
 *
 * The dialog says so, because "edit" in every other part of this app does write
 * through to the underlying thing.
 */
export default function EntryEditDialog({ entry, orgId, onClose, onSaved }: EntryEditDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTitle(entry.title);
    setDescription(entry.description ?? "");
    setImageUrl(entry.image_url);
    setLinkUrl(entry.link_url ?? "");
    setLinkLabel(entry.link_label ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [entry]);

  if (!entry) return null;

  async function handleSave() {
    if (!entry) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/brochures/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryId: entry.id,
        title,
        description,
        image_url: imageUrl,
        link_url: linkUrl,
        link_label: linkLabel,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save this entry.");
      return;
    }
    onSaved();
  }

  const sourceLabel =
    entry.source_type === "session"
      ? "a session"
      : entry.source_type === "schedule_group"
        ? "a program"
        : null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
          <DialogDescription>
            {sourceLabel
              ? `Pulled from ${sourceLabel}. Edits here stay in this brochure — they don't change the original.`
              : "A custom entry, belonging to this brochure only."}
          </DialogDescription>
        </DialogHeader>

        <div>
          <label htmlFor="entry-title" className="block text-sm font-medium text-gray-700 mb-1">
            Title
          </label>
          <input
            id="entry-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="entry-description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="entry-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={4000}
            className={`${inputClass} resize-y`}
          />
        </div>

        <ImageUpload
          value={imageUrl}
          onChange={setImageUrl}
          orgId={orgId}
          kind="brochure"
          label="Image"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="entry-link" className="block text-sm font-medium text-gray-700 mb-1">
              Link
            </label>
            <input
              id="entry-link"
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="entry-link-label" className="block text-sm font-medium text-gray-700 mb-1">
              Link label
            </label>
            <input
              id="entry-link-label"
              type="text"
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              maxLength={60}
              placeholder="Register"
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting || !title.trim()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";
