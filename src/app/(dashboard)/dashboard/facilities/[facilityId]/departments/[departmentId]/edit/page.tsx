import { notFound } from "next/navigation";
import { commandCentreHref, departmentsHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentForm from "@/components/department/DepartmentForm";
import DepartmentEditorShell from "@/components/department/DepartmentEditorShell";
import OperatingHoursEditor from "@/components/department/OperatingHoursEditor";
import HolidayEditor from "@/components/department/HolidayEditor";
import { PageHeader } from "@/components/ui/info-tip";
import {
  emptyWeek,
  summarizeWeek,
  timeToMinutes,
  type OperatingWindow,
} from "@/lib/schedule/operating-hours";

interface EditDepartmentPageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

export default async function EditDepartmentPage({ params }: EditDepartmentPageProps) {
  const { facilityId, departmentId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name, province")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!facility) notFound();

  const { data: department } = await supabase
    .from("departments")
    .select("id, name, description, is_published")
    .eq("id", departmentId)
    .eq("facility_id", facilityId)
    .single();

  if (!department) notFound();

  // Operating hours (migration 058), loaded here rather than fetched by the
  // editor on mount so the grid is right in the server-rendered HTML — this
  // page is reached from a list where staff often make one change and leave.
  const { data: hourRows } = await supabase
    .from("department_hours")
    .select("day_of_week, opens_at, closes_at")
    .eq("department_id", departmentId)
    .order("day_of_week")
    .order("opens_at");

  const days: { opens: string; closes: string }[][] = [[], [], [], [], [], [], []];
  const week: OperatingWindow[][] = emptyWeek();
  for (const row of hourRows ?? []) {
    if (row.day_of_week < 0 || row.day_of_week > 6) continue;
    days[row.day_of_week].push({
      opens: row.opens_at.slice(0, 5),
      closes: row.closes_at.slice(0, 5),
    });
    // The same rows in minutes, only so the page can print the week in one
    // line above the editor. Malformed rows are skipped rather than repaired —
    // groupHoursByDepartment's reasoning, applied to a summary.
    const opens = timeToMinutes(row.opens_at);
    const closes = timeToMinutes(row.closes_at);
    if (opens !== null && closes !== null && closes > opens) {
      week[row.day_of_week].push({ opens, closes });
    }
  }

  // How many sessions a change here would move. `head: true` so this costs a
  // count and not the rows.
  const { count: sessionsFollowing } = await supabase
    .from("sessions")
    .select("id, schedule_groups!inner(department_id)", { count: "exact", head: true })
    .eq("follows_operating_hours", true)
    .eq("is_active", true)
    .eq("schedule_groups.department_id", departmentId);

  // Holidays for the current year (059). The year is the server's, so the
  // page renders the one staff are most likely to be editing; the editor can
  // switch and refetch from there.
  const holidayYear = new Date().getUTCFullYear();
  const { data: holidayRows } = await supabase
    .from("department_holidays")
    .select("holiday_date, name, observance, department_holiday_windows (opens_at, closes_at)")
    .eq("department_id", departmentId)
    .gte("holiday_date", `${holidayYear}-01-01`)
    .lte("holiday_date", `${holidayYear}-12-31`)
    .order("holiday_date");

  type HolidayRow = {
    holiday_date: string;
    name: string;
    observance: "closed" | "custom_hours" | "normal_hours";
    department_holiday_windows: { opens_at: string; closes_at: string }[] | null;
  };

  const holidays = ((holidayRows ?? []) as unknown as HolidayRow[]).map((h) => ({
    date: h.holiday_date,
    name: h.name,
    observance: h.observance,
    windows: (h.department_holiday_windows ?? [])
      .map((w) => ({ opens: w.opens_at.slice(0, 5), closes: w.closes_at.slice(0, 5) }))
      .sort((a, b) => a.opens.localeCompare(b.opens)),
  }));

  // The other departments in this building, for "copy to…". A closure is
  // usually the building's, not one pool's.
  const { data: siblingRows } = await supabase
    .from("departments")
    .select("id, name")
    .eq("facility_id", facilityId)
    .eq("org_id", orgContext.org.id)
    .neq("id", departmentId)
    .order("name");

  const hasHours = week.some((day) => day.length > 0);

  return (
    <div className="max-w-3xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Departments", href: departmentsHref(facilityId) },
          { label: department.name },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        {/* The department's own name, not "Edit department" — this page is
            reached from a list of several, and the heading is the only thing
            that says which one it opened. */}
        <PageHeader
          title={department.name}
          subtitle={`Department in ${facility.name}`}
          info="A department groups related schedules in one building, and owns the opening hours and holiday closures those schedules follow."
        />
      </div>

      <DepartmentEditorShell
        facilityName={facility.name}
        weekSummary={summarizeWeek(week)}
        hasHours={hasHours}
        holidaysObserved={holidays.length}
        holidayYear={holidayYear}
        sessionsFollowing={sessionsFollowing ?? 0}
        isPublished={department.is_published}
        scheduleHref={commandCentreHref({ facilityId, departmentId })}
        details={
          <DepartmentForm
            facilityId={facilityId}
            departmentId={departmentId}
            heading="Details"
            defaultValues={{
              name: department.name,
              description: department.description ?? "",
              is_published: department.is_published,
            }}
            // Stay on the page: the hours and holidays sections save
            // separately, and a redirect here would discard whatever is
            // half-entered on them.
            redirectTo={null}
          />
        }
        hours={
          <OperatingHoursEditor
            departmentId={departmentId}
            initialDays={days}
            sessionsFollowing={sessionsFollowing ?? 0}
          />
        }
        holidays={
          <HolidayEditor
            departmentId={departmentId}
            province={facility.province}
            initialYear={holidayYear}
            initialHolidays={holidays}
            siblings={siblingRows ?? []}
          />
        }
      />
    </div>
  );
}
