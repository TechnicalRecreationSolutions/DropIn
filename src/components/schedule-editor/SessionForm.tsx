"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, CalendarDays, BookOpen } from "lucide-react";
import RRuleBuilder from "./RRuleBuilder";
import { ONCE_RRULE, isOneTimeRRule } from "@/lib/rrule/validate";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import ImageUpload from "@/components/media/ImageUpload";
import { ACTIVITY_TYPES, AGE_GROUPS, SKILL_LEVELS } from "@/lib/utils/schedule-group-attributes";
import { cn } from "@/lib/utils/cn";

/** Remembers the last schedule picked here, so entering several blocks for
 *  the same pool doesn't mean re-selecting it from the dropdown every time. */
const LAST_SCHEDULE_GROUP_KEY = "dropin:sessionForm:lastScheduleGroupId";

interface SessionFormProps {
  orgId: string;
  /** Owner/admin only — matches the PATCH /api/schedule-groups/[id] role
   *  check, the same line migration 024 draws for schedule groups generally.
   *  A member can still create/edit the session itself; the "Program
   *  details" sub-section (which writes to the parent schedule_group) is
   *  hidden rather than left to fail with a 403 after the session saves. */
  canEditScheduleDetails: boolean;
  scheduleGroups: {
    id: string;
    name: string;
    facility_id: string;
    facility_name: string;
    /** The schedule's own descriptive fields — shared by every session under
     *  it, so editing them here edits the schedule, not just this session. */
    activity_type: "drop_in" | "registered" | "open_gym";
    age_group: string | null;
    skill_level: string | null;
    max_participants: number | null;
    cost_notes: string | null;
    description: string | null;
    photo_urls: string[];
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
  orgId,
  canEditScheduleDetails,
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
  const initialGroup = scheduleGroups.find((sg) => sg.id === scheduleGroupId);
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

  // The schedule's own descriptive fields (see SessionFormProps). Kept here,
  // not on the schedule form, but saved back to schedule_groups — never to
  // this session — as a second request, same pattern as the feature fields
  // below.
  const [activityType, setActivityType] = useState(initialGroup?.activity_type ?? "drop_in");
  const [ageGroup, setAgeGroup] = useState(initialGroup?.age_group ?? "all_ages");
  const [skillLevel, setSkillLevel] = useState(initialGroup?.skill_level ?? "all_levels");
  const [maxParticipants, setMaxParticipants] = useState(
    initialGroup?.max_participants ? String(initialGroup.max_participants) : ""
  );
  const [costNotes, setCostNotes] = useState(initialGroup?.cost_notes ?? "");
  const [description, setDescription] = useState(initialGroup?.description ?? "");
  const [photoUrls, setPhotoUrls] = useState<string[]>(initialGroup?.photo_urls ?? []);

  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      !!(
        initialValues?.locationDetail ||
        (canEditScheduleDetails &&
          ((initialGroup?.activity_type && initialGroup.activity_type !== "drop_in") ||
            (initialGroup?.age_group && initialGroup.age_group !== "all_ages") ||
            (initialGroup?.skill_level && initialGroup.skill_level !== "all_levels") ||
            initialGroup?.max_participants ||
            initialGroup?.cost_notes ||
            initialGroup?.description))
      )
  );

  // Re-seeds the schedule's descriptive fields from whichever group is now
  // selected — only reachable while creating (the picker is disabled once
  // editing), but a schedule switch mid-create must not carry over the
  // previous group's values.
  function applyGroupDefaults(groupId: string) {
    const g = scheduleGroups.find((sg) => sg.id === groupId);
    if (!g) return;
    setActivityType(g.activity_type);
    setAgeGroup(g.age_group ?? "all_ages");
    setSkillLevel(g.skill_level ?? "all_levels");
    setMaxParticipants(g.max_participants ? String(g.max_participants) : "");
    setCostNotes(g.cost_notes ?? "");
    setDescription(g.description ?? "");
    setPhotoUrls(g.photo_urls ?? []);
  }

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

  const selectedGroup = scheduleGroups.find((sg) => sg.id === scheduleGroupId);
  const selectedFacilityId = selectedGroup?.facility_id;
  const facilitySpaces = spaces.filter((s) => s.facility_id === selectedFacilityId);

