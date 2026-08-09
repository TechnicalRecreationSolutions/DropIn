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

type Brochure = Database["public"]["Tables"]["brochures"]["Row"];

interface BrochureSettingsDialogProps {
  open: boolean;
  brochure: Brochure;
  seasons: { id: string; name: string }[];
  orgId: string;
  /** Editing the brochure itself is owner/admin, unlike its contents. */
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * The brochure's own fields: cover, intro copy, season, accent.
 *
 * Separate from the entry editor because these are the parts a *reader* sees
 * before any entry — and separate from the workspace because they are edited
 * once and then left alone, while entries are worked on continuously.
 */
export default function BrochureSettingsDialog({
  open,
  brochure,
  seasons,
  orgId,
  canManage,
  onClose,
  onSaved,
}: BrochureSettingsDialogProps) {
  const [title, setTitle] = useState(brochure.title);
  const [subtitle, setSubtitle] = useState(brochure.subtitle ?? "");
  const [introCopy, setIntroCopy] = useState(brochure.intro_copy ?? "");
  const [coverUrl, setCoverUrl] = useState<string | null>(brochure.cover_image_url);
  const [seasonId, setSeasonId] = useState(brochure.season_id ?? "");
  const [accent, setAccent] = useState(brochure.accent_color ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTitle(brochure.title);
    setSubtitle(brochure.subtitle ?? "");
    setIntroCopy(brochure.intro_copy ?? "");
    setCoverUrl(brochure.cover_image_url);
    setSeasonId(brochure.season_id ?? "");
    setAccent(brochure.accent_color ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, brochure]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/brochures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brochureId: brochure.id,
        title,
        subtitle: subtitle || null,
        intro_copy: introCopy || null,
        cover_image_url: coverUrl,
        season_id: seasonId || null,
        accent_color: accent || null,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save these details.");
      return;
    }
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Brochure details</DialogTitle>
          <DialogDescription>
            The cover and introduction, plus the season that decides what gets suggested.
          </DialogDescription>
        </DialogHeader>

        {!canManage && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Only owners and admins can change these. You can still add, arrange and edit the
            entries inside the brochure.
          </p>
        )}

        <div>
          <label htmlFor="b-title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input id="b-title" type="text" value={title} maxLength={200} disabled={!canManage}
            onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label htmlFor="b-subtitle" className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
          <input id="b-subtitle" type="text" value={subtitle} maxLength={300} disabled={!canManage}
            onChange={(e) => setSubtitle(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label htmlFor="b-season" className="block text-sm font-medium text-gray-700 mb-1">Season</label>
          <select id="b-season" value={seasonId} disabled={!canManage}
            onChange={(e) => setSeasonId(e.target.value)} className={inputClass}>
            <option value="">No season</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>{season.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Changes what gets suggested. Entries you&rsquo;ve already added are never affected.
          </p>
        </div>

        <div>
          <label htmlFor="b-intro" className="block text-sm font-medium text-gray-700 mb-1">Introduction</label>
          <textarea id="b-intro" value={introCopy} rows={4} maxLength={4000} disabled={!canManage}
            onChange={(e) => setIntroCopy(e.target.value)} className={`${inputClass} resize-y`} />
        </div>

        {canManage && (
          <ImageUpload value={coverUrl} onChange={setCoverUrl} orgId={orgId} kind="brochure" label="Cover image" />
        )}

        <div>
          <label htmlFor="b-accent" className="block text-sm font-medium text-gray-700 mb-1">Accent colour</label>
          <div className="flex items-center gap-2">
            <input id="b-accent" type="color" value={accent || "#0066CC"} disabled={!canManage}
              onChange={(e) => setAccent(e.target.value)}
              className="h-9 w-12 rounded border border-gray-300 bg-white p-0.5" />
            {accent && canManage && (
              <button type="button" onClick={() => setAccent("")}
                className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2">
                Use the org colour
              </button>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          {canManage && (
            <Button onClick={handleSave} disabled={submitting || !title.trim()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500";
