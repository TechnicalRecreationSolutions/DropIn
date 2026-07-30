"use client";

import { useState } from "react";
import { useWeeklySchedule } from "@/hooks/useWeeklySchedule";
import { getWeekStart } from "@/lib/utils/dates";
import BuilderViewToggle from "./BuilderViewToggle";
import SpaceBuilderClient from "./SpaceBuilderClient";
import GridBuilderClient from "./GridBuilderClient";
import ListBuilderClient from "./ListBuilderClient";
import type { BuilderTemplate } from "./TemplatePalette";
import type { BuilderView } from "./builderShared";

interface BuilderClientProps {
  scheduleGroupId: string;
  spaces: { id: string; name: string }[];
  templates: BuilderTemplate[];
  manageTemplatesHref: string;
}

/**
 * Top-level builder wrapper — owns the view-mode toggle (grid/list/map,
 * matching the public widget's three views — "space" is Map's internal
 * BuilderView value) and the single shared useWeeklySchedule fetch all
 * three views render from, so switching views doesn't refetch or lose the
 * current week.
 *
 * All three are fully editable, not previews: Grid and List have no time
 * axis, so sessions are added via a per-column/day "+ Add session" button;
 * Map has a real time axis (physical spaces as columns) and supports
 * true drag-to-create-at-exact-time and drag-to-reschedule.
 */
export default function BuilderClient({ scheduleGroupId, spaces, templates, manageTemplatesHref }: BuilderClientProps) {
  const [view, setView] = useState<BuilderView>("grid");
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));

  const { data: sessions } = useWeeklySchedule({ scheduleGroupId, weekStart });

  return (
    <div className="space-y-4">
      <BuilderViewToggle view={view} onChange={setView} />

      {view === "space" && (
        <SpaceBuilderClient
          scheduleGroupId={scheduleGroupId}
          spaces={spaces}
          templates={templates}
          manageTemplatesHref={manageTemplatesHref}
          sessions={sessions}
        />
      )}

      {view === "grid" && (
        <GridBuilderClient
          scheduleGroupId={scheduleGroupId}
          spaces={spaces}
          templates={templates}
          manageTemplatesHref={manageTemplatesHref}
          sessions={sessions}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
        />
      )}

      {view === "list" && (
        <ListBuilderClient
          scheduleGroupId={scheduleGroupId}
          spaces={spaces}
          templates={templates}
          manageTemplatesHref={manageTemplatesHref}
          sessions={sessions}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
        />
      )}
    </div>
  );
}
