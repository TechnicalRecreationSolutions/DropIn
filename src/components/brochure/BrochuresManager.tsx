"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ExternalLink, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface BrochureListItem {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string;
  status: "draft" | "published" | "archived";
  season_id: string | null;
  season_name: string | null;
  published_at: string | null;
  updated_at: string;
  entry_count: number;
}

interface SeasonOption {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
}

interface BrochuresManagerProps {
  brochures: BrochureListItem[];
  seasons: SeasonOption[];
  canManage: boolean;
  orgSlug: string;
}

const STATUS_STYLES: Record<BrochureListItem["status"], string> = {
  draft: "bg-gray-100 text-gray-600",
  published: "bg-green-50 text-green-700",
  archived: "bg-amber-50 text-amber-700",
};

export default function BrochuresManager({
  brochures,
  seasons,
  canManage,
  orgSlug,
}: BrochuresManagerProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [seasonId, setSeasonId] = useState<string>(seasons[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/brochures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), season_id: seasonId || null }),
    });

    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "Could not create this brochure.");
      return;
    }

    // Straight into the editor: a brochure with no sections and no entries is
    // not something anyone wants to look at in a list.
    router.push(`/dashboard/brochures/${data.brochureId}`);
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            New brochure
          </Button>
        </div>
      )}

      {brochures.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl">
          <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">No brochures yet</p>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            A brochure is built from sessions and programs you&rsquo;ve already entered — flag them
            with &ldquo;Offer for season brochures&rdquo; and they&rsquo;ll be suggested here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {brochures.map((brochure) => (
            <li key={brochure.id}>
              <div className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors">
                <Link href={`/dashboard/brochures/${brochure.id}`} className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{brochure.title}</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full",
                        STATUS_STYLES[brochure.status]
                      )}
                    >
                      {brochure.status}
                    </span>
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {brochure.season_name ?? "No season"} ·{" "}
                    {brochure.entry_count === 0
                      ? "nothing in it yet"
                      : `${brochure.entry_count} ${brochure.entry_count === 1 ? "entry" : "entries"}`}
                  </span>
                </Link>

                {brochure.status === "published" && (
                  <a
                    href={`/org/${orgSlug}/brochure/${brochure.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={(next) => !next && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New brochure</DialogTitle>
            <DialogDescription>
              Pick the season it covers — that decides which sessions and programs get suggested.
              You can change everything else later.
            </DialogDescription>
          </DialogHeader>

          <div>
            <label htmlFor="brochure-title" className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              id="brochure-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Fall 2026 Program Guide"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="brochure-season" className="block text-sm font-medium text-gray-700 mb-1">
              Season
            </label>
            <select
              id="brochure-season"
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">No season</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              {seasons.length === 0
                ? "You haven't defined any seasons. Without one, everything flagged for brochures is suggested."
                : "Only sessions overlapping this season are suggested. Programs are always suggested."}
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={submitting || !title.trim()}>
              {submitting ? "Creating…" : "Create and open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
