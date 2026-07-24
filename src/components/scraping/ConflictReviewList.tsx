"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";

interface ScrapingJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  error_message: string | null;
}

interface ScrapingConflict {
  id: string;
  entity_type: "program" | "session";
  entity_id: string | null;
  field_name: string;
  current_value: string | null;
  scraped_value: string | null;
  resolution: "accepted" | "rejected" | "ignored" | null;
}

interface ConflictReviewListProps {
  job: ScrapingJob;
  initialConflicts: ScrapingConflict[];
}

function describeConflict(conflict: ScrapingConflict): string {
  if (conflict.field_name === "_new") {
    try {
      const parsed = JSON.parse(conflict.scraped_value ?? "{}");
      return parsed.name ?? "New entity";
    } catch {
      return "New entity";
    }
  }
  return conflict.field_name;
}

export default function ConflictReviewList({ job: initialJob, initialConflicts }: ConflictReviewListProps) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (job.status !== "running" && job.status !== "pending") return;

    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/scraping/jobs/${job.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job);
      setConflicts(data.conflicts);
      if (data.job.status === "completed" || data.job.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        router.refresh();
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job.status, job.id, router]);

  async function resolve(conflictIds: string[], resolution: "accepted" | "rejected" | "ignored") {
    setPendingIds((prev) => new Set([...prev, ...conflictIds]));
    setError(null);

    const res = await fetch("/api/scraping/conflicts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conflict_ids: conflictIds, resolution }),
    });
    const data = await res.json();

    setPendingIds((prev) => {
      const next = new Set(prev);
      conflictIds.forEach((id) => next.delete(id));
      return next;
    });

    if (!res.ok) {
      setError(data.error ?? "Could not resolve conflict");
      return;
    }

    if (data.errors?.length) {
      setError(data.errors.join("; "));
    }

    setConflicts((prev) =>
      prev.map((c) => (conflictIds.includes(c.id) ? { ...c, resolution } : c))
    );
  }

  if (job.status === "running" || job.status === "pending") {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500">Scraping in progress…</p>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
        Scrape failed: {job.error_message ?? "Unknown error"}
      </div>
    );
  }

  const unresolved = conflicts.filter((c) => !c.resolution);
  const resolved = conflicts.filter((c) => c.resolution);

  if (conflicts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500">No changes found — everything is already in sync.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {unresolved.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">
              {unresolved.length} unresolved change{unresolved.length === 1 ? "" : "s"}
            </h2>
            <button
              onClick={() => resolve(unresolved.map((c) => c.id), "accepted")}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Accept all
            </button>
          </div>

          <ul className="divide-y divide-gray-100">
            {unresolved.map((conflict) => (
              <li key={conflict.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {conflict.entity_type} · {describeConflict(conflict)}
                  </p>
                  {conflict.field_name !== "_new" && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      <span className="line-through">{conflict.current_value ?? "(empty)"}</span>
                      {" → "}
                      <span className="text-gray-900">{conflict.scraped_value ?? "(empty)"}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => resolve([conflict.id], "accepted")}
                    disabled={pendingIds.has(conflict.id)}
                    title="Accept"
                    className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => resolve([conflict.id], "rejected")}
                    disabled={pendingIds.has(conflict.id)}
                    title="Reject"
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => resolve([conflict.id], "ignored")}
                    disabled={pendingIds.has(conflict.id)}
                    title="Ignore"
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                  >
                    <MinusCircle className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {resolved.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Resolved ({resolved.length})</h2>
          <ul className="divide-y divide-gray-100">
            {resolved.map((conflict) => (
              <li key={conflict.id} className="py-2 flex items-center justify-between text-sm text-gray-500">
                <span>{conflict.entity_type} · {describeConflict(conflict)}</span>
                <span className="capitalize">{conflict.resolution}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
