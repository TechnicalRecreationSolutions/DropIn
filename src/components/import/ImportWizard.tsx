"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, CheckCircle, AlertCircle, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/field";
import type { ImportPreviewRow } from "@/lib/import/rows";

interface ImportWizardProps {
  facilities: { id: string; name: string }[];
  /** When set, import is locked to this facility (and optional department) — hides the facility picker. */
  initialFacilityId?: string;
  initialDepartmentId?: string;
  departmentName?: string;
}

type Step = "upload" | "preview" | "done";

export default function ImportWizard({ facilities, initialFacilityId, initialDepartmentId, departmentName }: ImportWizardProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [facilityId, setFacilityId] = useState(initialFacilityId ?? facilities[0]?.id ?? "");
  const facilityLocked = !!initialFacilityId;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [errorCount, setErrorCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scheduleGroupsCreated: number; sessionsCreated: number } | null>(null);

  async function handleUpload() {
    if (!file || !facilityId) return;
    setLoading(true);
    setError(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("facilityId", facilityId);

    const res = await fetch("/api/import", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) { setError(data.error); setLoading(false); return; }

    setPreview(data.preview);
    setErrorCount(data.errorCount);
    setStep("preview");
    setLoading(false);
  }

  async function handleCommit() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: preview, facilityId, departmentId: initialDepartmentId ?? null }),
    });
    const data = await res.json();

    if (!res.ok) { setError(data.error); setLoading(false); return; }

    setResult({ scheduleGroupsCreated: data.scheduleGroupsCreated, sessionsCreated: data.sessionsCreated });
    setStep("done");
    setLoading(false);
  }

  if (facilities.length === 0) {
    return (
      <Banner variant="warning" role={undefined}>
        You need to <Link href="/dashboard/facilities/new" className="underline font-medium">add a facility</Link> before importing.
      </Banner>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span>›</span>}
            <span className={step === s ? "font-semibold text-brand" : ""}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Upload step */}
      {step === "upload" && (
        <div className="bg-card rounded-card border border-border shadow-card p-6 space-y-5">
          <div>
            <Label>
              {facilityLocked ? "Importing into" : "Facility *"}
            </Label>
            {facilityLocked ? (
              <p className="px-3 py-2.5 text-body text-foreground bg-muted rounded-control">
                {facilities.find((f) => f.id === facilityId)?.name ?? "This facility"}
                {departmentName ? ` › ${departmentName}` : ""}
              </p>
            ) : (
              <NativeSelect
                value={facilityId}
                onChange={(e) => setFacilityId(e.target.value)}
              >
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </NativeSelect>
            )}
          </div>

          {/* File drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-input rounded-card p-10 text-center cursor-pointer hover:border-brand hover:bg-brand-subtle transition-colors duration-150"
          >
            <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-4 h-4 text-brand" />
                <span className="text-body font-medium text-foreground">{file.name}</span>
                <Button variant="ghost" size="icon-xs" aria-label="Remove file" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <p className="text-body font-medium text-foreground">Click to upload a CSV</p>
                <p className="text-caption text-muted-foreground mt-1">
                  Max 10 MB · 500 rows · in Excel, File → Save As → CSV
                </p>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Template download hint */}
          <p className="text-caption text-muted-foreground">
            Columns: <code className="bg-muted px-1 rounded-control">program_name, sport_category, days, start_time, end_time, season_start</code> (optional: activity_type, season_end, cost, location_detail)
          </p>

          {error && <Banner variant="error">{error}</Banner>}

          <Button
            onClick={handleUpload}
            disabled={!file || loading}
            className="w-full"
          >
            {loading ? "Parsing file…" : "Preview import"}
          </Button>
        </div>
      )}

      {/* Preview step */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body font-medium text-foreground">{preview.length} rows · {errorCount} with errors</p>
              <p className="text-caption text-muted-foreground">{preview.length - errorCount} rows will be imported</p>
            </div>
            <Button variant="ghost" onClick={() => setStep("upload")}>
              Back
            </Button>
          </div>

          <div className="bg-card rounded-card border border-border shadow-card overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-caption">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-label text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left text-label text-muted-foreground">Schedule</th>
                    <th className="px-3 py-2 text-left text-label text-muted-foreground">Sport</th>
                    <th className="px-3 py-2 text-left text-label text-muted-foreground">Days</th>
                    <th className="px-3 py-2 text-left text-label text-muted-foreground">Time</th>
                    <th className="px-3 py-2 text-left text-label text-muted-foreground">Season</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((row) => (
                    <tr key={row._index} className={row._errors.length > 0 ? "bg-destructive-subtle" : ""}>
                      <td className="px-3 py-2">
                        {row._errors.length > 0 ? (
                          <span title={row._errors.join(", ")}>
                            <AlertCircle className="w-4 h-4 text-destructive" />
                          </span>
                        ) : (
                          <CheckCircle className="w-4 h-4 text-success" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{row.program_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.sport_category}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.days}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.start_time}–{row.end_time}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.season_start}{row.season_end ? ` → ${row.season_end}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && <Banner variant="error">{error}</Banner>}

          <Button
            onClick={handleCommit}
            disabled={loading || preview.length - errorCount === 0}
            className="w-full"
          >
            {loading ? "Importing…" : `Import ${preview.length - errorCount} rows`}
          </Button>
        </div>
      )}

      {/* Done step */}
      {step === "done" && result && (
        <div className="bg-card rounded-card border border-border shadow-card p-10 text-center">
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <h3 className="text-heading text-foreground mb-1">Import complete</h3>
          <p className="text-muted-foreground text-body">
            {result.scheduleGroupsCreated} schedule{result.scheduleGroupsCreated !== 1 ? "s" : ""} and{" "}
            {result.sessionsCreated} session{result.sessionsCreated !== 1 ? "s" : ""} created.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <Button onClick={() => router.push("/dashboard/schedule")}>
              View schedule
            </Button>
            <Button variant="outline" onClick={() => { setStep("upload"); setFile(null); setPreview([]); setResult(null); }}>
              Import more
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
