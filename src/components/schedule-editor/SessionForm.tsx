"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, CalendarDays, BookOpen } from "lucide-react";
import RRuleBuilder from "./RRuleBuilder";
import { ONCE_RRULE, isOneTimeRRule } from "@/lib/rrule/validate";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils/cn";

/** Remembers the last schedule picked here, so entering several blocks for
 *  the same pool doesn't mean re-selecting it from the dropdown every time. */
const LAST_SCHEDULE_GROUP_KEY = "dropin:sessionForm:lastScheduleGroupId";

interface SessionFormProps {
  scheduleGroups: {
    id: string;
    name: string;
    facility_id: string;
    facility_name: string;
  }[];
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
    spaceIds: string[];
    locationDetail: string;
    /** From sessions.is_event / .in_brochure — the two publishing toggles. */
    isEvent?: boolean;
    inBrochure?: boolean;
    /** One line for a calendar cell, from session_features.summary. */
    featureSummary?: string | null;
  };
  /** Where to send staff after a successful save/delete. Defaults to /dashboard/schedule. */
  redirectTo?: string;
}

/** What a brand-new session starts as, and the marker for "nobody has chosen a recurrence yet". */
const DEFAULT_RRULE = "FREQ=WEEKLY;BYDAY=MO,WE,FR";

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

  // Falls back to the first schedule at mount (matching server-rendered
  // markup, since localStorage isn't available there); the effect below
  // swaps in the last-used one on the client, once, if nothing more specific
  // was already asked for.
  const [scheduleGroupId, setScheduleGroupId] = useState(defaultScheduleGroupId ?? scheduleGroups[0]?.id ?? "");
  const [rrule, setRrule] = useState(initialValues?.rrule ?? DEFAULT_RRULE);
  // Bumped to force RRuleBuilder to remount. It parses its RRULE once on mount
  // and owns frequency/day state from then on, so changing `rrule` from out
  // here is invisible to it without this.
  const [rruleSeed, setRruleSeed] = useState(0);
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(initialValues?.endTime ?? "10:00");
  const [validFrom, setValidFrom] = useState(initialValues?.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(initialValues?.validUntil ?? "");
  const [spaceIds, setSpaceIds] = useState<string[]>(initialValues?.spaceIds ?? []);
  const [locationDetail, setLocationDetail] = useState(initialValues?.locationDetail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(!!initialValues?.locationDetail);

  const [isEvent, setIsEvent] = useState(initialValues?.isEvent ?? false);
  const [inBrochure, setInBrochure] = useState(initialValues?.inBrochure ?? false);
  const [featureSummary, setFeatureSummary] = useState(initialValues?.featureSummary ?? "");
  // Opens itself when the session is already featured, so an editor never has
  // to discover that a collapsed section is where the state they can see on the
  // calendar actually lives.
  const [featureOpen, setFeatureOpen] = useState(
    !!(initialValues?.isEvent || initialValues?.inBrochure)
  );

  /**
   * Turning the event toggle on defaults a *new* session to a one-off.
   *
   * The brief asks for this because the thing being put on an events calendar
   * is usually a Halloween Howl, not a recurring class — and until B3 there was
   * no first-class way to say "once".
   *
   * Two guards make it a default rather than a silent rewrite. It never touches
   * an existing session, where the recurrence is established fact and flipping
   * a presentation toggle must not rewrite when it happens. And it only fires
   * while the rule is still untouched, so someone who has already built a
   * weekly pattern and *then* decides to feature it keeps what they built.
   */
  function handleEventToggle(next: boolean) {
    setIsEvent(next);
    if (next && !isEditing && rrule === DEFAULT_RRULE) {
      setRrule(ONCE_RRULE);
      setRruleSeed((seed) => seed + 1);
    }
  }

  // What the form would be writing if submitted now. Used to skip the second
  // request entirely for the overwhelmingly common case: a session nobody has
  // ever featured, saved without opening this section.
  const featureTouched =
    isEvent !== (initialValues?.isEvent ?? false) ||
    inBrochure !== (initialValues?.inBrochure ?? false) ||
    featureSummary !== (initialValues?.featureSummary ?? "");

  const selectedFacilityId = scheduleGroups.find((sg) => sg.id === scheduleGroupId)?.facility_id;
  const facilitySpaces = spaces.filter((s) => s.facility_id === selectedFacilityId);

  // Client-only: swap in the last schedule used from this browser, once, but
  // only when nobody asked for a specific one (a deep link from "Add a
  // session to X" always wins) and only while creating — editing arrives
  // with its own schedule already fixed.
  useEffect(() => {
    if (isEditing || defaultScheduleGroupId) return;
    const last = localStorage.getItem(LAST_SCHEDULE_GROUP_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (last && scheduleGroups.some((sg) => sg.id === last)) setScheduleGroupId(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // dtstart's digits are the literal local wall-clock date/time, "Z"-suffixed
    // with no real instant meaning (see dropin/docs/RESUME-timezone-removal.md)
    // — direct string construction, not a conversion.
    const dtstart = `${validFrom}T${startTime}:00Z`;

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroupId,
        rrule,
        dtstart,
        dtend_time: endTime,
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

    localStorage.setItem(LAST_SCHEDULE_GROUP_KEY, scheduleGroupId);

    // Featuring is a second request on purpose. The flags live on `sessions`
    // but the copy lives in `session_features`, and /api/sessions/features is
    // the single writer of that table — the Feature dialog on the schedule
    // views posts to the same place. Teaching /api/sessions about feature
    // content would duplicate its validation and give the payload two writers
    // that could disagree.
    //
    // It runs after the session save because a new session has no id until
    // then; `data.sessionId` covers both create and update.
    if (featureTouched) {
      const featureRes = await fetch("/api/sessions/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: data.sessionId,
          is_event: isEvent,
          in_brochure: inBrochure,
          summary: featureSummary,
        }),
      });

      if (!featureRes.ok) {
        const featureData = await featureRes.json().catch(() => ({}));
        // The session itself saved. Say so, rather than letting a failure here
        // read as though the whole edit was lost.
        setError(
          `${featureData.error ?? "Could not save the feature details."} The session itself was saved.`
        );
        setLoading(false);
        return;
      }
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
          key={rruleSeed}
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

      {/* Progressive disclosure, like Advanced options below: a small minority
          of sessions are ever featured, so this stays out of the way until
          someone wants it — but it opens itself when the session already is. */}
      <Collapsible
        open={featureOpen}
        onOpenChange={setFeatureOpen}
        className="border-t border-gray-100 pt-5"
      >
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ChevronDown className={`w-4 h-4 transition-transform ${featureOpen ? "rotate-180" : ""}`} />
          Feature this session
          <span className="font-normal text-gray-400">(event calendar, brochure)</span>
          {(isEvent || inBrochure) && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold">
              {[isEvent && "Event", inBrochure && "Brochure"].filter(Boolean).join(" · ")}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleEventToggle(!isEvent)}
              aria-pressed={isEvent}
              className={cn(
                "text-left rounded-lg border-2 p-3 transition-colors",
                isEvent ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-blue-300"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <CalendarDays className={cn("w-4 h-4", isEvent ? "text-blue-600" : "text-gray-400")} />
                Event calendar
              </span>
              <span className="block text-xs text-gray-500 mt-1">
                Shows on the month-at-a-glance calendar.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setInBrochure(!inBrochure)}
              aria-pressed={inBrochure}
              className={cn(
                "text-left rounded-lg border-2 p-3 transition-colors",
                inBrochure ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-blue-300"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <BookOpen className={cn("w-4 h-4", inBrochure ? "text-blue-600" : "text-gray-400")} />
                Brochure
              </span>
              <span className="block text-xs text-gray-500 mt-1">
                Offered as a candidate for a season&rsquo;s brochure.
              </span>
            </button>
          </div>

          {/* The toggle moved the recurrence, so say so. A form that silently
              rewrote a field above it would be a bug report. */}
          {isEvent && !isEditing && isOneTimeRRule(rrule) && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              Set to happen <span className="font-medium">just once</span> — the usual shape for
              an event. Change &ldquo;Repeats&rdquo; above if it runs weekly.
            </p>
          )}

          <div>
            <label htmlFor="feature_summary" className={labelClass}>Calendar summary</label>
            <input
              id="feature_summary"
              type="text"
              value={featureSummary}
              onChange={(e) => setFeatureSummary(e.target.value)}
              maxLength={200}
              className={fieldClass}
              placeholder="e.g. Costumes encouraged"
            />
            <p className="text-xs text-gray-500 mt-1">
              One line, shown in the calendar cell. Titles, images, links and colours live in
              the fuller <span className="font-medium">Feature</span> editor on the schedule
              views — this is the field you almost always want.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-gray-100 pt-5">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          Advanced options
          <span className="font-normal text-gray-400">(location detail)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-4">
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