  // Same skip-the-second-request reasoning as featureTouched, compared
  // against whichever group is currently selected — not the group this form
  // started with, since the picker (while creating) can change it.
  const groupFieldsTouched =
    canEditScheduleDetails &&
    !!selectedGroup &&
    (activityType !== selectedGroup.activity_type ||
      (ageGroup || null) !== selectedGroup.age_group ||
      (skillLevel || null) !== selectedGroup.skill_level ||
      (maxParticipants ? parseInt(maxParticipants) : null) !== selectedGroup.max_participants ||
      (costNotes || null) !== selectedGroup.cost_notes ||
      (description || null) !== selectedGroup.description ||
      photoUrls.join(",") !== selectedGroup.photo_urls.join(","));

  // Client-only: swap in the last schedule used from this browser, once, but
  // only when nobody asked for a specific one (a deep link from "Add a
  // session to X" always wins) and only while creating — editing arrives
  // with its own schedule already fixed.
  useEffect(() => {
    if (isEditing || defaultScheduleGroupId) return;
    const last = localStorage.getItem(LAST_SCHEDULE_GROUP_KEY);
    if (last && scheduleGroups.some((sg) => sg.id === last)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScheduleGroupId(last);
      applyGroupDefaults(last);
    }
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

    // The schedule's descriptive fields live on schedule_groups, not
    // sessions — a third request, same reasoning as featureTouched/the
    // feature save above, against the schedule the session was just saved
    // under (not necessarily `scheduleGroupId`'s prop value, but it's the
    // same thing here).
    if (groupFieldsTouched) {
      const groupRes = await fetch(`/api/schedule-groups/${scheduleGroupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_type: activityType,
          age_group: ageGroup || null,
          skill_level: skillLevel || null,
          max_participants: maxParticipants ? parseInt(maxParticipants) : null,
          cost_notes: costNotes || null,
          description: description || null,
          photo_urls: photoUrls,
        }),
      });

      if (!groupRes.ok) {
        const groupData = await groupRes.json().catch(() => ({}));
        setError(
          `${groupData.error ?? "Could not save the schedule's program details."} The session itself was saved.`
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
            applyGroupDefaults(e.target.value);
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
          <span className="font-normal text-gray-400">
            (location detail{canEditScheduleDetails ? ", program details" : ""})
          </span>
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

          {canEditScheduleDetails && (
          <div className="border-t border-gray-100 pt-5 space-y-5">
            <div>
              <p className="text-sm font-medium text-gray-700">Program details</p>
              <p className="text-xs text-gray-500 mt-0.5">
                These describe the schedule itself, not just this session — saving here updates
                {selectedGroup ? ` every session under “${selectedGroup.name}.”` : " the whole schedule."}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="activity_type" className={labelClass}>Type</label>
                <select id="activity_type" value={activityType}
                  onChange={(e) => setActivityType(e.target.value as typeof activityType)} className={fieldClass}>
                  {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="age_group" className={labelClass}>Age group</label>
                <select id="age_group" value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className={fieldClass}>
                  {AGE_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="skill_level" className={labelClass}>Skill level</label>
                <select id="skill_level" value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} className={fieldClass}>
                  {SKILL_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="max_participants" className={labelClass}>Max participants</label>
              <input id="max_participants" type="number" min="1"
                value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)}
                className={fieldClass} placeholder="Leave blank for unlimited" />
            </div>

            <div>
              <label htmlFor="cost_notes" className={labelClass}>Cost notes</label>
              <input id="cost_notes" type="text" value={costNotes} onChange={(e) => setCostNotes(e.target.value)}
                className={fieldClass} placeholder="e.g. Members free, Non-members $5" />
            </div>

            <div>
              <label htmlFor="group_description" className={labelClass}>Description</label>
              <textarea id="group_description" rows={3} value={description}
                onChange={(e) => setDescription(e.target.value)} className={fieldClass}
                placeholder="Brief description of this schedule..." />
            </div>

            <ImageUpload
              value={photoUrls[0] ?? null}
              onChange={(url) => setPhotoUrls(url ? [url, ...photoUrls.slice(1)] : photoUrls.slice(1))}
              orgId={orgId}
              kind="schedules"
              label="Photo"
              hint="Used where this schedule is presented as a program, including the brochure."
            />
          </div>
          )}
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
