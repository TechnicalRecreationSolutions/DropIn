"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { departmentsHref } from "@/lib/schedule/commandCentreHref";
import { useQueryClient } from "@tanstack/react-query";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { useSectionDirty } from "@/components/department/section-dirty";

interface FacilityOption {
  id: string;
  name: string;
}

interface DepartmentFormProps {
  /** Fixed when created from a facility's page; otherwise staff must pick one. */
  facilityId?: string;
  /** Required when facilityId is not fixed, so staff can choose which facility this department belongs to. */
  facilities?: FacilityOption[];
  departmentId?: string;
  defaultValues?: {
    name?: string;
    description?: string;
    is_published?: boolean;
  };
  /**
   * Where to send staff after a successful save. Defaults to the Departments
   * page for the created department's facility.
   *
   * `null` means stay put — what the edit page passes, because navigating away
   * from a save here would also take the unsaved hours or holidays sitting on
   * the next tab with it.
   */
  redirectTo?: string | null;
  /** Section heading, shown on surfaces where this form is one panel among
   *  several. Omitted on the standalone "add a department" pages, whose page
   *  title already says what the form is. */
  heading?: string;
}

export default function DepartmentForm({
  facilityId: fixedFacilityId,
  facilities,
  departmentId,
  defaultValues,
  redirectTo,
  heading,
}: DepartmentFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!departmentId;

  const [form, setForm] = useState(() => initialForm(fixedFacilityId, defaultValues));

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Only used when staying put after a save — otherwise the redirect is the
   *  confirmation. */
  const [saved, setSaved] = useState(false);

  // Re-seed when the server hands down different defaults — see the note in
  // components/space/SpaceForm.tsx. Compared by value, because the props are
  // rebuilt on every server render.
  const defaultsKey = JSON.stringify(initialForm(fixedFacilityId, defaultValues));
  const [seededFrom, setSeededFrom] = useState(defaultsKey);
  /** The values currently stored. Usually the server's, but a save that stays
   *  on the page moves it ahead of the props, which only catch up on the next
   *  server render. */
  const [savedKey, setSavedKey] = useState(defaultsKey);
  if (seededFrom !== defaultsKey && !loading) {
    setSeededFrom(defaultsKey);
    setSavedKey(defaultsKey);
    setForm(initialForm(fixedFacilityId, defaultValues));
    setError(null);
  }

  // What "unsaved" means here: different from what is stored. The edit page
  // shows it as a dot on the Details tab, so a change typed and left behind is
  // visible from the other sections.
  const dirty = JSON.stringify(form) !== savedKey;
  useSectionDirty("details", isEditing && dirty);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setSaved(false);
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const facilityId = fixedFacilityId ?? form.facility_id;
    if (!facilityId) {
      setError("Please select a facility.");
      return;
    }

    setLoading(true);

    const res = await fetch(
      isEditing ? `/api/departments/${departmentId}` : "/api/departments",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: facilityId,
          name: form.name,
          description: form.description || null,
          is_published: form.is_published,
        }),
      }
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    // `cacheComponents` hides this route segment on navigation instead of
    // unmounting it, and reuses the same instance next time — so without this
    // the next "Add department" opens holding the one just saved, disabled on
    // "Saving…" forever. See components/space/SpaceForm.tsx for the full note.
    setLoading(false);
    setError(null);
    if (!isEditing) setForm(initialForm(fixedFacilityId, defaultValues));

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });

    // `redirectTo: null` is "stay here" — the edit page passes it because the
    // other two sections save separately and a navigation would take their
    // unsaved edits with it.
    if (redirectTo === null) {
      setSavedKey(JSON.stringify({ ...form, facility_id: facilityId }));
      setSaved(true);
      router.refresh();
      return;
    }

    router.push(redirectTo ?? departmentsHref(facilityId));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-card border border-border bg-card p-5 shadow-card sm:p-6">
      {heading && (
        <div className="flex items-center gap-1.5">
          <h2 className="text-heading text-foreground">{heading}</h2>
          <InfoTip label="About this department">
            The department&apos;s name and description, and whether patrons can see it. Renaming
            it here renames it everywhere — the schedule, the widget and the public pages all
            read this one row.
          </InfoTip>
          {dirty && (
            <Badge variant="warning">
              Unsaved
            </Badge>
          )}
        </div>
      )}

      {!fixedFacilityId && (
        <div>
          <Label htmlFor="facility_id">Facility *</Label>
          <NativeSelect
            id="facility_id"
            name="facility_id"
            required
            value={form.facility_id}
            onChange={handleChange}
          >
            <option value="" disabled>Select a facility…</option>
            {(facilities ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div>
        <Label htmlFor="name">Department name *</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          value={form.name}
          onChange={handleChange}
          placeholder="Aquatics"
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          value={form.description}
          onChange={handleChange}
          placeholder="Optional description..."
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <input
          id="is_published"
          name="is_published"
          type="checkbox"
          checked={form.is_published}
          onChange={handleChange}
          className="size-4 accent-primary"
        />
        <div>
          <label htmlFor="is_published" className="text-sm font-medium text-foreground">
            Publish this department
          </label>
          <p className="text-xs text-muted-foreground">
            Visible on the public Dropin discovery pages.
          </p>
        </div>
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}
      {saved && !dirty && (
        <p role="status" className="text-sm text-success">Saved.</p>
      )}

      {redirectTo === null ? (
        // Staying-put mode: no Cancel, because there is nothing to cancel out
        // of — the page is where the work is. Discard puts the fields back.
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            type="submit"
            disabled={loading || !dirty}
            className="w-full sm:w-auto"
          >
            {loading ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
          {dirty && !loading && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setForm(JSON.parse(savedKey));
                setError(null);
              }}
            >
              <RotateCcw className="size-3.5" />
              Discard changes
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className="flex-1"
          >
            {loading ? "Saving…" : isEditing ? "Save changes" : "Add department"}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * The state this form opens in — shared by the initial `useState`, the
 * re-seed, and the reset after a successful create, so the three can never
 * drift apart.
 */
function initialForm(
  fixedFacilityId: string | undefined,
  defaultValues: DepartmentFormProps["defaultValues"]
) {
  return {
    facility_id: fixedFacilityId ?? "",
    name: defaultValues?.name ?? "",
    description: defaultValues?.description ?? "",
    is_published: defaultValues?.is_published ?? false,
  };
}
