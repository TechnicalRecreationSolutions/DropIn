"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import RRuleBuilder from "./RRuleBuilder";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { zonedTimeToUtc } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils/cn";

interface SessionFormProps {
  scheduleGroups: { id: string; name: string; facility_id: string; facility_name: string }[];
  spaces: { id: string; name: string; facility_id: string }[];
  defaultScheduleGroupId?: string;
  /** Present when editing an existing session instead of creating a new one. */
  sessionId?: string;
  initialValues?: {
    rrule: string;
    startTime: string;
    endTime: string;
    validFrom: string;
    validUntil: string;
    timezone: string;
    spaceIds: string[];
    locationDetail: string;
  };
  /** Where to send staff after a successful save/delete. Defaults to /dashboard/schedule. */
  redirectTo?: string;
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

export default function SessionForm({
  scheduleGroups,
  spaces,
  defaultScheduleGroupId,
  sessionId,
  initialValues,
  redirectTo = "/dashboard/schedule",
}: SessionFormProps) {
  const router = useRouter();
  const isEditing = !!sessionId;

  const [scheduleGroupId, setScheduleGroupId] = useState(defaultScheduleGroupId ?? scheduleGroups[0]?.id ?? "");
  const [rrule, setRrule] = useState(initialValues?.rrule ?? "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(initialValues?.endTime ?? "10:00");
  const [validFrom, setValidFrom] = useState(initialValues?.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(initialValues?.validUntil ?? "");
  const [timezone, setTimezone] = useState(initialValues?.timezone ?? "America/Edmonton");
  const [spaceIds, setSpaceIds] = useState<string[]>(initialValues?.spaceIds ?? []);
  const [locationDetail, setLocationDetail] = useState(initialValues?.locationDetail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(!!(initialValues?.timezone || initialValues?.locationDetail));

  const selectedFacilityId = scheduleGroups.find((sg) => sg.id === scheduleGroupId)?.facility_id;
  const facilitySpaces = spaces.filter((s) => s.facility_id === selectedFacilityId);

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validFrom) { setError("Season start date is required."); return; }
    if (!startTime || !endTime) { setError("Start and end time are required."); return; }
    if (startTime >= endTime) { setError("End time must be after start time."); return; }

    setLoading(true);

    // Build dtstart: combine validFrom date with startTime, converted from the
    // chosen timezone's wall clock to a true UTC instant.
    const dtstart = zonedTimeToUtc(validFrom, startTime, timezone).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroupId,
        rrule,
        dtstart,
        dtend_time: endTime,
        timezone,
        valid_from: validFrom,
        valid_until: validUntil || null,
        space_ids: spaceIds,
        location_detail: locationDetail || null,
        ...(sessionId ? { sessionId } : {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  async function handleDelete() {
    if (!sessionId) return;
    if (!confirm("Remove this recurring session? This cannot be undone.")) return;

    setDeleting(true);
    const res = await fetch(`/api/sessions?sessionId=${sessionId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not remove this session.");
      setDeleting(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
      {scheduleGroups.length === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          You need to <Link href="/dashboard/facilities" className="underline font-medium">add a schedule</Link> before creating sessions.
        </div>
      )}

      {/* Schedule selector */}
      <div>
        <label htmlFor="schedule_group_id" className={labelClass}>Schedule *</label>
        <select
          id="schedule_group_id"
          value={scheduleGroupId}
          onChange={(e) => {
            setScheduleGroupId(e.target.value);
            setSpaceIds([]); // the space list is scoped to the schedule's facility
          }}
          required
          disabled={isEditing}
          className={fieldClass}
        >
          {scheduleGroups.map((sg) => (
            <option key={sg.id} value={sg.id}>
              {sg.name} — {sg.facility_name}
            </option>
          ))}
        </select>
        {isEditing && (
          <p className="text-xs text-gray-500 mt-1">
            To move this session to a different schedule, delete it and create a new one there.
          </p>
        )}
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

      {/* Space */}
      <div className="border-t border-gray-100 pt-5">
        <label className={labelClass}>Spaces</label>
        {facilitySpaces.length === 0 ? (
          <p className="text-sm text-gray-400">No spaces set up for this facility.</p>
        ) : (
          <>
            <div className="flex gap-1.5 flex-wrap">
              {facilitySpaces.map((space) => {
                const selected = spaceIds.includes(space.id);
                return (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => toggleSpace(space.id)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors",
                      selected
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-gray-200 text-gray-600 hover:border-blue-300"
                    )}
                    aria-pressed={selected}
                  >
                    {space.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Select every space this session occupies at once (e.g. all 4 lanes for Lap Swim).
            </p>
          </>
        )}
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-gray-100 pt-5">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          Advanced options
          <span className="font-normal text-gray-400">(timezone, location detail)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-4">
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
            <label htmlFor="location_detail" className={labelClass}>Additional location detail</label>
            <input
              id="location_detail"
              type="text"
              value={locationDetail}
              onChange={(e) => setLocationDetail(e.target.value)}
              className={fieldClass}
              placeholder="e.g. Enter via the north doors"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional free-text note shown alongside the space, e.g. entry instructions.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        {isEditing && (
          <button type="button" onClick={handleDelete} disabled={loading || deleting}
            className="px-4 py-2.5 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
            {deleting ? "Removing…" : "Delete"}
          </button>
        )}
        <button type="button" onClick={() => router.back()}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || deleting || scheduleGroups.length === 0}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add session"}
        </button>
      </div>
    </form>
  );
}
