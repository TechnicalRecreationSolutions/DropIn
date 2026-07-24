"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import RRuleBuilder from "./RRuleBuilder";

interface SessionFormProps {
  programs: { id: string; name: string; facility_name: string }[];
  defaultProgramId?: string;
}

const TIMEZONES = [
  "America/Vancouver",
  "America/Edmonton",
  "America/Regina",
  "America/Winnipeg",
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
];

export default function SessionForm({ programs, defaultProgramId }: SessionFormProps) {
  const router = useRouter();

  const [programId, setProgramId] = useState(defaultProgramId ?? programs[0]?.id ?? "");
  const [rrule, setRrule] = useState("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [timezone, setTimezone] = useState("America/Edmonton");
  const [locationDetail, setLocationDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validFrom) { setError("Season start date is required."); return; }
    if (!startTime || !endTime) { setError("Start and end time are required."); return; }
    if (startTime >= endTime) { setError("End time must be after start time."); return; }

    setLoading(true);

    // Build dtstart: combine validFrom date with startTime in the chosen timezone
    // We store as UTC-equivalent ISO string — the timezone field preserves local intent
    const dtstart = new Date(`${validFrom}T${startTime}:00`).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program_id: programId,
        rrule,
        dtstart,
        dtend_time: endTime,
        timezone,
        valid_from: validFrom,
        valid_until: validUntil || null,
        location_detail: locationDetail || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    router.push("/dashboard/schedule");
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
      {programs.length === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          You need to <a href="/dashboard/programs/new" className="underline font-medium">add a program</a> before creating sessions.
        </div>
      )}

      {/* Program selector */}
      <div>
        <label htmlFor="program_id" className={labelClass}>Program *</label>
        <select
          id="program_id"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          required
          className={fieldClass}
        >
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.facility_name}
            </option>
          ))}
        </select>
      </div>

      {/* RRule builder handles days, times, and season dates */}
      <div className="border-t border-gray-100 pt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Recurrence</h3>
        <RRuleBuilder
          value={rrule}
          startTime={startTime}
          endTime={endTime}
          validFrom={validFrom}
          validUntil={validUntil}
          onRRuleChange={setRrule}
          onStartTimeChange={setStartTime}
          onEndTimeChange={setEndTime}
          onValidFromChange={setValidFrom}
          onValidUntilChange={setValidUntil}
        />
      </div>

      {/* Timezone + location */}
      <div className="border-t border-gray-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="timezone" className={labelClass}>Timezone</label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={fieldClass}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="location_detail" className={labelClass}>Location detail</label>
          <input
            id="location_detail"
            type="text"
            value={locationDetail}
            onChange={(e) => setLocationDetail(e.target.value)}
            className={fieldClass}
            placeholder="e.g. Lane 3, Rink B, Studio 2"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => router.back()}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || programs.length === 0}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? "Saving…" : "Add session"}
        </button>
      </div>
    </form>
  );
}
