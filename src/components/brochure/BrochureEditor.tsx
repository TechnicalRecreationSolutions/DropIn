"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import type { Database } from "@/types/database.types";
import type { BrochureCandidate } from "@/lib/brochure/candidates";
import CandidateRail from "./CandidateRail";
import EntryEditDialog from "./EntryEditDialog";
import BrochureSettingsDialog from "./BrochureSettingsDialog";

type Brochure = Database["public"]["Tables"]["brochures"]["Row"];
type Section = Database["public"]["Tables"]["brochure_sections"]["Row"];
type Entry = Database["public"]["Tables"]["brochure_entries"]["Row"];

interface BrochureEditorProps {
  brochure: Brochure;
  seasonName: string | null;
  seasons: { id: string; name: string }[];
  sections: Section[];
  entries: Entry[];
  candidates: BrochureCandidate[];
  canManage: boolean;
  orgId: string;
  orgSlug: string;
}

/** Where an entry can be dropped. `null` is the unfiled tray. */
const UNFILED = "unfiled";

/**
 * The brochure workspace: sections down the middle, suggestions on the right,
 * removed items underneath.
 *
 * DRAG MOVES BETWEEN SECTIONS; BUTTONS ORDER WITHIN ONE. `@dnd-kit/sortable`
 * is not a dependency here and the brief asks not to add packages casually, so
 * dragging uses `@dnd-kit/core` for the coarse action it is genuinely good at —
 * "this belongs in that section" — and ordering uses explicit up/down controls.
 * That is also the better call for the mobile-first requirement: drag-to-sort
 * on a touch screen inside a scrolling column is unreliable, and arrows are not.
 *
 * Mutations are optimistic-free: every write posts and then `router.refresh()`
 * re-reads the server. A brochure is small, the writes are infrequent and
 * deliberate, and getting reorder-plus-move right optimistically is a class of
 * bug that would only ever show up as someone's arrangement quietly wrong.
 */
