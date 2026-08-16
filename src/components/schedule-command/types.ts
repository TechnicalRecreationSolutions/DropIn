import type { EditorTemplate } from "@/components/schedule/editing/ScheduleEditingContext";

/** A schedule under a facility, with everything the editor needs to place sessions into it. */
export interface CommandScheduleGroup {
  id: string;
  name: string;
  status: "draft" | "published";
  /** "continuous" schedules are always-open hours, not placed sessions — they have nothing to build. */
  scheduleType: string | null;
  /** Null for schedules that sit directly under the facility. */
  departmentId: string | null;
  departmentName: string | null;
  templates: EditorTemplate[];
  /** Rename / publish / sport-category form. The old detail page is gone — it redirected here. */
  settingsHref: string;
  manageTemplatesHref: string;
}

/** A bookable location — the thing sessions are placed into and the map is drawn from. */
export interface CommandSpace {
  id: string;
  name: string;
  capacity: number | null;
  isPublished: boolean;
  /** Null for spaces that sit directly under the facility. */
  departmentId: string | null;
}

/** A facility and everything inside it — one "building box" on the command centre. */
export interface CommandFacility {
  id: string;
  name: string;
  isPublished: boolean;
  /** Floorplan can only render where a facility map has been published. */
  hasPublishedMap: boolean;
  /** Empty for facilities that keep their schedules flat — the department tier then never renders. */
  departments: { id: string; name: string }[];
  spaces: CommandSpace[];
  scheduleGroups: CommandScheduleGroup[];
}
