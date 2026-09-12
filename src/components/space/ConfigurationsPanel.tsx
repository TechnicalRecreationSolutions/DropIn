"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Check, X, Trash2, Pencil } from "lucide-react";

interface ConfigurationRow {
  id: string;
  name: string;
  /** How many of this facility's spaces are assigned to it — the number that
   *  tells staff whether a configuration is actually wired up yet. */
  spaceCount: number;
}

interface ConfigurationsPanelProps {
  facilityId: string;
  facilityName: string;
  configurations: ConfigurationRow[];
}

/**
 * Manages a building's physical configurations (migration 048) — "Long Course
 * (50m)", "Short Course (25m)", "Boards In".
 *
 * Deliberately the *second* panel on the Spaces page, and deliberately quiet
 * when empty: almost no facility has anything reconfigurable, and the ones that
 * do already know they do. Nothing else in the product changes until a
 * configuration exists and spaces are assigned to it, so this panel opens
 * collapsed to a single explanatory line rather than presenting a concept every
 * customer has to understand.
 *
 * Writes go through /api/facility-configurations (owner/admin only) and then
 * `router.refresh()`, so the space list above — which groups by configuration —
 * re-renders from the server rather than from a second copy of this state.
 */
export default function ConfigurationsPanel({
  facilityId,
  facilityName,
  configurations,
}: ConfigurationsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong. Please try again.");
      return false;
    }
    return true;
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const ok = await send("/api/facility-configurations", {
        method: "POST",
        body: JSON.stringify({ facility_id: facilityId, name }),
      });
      if (!ok) return;
      setNewName("");
      setAdding(false);
      router.refresh();
    });
  }

  function handleRename(id: string) {
    const name = editingName.trim();
    if (!name) return;
    startTransition(async () => {
      const ok = await send(`/api/facility-configurations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      if (!ok) return;
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const ok = await send(`/api/facility-configurations/${id}`, { method: "DELETE" });
      if (!ok) return;
      router.refresh();
    });
  }

  const fieldClass =
    "px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Building configurations</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            States {facilityName} can be put into — a bulkhead in or out, boards on or off. Each
            space belongs to one, or to all of them.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add configuration
          </button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 p-3 bg-card rounded-xl border border-border">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Long Course (50m)"
            aria-label="Configuration name"
            className={`${fieldClass} flex-1`}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Check className="w-4 h-4" />
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName("");
              setError(null);
            }}
            aria-label="Cancel"
            className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {configurations.length === 0 ? (
        !adding && (
          <p className="text-xs text-muted-foreground/70">
            None yet — and most buildings never need one. Add a configuration only if the same
            water or floor can be divided up two different ways.
          </p>
        )
      ) : (
        <div className="space-y-2">
          {configurations.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 p-4 bg-card rounded-xl border border-border"
            >
              <Layers className="w-4 h-4 text-muted-foreground/70 shrink-0" />
              {editingId === c.id ? (
                <>
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(c.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label={`Rename ${c.name}`}
                    className={`${fieldClass} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => handleRename(c.id)}
                    disabled={isPending || !editingName.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label="Cancel rename"
                    className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                    {c.name}
                  </span>
                  <span className="text-xs text-muted-foreground/70 shrink-0">
                    {c.spaceCount} space{c.spaceCount !== 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditingName(c.name);
                    }}
                    aria-label={`Rename ${c.name}`}
                    className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {/* No confirmation dialog on purpose: deleting a configuration
                      returns its spaces to "every configuration" (ON DELETE SET
                      NULL) and touches no session — it is a relabelling, and the
                      lanes and their bookings survive it. */}
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    disabled={isPending}
                    aria-label={`Delete ${c.name}`}
                    className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-600 hover:bg-muted disabled:opacity-50 transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground/70">
            Deleting one puts its spaces back into every configuration. Sessions already placed in
            them keep running.
          </p>
        </div>
      )}
    </div>
  );
}
