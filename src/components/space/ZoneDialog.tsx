"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";
import type { CommandSpace } from "@/components/schedule-command/types";
import { cn } from "@/lib/utils/cn";

export interface ZoneDialogTarget {
  facilityId: string;
  /** Null for the "Whole building" section. */
  departmentId: string | null;
  /** The section heading, for the dialog copy. */
  departmentLabel: string;
  /** Every space in the section, in render order — the tick list. */
  spaces: CommandSpace[];
  /** Editing an existing zone; null when creating one. */
  zoneName: string | null;
}

export interface ZoneWrite {
  zoneName: string;
  memberIds: string[];
  previousZoneName: string | null;
}

interface ZoneDialogProps {
  target: ZoneDialogTarget;
  onCancel: () => void;
  /** Called after the server has accepted the write. */
  onSaved: (write: ZoneWrite) => void;
}

/**
 * Name a zone and tick the spaces that belong in it — create, rename, change
 * membership and dissolve are all this one form, because a zone is nothing
 * but the label its member spaces share (migration 054). Before this, the
 * only way to make a zone was to open each lane's edit form and type the
 * same label into each one.
 *
 * The list is the section's spaces only, never the whole building: the
 * Spaces page groups by department before zone, and `/api/spaces/zone`
 * refuses a member from another department for the same reason.
 *
 * Mounted fresh for every open (the parent keys it), so there is no
 * re-seeding to get wrong when the dialog is reopened for a different zone.
 */
export default function ZoneDialog({ target, onCancel, onSaved }: ZoneDialogProps) {
  const isEditing = target.zoneName !== null;

  const [name, setName] = useState(target.zoneName ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        isEditing
          ? target.spaces.filter((s) => (s.zoneName ?? null) === target.zoneName).map((s) => s.id)
          : []
      )
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Labels already used in this section, for the spelling suggestions. Typing
  // an existing name here is a legitimate "add these to that zone" — the two
  // groups merge, exactly as the free-text field on the space form would.
  const existingNames = [
    ...new Set(target.spaces.map((s) => s.zoneName?.trim()).filter((z): z is string => !!z)),
  ].filter((z) => z !== target.zoneName);

  const trimmed = name.trim();
  // A zone with no spaces in it does not exist, so creating one needs at least
  // one tick. Editing down to none is a dissolve, and allowed.
  const invalid = !trimmed || (!isEditing && selected.size === 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(memberIds: string[]) {
    setSubmitting(true);
    setError(null);

    const write: ZoneWrite = {
      zoneName: trimmed,
      memberIds,
      previousZoneName: target.zoneName,
    };

    const res = await fetch("/api/spaces/zone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facility_id: target.facilityId,
        department_id: target.departmentId,
        zone_name: write.zoneName,
        member_ids: write.memberIds,
        ...(write.previousZoneName ? { previous_zone_name: write.previousZoneName } : {}),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save the zone. Please try again.");
      setSubmitting(false);
      return;
    }

    onSaved(write);
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !submitting && onCancel()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && !submitting) void save([...selected]);
          }}
          className="contents"
        >
          <DialogHeader>
            <DialogTitle>{isEditing ? `Edit zone: ${target.zoneName}` : "New zone"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? `Rename the zone, or change which ${target.departmentLabel} spaces are in it.`
                : `Group ${target.departmentLabel} spaces under one heading on this page — for example the lanes of one pool.`}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="zone-dialog-name">Zone name *</Label>
            <Input
              id="zone-dialog-name"
              list="zone-dialog-names"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Main Pool, Gym Floor, Upper Courts"
              maxLength={60}
              required
              autoFocus
            />
            {existingNames.length > 0 && (
              <datalist id="zone-dialog-names">
                {existingNames.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            )}
          </div>

          <fieldset className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <legend className="text-caption font-medium text-foreground">
                Spaces in this zone
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {selected.size} of {target.spaces.length}
                </span>
              </legend>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-brand hover:underline"
                  onClick={() => setSelected(new Set(target.spaces.map((s) => s.id)))}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  None
                </button>
              </div>
            </div>

            <ul className="max-h-64 overflow-y-auto rounded-control border border-border divide-y divide-border">
              {target.spaces.map((space) => {
                const checked = selected.has(space.id);
                const elsewhere =
                  space.zoneName && space.zoneName !== target.zoneName ? space.zoneName : null;
                return (
                  <li key={space.id}>
                    <label
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 min-h-11 cursor-pointer hover:bg-muted/60",
                        checked && "bg-brand-subtle/60"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary shrink-0"
                        checked={checked}
                        onChange={() => toggle(space.id)}
                        data-zone-member={space.id}
                      />
                      <span className="text-sm font-medium text-foreground truncate">{space.name}</span>
                      {/* A space ticked here leaves the zone it is in now — say
                          which, so a lane is not moved out of another pool by
                          accident. Unless the typed name IS that zone: then it
                          is staying put, and "moving from" would be a lie. */}
                      {elsewhere && !(checked && elsewhere === trimmed) && (
                        <span className="ml-auto text-xs text-muted-foreground truncate shrink-0">
                          {checked ? `moving from ${elsewhere}` : `in ${elsewhere}`}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            {!isEditing && selected.size === 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">Tick at least one space.</p>
            )}
          </fieldset>

          {error && <Banner variant="error">{error}</Banner>}

          <DialogFooter className="sm:justify-between">
            {isEditing ? (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={submitting}
                // The spaces stay; only the heading goes.
                onClick={() => void save([])}
              >
                Remove zone
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || invalid}>
                {submitting ? "Saving…" : isEditing ? "Save zone" : "Create zone"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
