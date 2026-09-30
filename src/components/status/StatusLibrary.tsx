"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import {
  CATEGORY_LABEL,
  NOTICE_CATEGORIES,
  NOTICE_SEVERITIES,
  SEVERITY_LABEL,
} from "@/lib/status/notices";
import { templatesFor, type StatusTemplate } from "@/lib/status/templates";
import type { NoticeCategory, NoticeSeverity } from "@/types/app.types";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldHelp, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SeverityDot } from "./SeverityDot";

/**
 * Settings › Statuses — the organization's status library (migration 064).
 *
 * The list is filterable by department so a manager can see exactly what a
 * tennis coordinator will be offered, which is the question this page exists
 * to answer. Editing happens in a dialog; the list stays one line per status.
 */

export interface LibraryDepartment {
  id: string;
  name: string;
  facilityName: string;
}

type Form = {
  id: string | null;
  label: string;
  headline: string;
  body: string;
  severity: NoticeSeverity;
  category: NoticeCategory;
  everyDepartment: boolean;
  departmentIds: string[];
};

const EMPTY: Form = {
  id: null,
  label: "",
  headline: "",
  body: "",
  severity: "closure",
  category: "other",
  everyDepartment: true,
  departmentIds: [],
};

const chip =
  "min-h-9 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipOn = "border-brand bg-brand-subtle text-brand-strong";
const chipOff = "border-input bg-card text-foreground hover:bg-muted";