export default function BrochureEditor({
  brochure,
  seasonName,
  seasons,
  sections,
  entries,
  candidates,
  canManage,
  orgId,
  orgSlug,
}: BrochureEditorProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  const included = useMemo(() => entries.filter((e) => e.status === "included"), [entries]);
  const dismissed = useMemo(() => entries.filter((e) => e.status === "dismissed"), [entries]);
  const unfiled = useMemo(() => included.filter((e) => e.section_id === null), [included]);

  const entriesBySection = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const section of sections) map.set(section.id, []);
    for (const entry of included) {
      if (entry.section_id && map.has(entry.section_id)) map.get(entry.section_id)!.push(entry);
    }
    return map;
  }, [sections, included]);

  async function post(url: string, body: unknown, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function handlePull(sourceIds: string[], sectionId: string | null) {
    await post("/api/brochures/pull", { brochureId: brochure.id, sectionId, sourceIds });
  }

  async function addSection() {
    if (!newSectionTitle.trim()) return;
    const ok = await post("/api/brochures/sections", {
      brochureId: brochure.id,
      title: newSectionTitle.trim(),
    });
    if (ok) setNewSectionTitle("");
  }

  /** Reorders one section's entries by moving `entryId` up or down within it. */
  async function nudge(entry: Entry, direction: -1 | 1) {
    const siblings = entry.section_id ? (entriesBySection.get(entry.section_id) ?? []) : unfiled;
    const index = siblings.findIndex((e) => e.id === entry.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;

    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    await post("/api/brochures/entries", {
      brochureId: brochure.id,
      sectionId: entry.section_id,
      order: reordered.map((e) => e.id),
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const entryId = String(event.active.id);
    const over = event.over?.id;
    if (!over) return;

    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    const nextSectionId = over === UNFILED ? null : String(over);
    if (nextSectionId === entry.section_id) return;

    // Appended to the destination rather than inserted at a position: the drop
    // target is a whole section, so there is no meaningful index to infer.
    const destination = nextSectionId
      ? (entriesBySection.get(nextSectionId) ?? [])
      : unfiled;

    await post("/api/brochures/entries", {
      brochureId: brochure.id,
      sectionId: nextSectionId,
      order: [...destination.map((e) => e.id), entry.id],
    });
  }

  async function setStatus(entry: Entry, status: "included" | "dismissed") {
    await post("/api/brochures/entries", { entryId: entry.id, status });
  }

  async function publish(next: "draft" | "published" | "archived") {
    await post("/api/brochures", { brochureId: brochure.id, title: brochure.title, status: next });
  }

  const publicHref = `/org/${orgSlug}/brochure/${brochure.slug}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{brochure.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {seasonName ?? "No season"} · {included.length}{" "}
            {included.length === 1 ? "entry" : "entries"} ·{" "}
            <span className="capitalize">{brochure.status}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Pencil className="w-4 h-4" />
            Details
          </Button>
          {brochure.status === "published" && (
            <a
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              View <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {canManage &&
            (brochure.status === "published" ? (
              <Button variant="outline" onClick={() => publish("draft")} disabled={busy}>
                Unpublish
              </Button>
            ) : (
              <Button onClick={() => publish("published")} disabled={busy || included.length === 0}>
                Publish
              </Button>
            ))}
        </div>
      </div>

      {included.length === 0 && brochure.status !== "published" && (
        <p className="text-xs text-gray-500">
          Add something from Suggested before publishing — an empty brochure has nothing to show.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="order-2 lg:order-1 space-y-4">
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                entries={entriesBySection.get(section.id) ?? []}
                busy={busy}
                onEdit={setEditingEntry}
                onDismiss={(entry) => setStatus(entry, "dismissed")}
                onNudge={nudge}
                onDelete={() =>
                  post(`/api/brochures/sections?sectionId=${section.id}`, null, "DELETE")
                }
              />
            ))}

            <DropZone id={UNFILED} label="Unfiled">
              {unfiled.length === 0 ? (
                <p className="text-xs text-gray-400 py-3">
                  Anything added without a section lands here. Drag it into one.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {unfiled.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      busy={busy}
                      onEdit={setEditingEntry}
                      onDismiss={(e) => setStatus(e, "dismissed")}
                      onNudge={nudge}
                    />
                  ))}
                </ul>
              )}
            </DropZone>

            {/* Add a section */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSection();
                  }
                }}
                placeholder="New section, e.g. Aquatics"
                maxLength={120}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button variant="outline" onClick={addSection} disabled={busy || !newSectionTitle.trim()}>
                <Plus className="w-4 h-4" />
                Add section
              </Button>
            </div>

            {/* Tombstones. Visible on purpose — an invisible decision is one
                nobody can undo, and the rail points here. */}
            {dismissed.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                <h3 className="text-sm font-semibold text-gray-700">Removed</h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">
                  Kept out of this brochure, including when you add everything again. Other
                  brochures are unaffected.
                </p>
                <ul className="space-y-1">
                  {dismissed.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 truncate text-gray-500">{entry.title}</span>
                      <button
                        type="button"
                        onClick={() => setStatus(entry, "included")}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DndContext>

        <div className="order-1 lg:order-2">
          <CandidateRail
            candidates={candidates}
            sections={sections.map((s) => ({ id: s.id, title: s.title }))}
            onPull={handlePull}
            pulling={busy}
            seasonName={seasonName}
          />
        </div>
      </div>

      <EntryEditDialog
        entry={editingEntry}
        orgId={orgId}
        onClose={() => setEditingEntry(null)}
        onSaved={() => {
          setEditingEntry(null);
          router.refresh();
        }}
      />

      <BrochureSettingsDialog
        open={settingsOpen}
        brochure={brochure}
        seasons={seasons}
        orgId={orgId}
        canManage={canManage}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          setSettingsOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function SectionCard({
  section,
  entries,
  busy,
  onEdit,
  onDismiss,
  onNudge,
  onDelete,
}: {
  section: Section;
  entries: Entry[];
  busy: boolean;
  onEdit: (entry: Entry) => void;
  onDismiss: (entry: Entry) => void;
  onNudge: (entry: Entry, direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <DropZone
      id={section.id}
      label={section.title}
      action={
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete section ${section.title}`}
          className="p-1 rounded text-gray-400 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 py-3">Nothing here yet. Drag an entry in, or add from Suggested.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              busy={busy}
              onEdit={onEdit}
              onDismiss={onDismiss}
              onNudge={onNudge}
            />
          ))}
        </ul>
      )}
    </DropZone>
  );
}

function DropZone({
  id,
  label,
  action,
  children,
}: {
  id: string;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "rounded-xl border bg-white p-4 transition-colors",
        isOver ? "border-blue-400 bg-blue-50/40" : "border-gray-200"
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-900 flex-1">{label}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function EntryCard({
  entry,
  busy,
  onEdit,
  onDismiss,
  onNudge,
}: {
  entry: Entry;
  busy: boolean;
  onEdit: (entry: Entry) => void;
  onDismiss: (entry: Entry) => void;
  onNudge: (entry: Entry, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id });

  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5",
        isDragging && "opacity-40"
      )}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Move ${entry.title} to another section`}
        className="p-1 rounded text-gray-300 hover:text-gray-500 cursor-grab touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-900 truncate">{entry.title}</span>
        {entry.description && (
          <span className="block text-xs text-gray-400 truncate">{entry.description}</span>
        )}
      </span>

      <span className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onNudge(entry, -1)}
          disabled={busy}
          aria-label={`Move ${entry.title} up`}
          className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-40"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onNudge(entry, 1)}
          disabled={busy}
          aria-label={`Move ${entry.title} down`}
          className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-40"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(entry)}
          aria-label={`Edit ${entry.title}`}
          className="p-1 rounded text-gray-400 hover:text-blue-600"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDismiss(entry)}
          disabled={busy}
          aria-label={`Remove ${entry.title} from this brochure`}
          className="p-1 rounded text-gray-400 hover:text-red-600 disabled:opacity-40"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    </li>
  );
}
