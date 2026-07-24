"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Play, Power, Trash2 } from "lucide-react";

interface ScrapingConfig {
  id: string;
  facility_id: string | null;
  source_url: string;
  platform: "xplor" | "activenet" | "nextrec" | "generic";
  schedule_cron: string;
  is_active: boolean;
  last_run_at: string | null;
}

interface ScrapingJob {
  id: string;
  config_id: string;
  status: "pending" | "running" | "completed" | "failed";
  triggered_by: "scheduler" | "manual";
  programs_found: number;
  sessions_found: number;
  conflicts_count: number;
  error_message: string | null;
  created_at: string;
}

interface Facility {
  id: string;
  name: string;
}

interface ScrapingClientProps {
  initialConfigs: ScrapingConfig[];
  facilities: Facility[];
  initialJobs: ScrapingJob[];
}

const STATUS_STYLES: Record<ScrapingJob["status"], string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export default function ScrapingClient({ initialConfigs, facilities, initialJobs }: ScrapingClientProps) {
  const router = useRouter();
  const [configs, setConfigs] = useState(initialConfigs);
  const [jobs, setJobs] = useState(initialJobs);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);

  const [sourceUrl, setSourceUrl] = useState("");
  const [platform, setPlatform] = useState<ScrapingConfig["platform"]>("generic");
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleCreateConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/scraping/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: sourceUrl, platform, facility_id: facilityId || null }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Could not create scraping config");
      setSaving(false);
      return;
    }

    setConfigs((prev) => [data.config, ...prev]);
    setSourceUrl("");
    setShowForm(false);
    setSaving(false);
  }

  async function handleToggleActive(config: ScrapingConfig) {
    const res = await fetch(`/api/scraping/configs/${config.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !config.is_active }),
    });
    const data = await res.json();
    if (res.ok) {
      setConfigs((prev) => prev.map((c) => (c.id === config.id ? data.config : c)));
    }
  }

  async function handleDelete(configId: string) {
    const res = await fetch(`/api/scraping/configs/${configId}`, { method: "DELETE" });
    if (res.ok) {
      setConfigs((prev) => prev.filter((c) => c.id !== configId));
    }
  }

  async function handleTrigger(configId: string) {
    setTriggering(configId);
    setError(null);

    const res = await fetch("/api/scraping/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config_id: configId }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Could not start scraping run");
      setTriggering(null);
      return;
    }

    router.push(`/dashboard/scraping/${data.job_id}`);
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {/* Configs */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Scraping sources</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add source
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreateConfig} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Source URL</label>
              <input
                type="url"
                required
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://yourfacility.xplorrecreation.com/schedule"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as ScrapingConfig["platform"])}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  <option value="generic">Generic</option>
                  <option value="xplor">Xplor</option>
                  <option value="activenet">ActiveNet</option>
                  <option value="nextrec">NextRec</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Facility</label>
                <select
                  value={facilityId}
                  onChange={(e) => setFacilityId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving || !facilityId}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save source"}
            </button>
          </form>
        )}

        {configs.length === 0 ? (
          <p className="text-sm text-gray-500">No scraping sources yet. Add one to start syncing automatically.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {configs.map((config) => (
              <li key={config.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{config.source_url}</p>
                  <p className="text-xs text-gray-500">
                    {config.platform} · {config.is_active ? "Active" : "Paused"}
                    {config.last_run_at && ` · Last run ${new Date(config.last_run_at).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleTrigger(config.id)}
                    disabled={triggering === config.id}
                    title="Run now"
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(config)}
                    title={config.is_active ? "Pause" : "Activate"}
                    className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(config.id)}
                    title="Delete"
                    className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Job history */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Recent runs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-500">No scraping runs yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/dashboard/scraping/${job.id}`}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[job.status]}`}>
                      {job.status}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {new Date(job.created_at).toLocaleString()} · {job.triggered_by}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">
                    {job.status === "completed" &&
                      `${job.programs_found} programs, ${job.sessions_found} sessions, ${job.conflicts_count} conflicts`}
                    {job.status === "failed" && (job.error_message ?? "Failed")}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
