"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, CheckCircle, AlertCircle, FileText, X } from "lucide-react";
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
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        You need to <Link href="/dashboard/facilities/new" className="underline font-medium">add a facility</Link> before importing.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span>›</span>}
            <span className={step === s ? "font-semibold text-blue-600 dark:text-blue-400" : ""}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Upload step */}
      {step === "upload" && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {facilityLocked ? "Importing into" : "Facility *"}
            </label>
            {facilityLocked ? (
              <p className="px-3 py-2.5 text-sm text-foreground bg-muted rounded-lg">
                {facilities.find((f) => f.id === facilityId)?.name ?? "This facility"}
                {departmentName ? ` › ${departmentName}` : ""}
              </p>
            ) : (
              <select
                value={facilityId}
                onChange={(e) => setFacilityId(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
          </div>

          {/* File drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <Upload className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3" />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-foreground">{file.name}</span>
                <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-muted-foreground/70 hover:text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Click to upload a CSV</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
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
          <p className="text-xs text-muted-foreground">
            Columns: <code className="bg-muted px-1 rounded">program_name, sport_category, days, start_time, end_time, season_start</code> (optional: activity_type, season_end, cost, location_detail)
          </p>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Parsing file…" : "Preview import"}
          </button>
        </div>
      )}

      {/* Preview step */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">{preview.length} rows · {errorCount} with errors</p>
              <p className="text-xs text-muted-foreground">{preview.length - errorCount} rows will be imported</p>
            </div>
            <button onClick={() => setStep("upload")} className="text-sm text-muted-foreground hover:text-foreground underline">
              Back
            </button>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="bg-muted border-b border-border sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Schedule</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Sport</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Days</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Time</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Season</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((row) => (
                    <tr key={row._index} className={row._errors.length > 0 ? "bg-red-50" : ""}>
                      <td className="px-3 py-2">
                        {row._errors.length > 0 ? (
                          <span title={row._errors.join(", ")}>
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          </span>
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{row.program_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.sport_category}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.days}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.start_time}–{row.end_time}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.season_start}{row.season_end ? ` → ${row.season_end}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <button
            onClick={handleCommit}
            disabled={loading || preview.length - errorCount === 0}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Importing…" : `Import ${preview.length - errorCount} rows`}
          </button>
        </div>
      )}

      {/* Done step */}
      {step === "done" && result && (
        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-foreground mb-1">Import complete</h3>
          <p className="text-muted-foreground text-sm">
            {result.scheduleGroupsCreated} schedule{result.scheduleGroupsCreated !== 1 ? "s" : ""} and{" "}
            {result.sessionsCreated} session{result.sessionsCreated !== 1 ? "s" : ""} created.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <button onClick={() => router.push("/dashboard/schedule")}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              View schedule
            </button>
            <button onClick={() => { setStep("upload"); setFile(null); setPreview([]); setResult(null); }}
              className="px-4 py-2 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors">
              Import more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
