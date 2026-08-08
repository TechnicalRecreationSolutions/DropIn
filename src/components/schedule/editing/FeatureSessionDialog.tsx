"use client";

import { useEffect, useState } from "react";
import { CalendarDays, BookOpen } from "lucide-react";
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
import type { ExpandedSession, SessionFeatureContent } from "@/types/schedule.types";

export interface FeatureSubmitValues extends SessionFeatureContent {
  isEvent: boolean;
  inBrochure: boolean;
}

interface FeatureSessionDialogProps {
  session: ExpandedSession | null;
  onCancel: () => void;
  onConfirm: (values: FeatureSubmitValues) => void;
  submitting: boolean;
  error: string | null;
}

const EMPTY: SessionFeatureContent = {
  title: null,
  summary: null,
  description: null,
  imageUrl: null,
  linkUrl: null,
  linkLabel: null,
  eventCategory: null,
  accentColor: null,
};

/**
 * "Feature this session" — the two publishing toggles plus the single payload
 * they share (`session_features`).
 *
 * Deliberately its own dialog rather than a section of the full session edit
 * form. The edit form is about *when and where* a session happens — its
 * recurrence, spaces, and validity window — and it is the only writer of the
 * `sessions` row proper. Featuring is about how a session is *presented*, it
 * writes a different table, and it's reached from the calendar you're looking
 * at rather than from a route away. Keeping them apart also means one write
 * path for feature content instead of two that can disagree.
 *
 * The copy fields stay editable with both toggles off, because the payload
 * outlives the flags on purpose (migration 028, decision 3) — un-featuring in
 * March must not cost you the description you re-feature with in October.
 */
export default function FeatureSessionDialog({
  session,
  onCancel,
  onConfirm,
  submitting,
  error,
}: FeatureSessionDialogProps) {
  const [isEvent, setIsEvent] = useState(false);
  const [inBrochure, setInBrochure] = useState(false);
  const [content, setContent] = useState<SessionFeatureContent>(EMPTY);

  useEffect(() => {
    if (!session) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsEvent(session.isEvent);
    setInBrochure(session.inBrochure);
    setContent(session.feature ?? EMPTY);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [session]);

  if (!session) return null;

  function set<K extends keyof SessionFeatureContent>(key: K, value: string) {
    setContent((prev) => ({ ...prev, [key]: value === "" ? null : value }));
  }

  const fallbackName = session.templateName ?? session.scheduleGroupName;

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Feature &ldquo;{fallbackName}&rdquo;</DialogTitle>
          <DialogDescription>
            Where this session appears beyond the weekly schedule. Both channels share the
            details below, so you only write them once.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ToggleCard
            icon={CalendarDays}
            label="Event calendar"
            hint="Shows on the month-at-a-glance calendar."
            checked={isEvent}
            onChange={setIsEvent}
          />
          <ToggleCard
            icon={BookOpen}
            label="Brochure"
            hint="Offered as a candidate when building a season's brochure."
            checked={inBrochure}
            onChange={setInBrochure}
          />
        </div>

        <Field label="Title" hint={`Leave blank to use “${fallbackName}”.`}>
          <input
            type="text"
            value={content.title ?? ""}
            onChange={(e) => set("title", e.target.value)}
            maxLength={120}
            placeholder={fallbackName}
            className={inputClass}
          />
        </Field>

        <Field label="Summary" hint="One line — this is what fits in a calendar cell.">
          <input
            type="text"
            value={content.summary ?? ""}
            onChange={(e) => set("summary", e.target.value)}
            maxLength={200}
            className={inputClass}
          />
        </Field>

        <Field label="Description" hint="Long copy, for the brochure and the detail view.">
          <textarea
            value={content.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            maxLength={4000}
            rows={3}
            className={cn(inputClass, "resize-y")}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Category" hint="Your own label, e.g. “PD Day”.">
            <input
              type="text"
              value={content.eventCategory ?? ""}
              onChange={(e) => set("eventCategory", e.target.value)}
              maxLength={60}
              className={inputClass}
            />
          </Field>

          <Field label="Accent colour" hint="Falls back to the template colour.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={content.accentColor ?? session.templateColor ?? "#2563eb"}
                onChange={(e) => set("accentColor", e.target.value)}
                className="h-9 w-12 rounded border border-gray-300 bg-white p-0.5"
                aria-label="Accent colour"
              />
              {content.accentColor && (
                <button
                  type="button"
                  onClick={() => setContent((prev) => ({ ...prev, accentColor: null }))}
                  className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                >
                  Reset
                </button>
              )}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Link" hint="Registration, a PDF, your own page.">
            <input
              type="url"
              value={content.linkUrl ?? ""}
              onChange={(e) => set("linkUrl", e.target.value)}
              placeholder="https://"
              className={inputClass}
            />
          </Field>

          <Field label="Link label">
            <input
              type="text"
              value={content.linkLabel ?? ""}
              onChange={(e) => set("linkLabel", e.target.value)}
              maxLength={60}
              placeholder="Register"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Image URL">
          <input
            type="url"
            value={content.imageUrl ?? ""}
            onChange={(e) => set("imageUrl", e.target.value)}
            placeholder="https://"
            className={inputClass}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm({ ...content, isEvent, inBrochure })} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function ToggleCard({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: typeof CalendarDays;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cn(
        "text-left rounded-lg border-2 p-3 transition-colors",
        checked ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-blue-300"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Icon className={cn("w-4 h-4", checked ? "text-blue-600" : "text-gray-400")} />
        {label}
      </span>
      <span className="block text-xs text-gray-500 mt-1">{hint}</span>
    </button>
  );
}