export default function StatusLibrary({
  templates,
  departments,
}: {
  templates: StatusTemplate[];
  departments: LibraryDepartment[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Several buildings can each have an "Aquatics"; name the building only then.
  const facilityCount = new Set(departments.map((d) => d.facilityName)).size;
  const deptLabel = (d: LibraryDepartment) =>
    facilityCount > 1 ? `${d.name} · ${d.facilityName}` : d.name;
  const deptById = new Map(departments.map((d) => [d.id, d]));

  const shown = filter ? templatesFor(templates, filter, [filter]) : templates;

  const byFacility = new Map<string, LibraryDepartment[]>();
  for (const d of departments) {
    byFacility.set(d.facilityName, [...(byFacility.get(d.facilityName) ?? []), d]);
  }

  function edit(t: StatusTemplate | null) {
    setError(null);
    setConfirmDelete(false);
    setForm(
      t
        ? {
            id: t.id,
            label: t.label,
            headline: t.headline,
            body: t.body ?? "",
            severity: t.severity,
            category: t.category,
            everyDepartment: t.departmentIds.length === 0,
            departmentIds: t.departmentIds,
          }
        : { ...EMPTY, ...(filter ? { everyDepartment: false, departmentIds: [filter] } : {}) }
    );
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = await fetch(form.id ? `/api/notice-templates/${form.id}` : "/api/notice-templates", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: form.label.trim(),
        headline: form.headline.trim(),
        body: form.body.trim() || null,
        severity: form.severity,
        category: form.category,
        department_ids: form.everyDepartment ? [] : form.departmentIds,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save the status.");
      return;
    }
    setForm(null);
    router.refresh();
  }

  async function remove() {
    if (!form?.id) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/notice-templates/${form.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not delete the status.");
      return;
    }
    setForm(null);
    router.refresh();
  }

  const invalid =
    !form ||
    !form.label.trim() ||
    !form.headline.trim() ||
    (!form.everyDepartment && form.departmentIds.length === 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {departments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show the statuses one department is offered">
            <button
              type="button"
              aria-pressed={filter === null}
              onClick={() => setFilter(null)}
              className={`${chip} ${filter === null ? chipOn : chipOff}`}
            >
              All
            </button>
            {departments.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={filter === d.id}
                onClick={() => setFilter(d.id)}
                className={`${chip} ${filter === d.id ? chipOn : chipOff}`}
              >
                {deptLabel(d)}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button type="button" onClick={() => edit(null)}>
          <Plus className="size-4" aria-hidden />
          Add a status
        </Button>
      </div>

      {filter && (
        <p className="text-sm text-muted-foreground">
          What {deptLabel(deptById.get(filter)!)} staff are offered when they post: the statuses
          for every department, plus the ones assigned to it.
        </p>
      )}

      {shown.length === 0 ? (
        <div className="rounded-card border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">No statuses here yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Staff can still write their own when posting. Add one to save them the typing.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-card">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => edit(t)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="mt-1.5">
                  <SeverityDot severity={t.severity} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{t.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {SEVERITY_LABEL[t.severity]} · &ldquo;{t.headline}&rdquo;
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {t.departmentIds.length === 0 ? (
                      <Badge variant="default">Every department</Badge>
                    ) : (
                      t.departmentIds.map((id) => {
                        const d = deptById.get(id);
                        return d ? (
                          <Badge key={id} variant="brand">
                            {deptLabel(d)}
                          </Badge>
                        ) : null;
                      })
                    )}
                  </span>
                </span>
                <Pencil className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">Edit</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        {form && (
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit status" : "Add a status"}</DialogTitle>
              <DialogDescription>
                Staff pick it from a list when posting, then can change any of the words.
              </DialogDescription>
            </DialogHeader>

            <form
              id="status-library-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="space-y-4"
            >
              {error && <Banner variant="error">{error}</Banner>}

              <div>
                <Label htmlFor="lib-label">Name in the list *</Label>
                <Input
                  id="lib-label"
                  required
                  maxLength={60}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Courts wet"
                />
              </div>

              <div>
                <Label htmlFor="lib-headline">What patrons read *</Label>
                <Input
                  id="lib-headline"
                  required
                  maxLength={120}
                  value={form.headline}
                  onChange={(e) => setForm({ ...form, headline: e.target.value })}
                  placeholder="Outdoor courts closed — wet surface"
                />
              </div>

              <div>
                <Label htmlFor="lib-body">More detail</Label>
                <Textarea
                  id="lib-body"
                  rows={3}
                  maxLength={1000}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
                <FieldHelp>Blunt beats polite. Don&apos;t promise a reopening time.</FieldHelp>
              </div>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">How serious</legend>
                <div className="flex flex-wrap gap-2">
                  {NOTICE_SEVERITIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={form.severity === s}
                      onClick={() => setForm({ ...form, severity: s })}
                      className={`${chip} flex items-center gap-2 ${form.severity === s ? chipOn : chipOff}`}
                    >
                      <SeverityDot severity={s} />
                      {SEVERITY_LABEL[s]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <Label htmlFor="lib-category">Kind</Label>
                <NativeSelect
                  id="lib-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as NoticeCategory })}
                >
                  {NOTICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {departments.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="mb-1.5 text-sm font-medium text-foreground">Offered to</legend>
                  <label className="flex items-center gap-2.5 text-sm">
                    <input
                      type="radio"
                      name="lib-scope"
                      checked={form.everyDepartment}
                      onChange={() => setForm({ ...form, everyDepartment: true })}
                      className="size-4 accent-primary"
                    />
                    Every department
                  </label>
                  <label className="flex items-center gap-2.5 text-sm">
                    <input
                      type="radio"
                      name="lib-scope"
                      checked={!form.everyDepartment}
                      onChange={() => setForm({ ...form, everyDepartment: false })}
                      className="size-4 accent-primary"
                    />
                    Only these departments
                  </label>

                  {!form.everyDepartment && (
                    <div className="space-y-3 rounded-control border border-border p-3">
                      {[...byFacility.entries()].map(([facilityName, depts]) => (
                        <div key={facilityName}>
                          {facilityCount > 1 && (
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              {facilityName}
                            </p>
                          )}
                          <div className="space-y-1.5">
                            {depts.map((d) => (
                              <label key={d.id} className="flex items-center gap-2.5 text-sm">
                                <input
                                  type="checkbox"
                                  checked={form.departmentIds.includes(d.id)}
                                  onChange={(e) =>
                                    setForm({
                                      ...form,
                                      departmentIds: e.target.checked
                                        ? [...form.departmentIds, d.id]
                                        : form.departmentIds.filter((x) => x !== d.id),
                                    })
                                  }
                                  className="size-4 accent-primary"
                                />
                                {d.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      {form.departmentIds.length === 0 && (
                        <p className="text-xs text-destructive">Pick at least one department.</p>
                      )}
                    </div>
                  )}
                </fieldset>
              )}
            </form>

            <DialogFooter className="sm:justify-between">
              {form.id ? (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Delete it?</span>
                    <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={busy}>
                      Delete
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setConfirmDelete(true)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Removes it from the list. Statuses already posted from it are not affected."
                  >
                    Delete
                  </Button>
                )
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" form="status-library-form" disabled={busy || invalid}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
