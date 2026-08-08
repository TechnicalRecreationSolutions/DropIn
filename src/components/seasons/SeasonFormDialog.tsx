"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { Season } from "@/lib/seasons/current";

export interface SeasonFormValues {
  name: string;
  description: string;
  starts_on: string;
  ends_on: string;
  status: Season["status"];
}

interface SeasonFormDialogProps {
  open: boolean;
  /** The season being edited, or null to create one. */
  season: Season | null;
  /** Starting values for a create — used by "Duplicate" to seed next year's dates. */
  prefill?: SeasonFormValues;
  onClose: () => void;
  onSaved: (season: Season) => void;
}

const STATUS_OPTIONS: { value: Season["status"]; label: string; hint: string }[] = [
  { value: "planning", label: "Planning", hint: "Only your staff can see it" },
  { value: "active", label: "Published", hint: "Visible to the public" },
  { value: "archived", label: "Archived", hint: "Over, but old links still work" },
];

const EMPTY: SeasonFormValues = {
  name: "",
  description: "",
  starts_on: "",
  ends_on: "",
  status: "planning",
};

/** Create or edit a season. One dialog for both, since the fields are identical. */
export default function SeasonFormDialog({
  open,
  season,
  prefill,
  onClose,
  onSaved,
}: SeasonFormDialogProps) {
  const [values, setValues] = useState<SeasonFormValues>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseed whenever the dialog opens for a different target; once open the
  // form is free-form, so this deliberately keys on identity, not values.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(
      season
        ? {
            name: season.name,
            description: season.description ?? "",
            starts_on: season.starts_on,
            ends_on: season.ends_on,
            status: season.status,
          }
        : (prefill ?? EMPTY)
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, season?.id, prefill]);

  function set<K extends keyof SeasonFormValues>(key: K, value: SeasonFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const datesOrdered = !values.starts_on || !values.ends_on || values.ends_on >= values.starts_on;
  const canSubmit = !!values.name.trim() && !!values.starts_on && !!values.ends_on && datesOrdered;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch(season ? `/api/seasons/${season.id}` : "/api/seasons", {
      method: season ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name.trim(),
        description: values.description.trim() || null,
        starts_on: values.starts_on,
        ends_on: values.ends_on,
        status: values.status,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Could not save this season.");
      return;
    }

    onSaved(body.season as Season);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{season ? `Edit ${season.name}` : "New season"}</DialogTitle>
          <DialogDescription>
            A named period you plan in — a term, a summer, a program year.
          </DialogDescription>
        </DialogHeader>

        <div>
          <label htmlFor="season-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="season-name"
            type="text"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Fall 2026"
            maxLength={80}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="season-starts" className="block text-sm font-medium text-gray-700 mb-1">
              Starts
            </label>
            <input
              id="season-starts"
              type="date"
              value={values.starts_on}
              onChange={(e) => set("starts_on", e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="season-ends" className="block text-sm font-medium text-gray-700 mb-1">
              Ends
            </label>
            <input
              id="season-ends"
              type="date"
              value={values.ends_on}
              min={values.starts_on || undefined}
              onChange={(e) => set("ends_on", e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {!datesOrdered && (
            <p className="text-xs text-red-500 col-span-2 -mt-2">
              The end date must be on or after the start date.
            </p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1.5">Status</span>
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_OPTIONS.map((option) => {
              const selected = values.status === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set("status", option.value)}
                  aria-pressed={selected}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-medium border-2 text-left transition-colors",
                    selected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-200 text-gray-600 hover:border-blue-300"
                  )}
                >
                  <span className="block">{option.label}</span>
                  <span className={cn("block", selected ? "text-blue-100" : "text-gray-400")}>
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="season-description"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Notes <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            id="season-description"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
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
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
            {submitting ? "Saving…" : season ? "Save changes" : "Create season"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
