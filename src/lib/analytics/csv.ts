import {
  DEVICE_LABELS,
  deviceClass,
  referrerLabel,
  type AnalyticsEventRow,
  type AnalyticsSummary,
  type CountedLabel,
} from "@/lib/analytics/queries";
import { formatRangeLabel, toLocalDay, type AnalyticsRange } from "@/lib/analytics/range";

/**
 * CSV for the analytics export.
 *
 * Hand-rolled rather than papaparse's `unparse`, for one reason: **formula
 * injection**. Half the strings here are attacker-supplied — a referrer
 * hostname is whatever the embedding page sent — and a cell beginning `=`,
 * `+`, `-`, `@` or a control character is executed as a formula the moment
 * the file is opened in Excel, Numbers or Sheets. `unparse` quotes for CSV
 * correctness, which does nothing about that; `escapeCell` below prefixes a
 * single quote, which is the mitigation those programs actually respect.
 *
 * The same reasoning is why the export carries no `ip_hash` and no raw
 * `user_agent`: they are the two columns the privacy note in
 * 005_analytics_tables.sql promises are never handed out, so the export
 * reports the device class derived from the agent and nothing else.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Formula-injection guard first, CSV quoting second — the apostrophe has to
  // end up inside the quotes, not outside them.
  const guarded = RISKY_PREFIX.test(text) ? "'" + text : text;
  return /[",\n\r]/.test(guarded) ? '"' + guarded.replace(/"/g, '""') + '"' : guarded;
}

export function toCsv(rows: (string | number | null)[][]): string {
  // CRLF and a UTF-8 BOM: without the BOM Excel on Windows renders any
  // non-ASCII facility name as mojibake, which is the first thing a customer
  // would notice about an export.
  return "﻿" + rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

export type ExportDataset = "summary" | "daily" | "breakdowns" | "events";

export const EXPORT_DATASETS: { id: ExportDataset; label: string; description: string }[] = [
  { id: "summary", label: "Summary", description: "Every headline number, one row each" },
  { id: "daily", label: "Daily breakdown", description: "Views, visitors and clicks per day" },
  { id: "breakdowns", label: "Breakdowns", description: "Templates, devices, sources, schedules" },
  { id: "events", label: "Raw events", description: "One row per tracked event" },
];

function pct(value: number | null): string {
  return value === null ? "" : (value * 100).toFixed(1) + "%";
}

function seconds(ms: number | null): string {
  return ms === null ? "" : (ms / 1000).toFixed(1);
}

function delta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "0%" : "";
  return (((current - previous) / previous) * 100).toFixed(1) + "%";
}

/** The header block every dataset opens with, so a saved file explains itself. */
function preamble(orgName: string, range: AnalyticsRange, facilityName: string | null): (string | number | null)[][] {
  return [
    ["Dropin analytics export"],
    ["Organization", orgName],
    ["Period", formatRangeLabel(range) + " (" + range.from + " to " + range.to + ")"],
    ["Facility", facilityName ?? "All facilities"],
    ["Generated", new Date().toISOString()],
    [],
  ];
}

export function summaryCsv(
  summary: AnalyticsSummary,
  orgName: string,
  facilityName: string | null
): string {
  const prev = summary.previous;
  const rows: (string | number | null)[][] = [
    ...preamble(orgName, summary.range, facilityName),
    ["Metric", "Value", "Previous period", "Change"],
    ["Views", summary.views, prev?.views ?? "", prev ? delta(summary.views, prev.views) : ""],
    ["Unique visitors (per day, summed)", summary.visitors, "", ""],
    ["Session clicks", summary.clicks, prev?.clicks ?? "", prev ? delta(summary.clicks, prev.clicks) : ""],
    [
      "Registration clicks",
      summary.linkClicks,
      prev?.linkClicks ?? "",
      prev ? delta(summary.linkClicks, prev.linkClicks) : "",
    ],
    ["Click-through rate", pct(summary.clickThroughRate), pct(prev?.clickThroughRate ?? null), ""],
    ["Registration rate", pct(summary.registrationRate), "", ""],
    [
      "Views per visitor",
      summary.viewsPerVisitor === null ? "" : summary.viewsPerVisitor.toFixed(2),
      "",
      "",
    ],
    ["Average time on schedule (s)", seconds(summary.avgDurationMs), "", ""],
    ["Median time on schedule (s)", seconds(summary.medianDurationMs), "", ""],
    ["Quick-exit rate (under 10s)", pct(summary.quickExitRate), "", ""],
    ["Visits with a measured length", summary.durationSamples, "", ""],
    ["Busiest day", summary.busiestDay?.day ?? "", summary.busiestDay?.views ?? "", ""],
    ["Events recorded", summary.eventCount, "", ""],
  ];

  if (summary.truncated) {
    rows.push([], ["Note", "Row ceiling reached — this export covers " + summary.coveredFrom + " onward only."]);
  }

  return toCsv(rows);
}

export function dailyCsv(summary: AnalyticsSummary, orgName: string, facilityName: string | null): string {
  return toCsv([
    ...preamble(orgName, summary.range, facilityName),
    ["Day", "Views", "Unique visitors", "Session clicks", "Registration clicks"],
    ...summary.byDay.map((d) => [d.day, d.views, d.visitors, d.clicks, d.linkClicks]),
  ]);
}

export function breakdownsCsv(
  summary: AnalyticsSummary,
  orgName: string,
  facilityName: string | null,
  names: { facilityNames: Map<string, string>; scheduleNames: Map<string, string> }
): string {
  const section = (category: string, entries: CountedLabel[]) =>
    entries.map((e) => [category, e.label, e.count, (e.share * 100).toFixed(1) + "%"]);

  const total = (n: number, of: number) => (of > 0 ? ((n / of) * 100).toFixed(1) + "%" : "");

  return toCsv([
    ...preamble(orgName, summary.range, facilityName),
    ["Category", "Label", "Count", "Share"],
    ...section("View template", summary.templateBreakdown),
    ...section("Device", summary.deviceBreakdown),
    ...section("Surface", summary.surfaceBreakdown),
    ...section("Traffic source", summary.topReferrers),
    ...section("Visit length", summary.durationBuckets),
    ...summary.topFacilities.map((f) => [
      "Facility",
      names.facilityNames.get(f.facilityId) ?? "Deleted facility",
      f.count,
      total(f.count, summary.views),
    ]),
    ...summary.topClickedSchedules.map((s) => [
      "Clicked schedule",
      names.scheduleNames.get(s.scheduleGroupId) ?? "Deleted schedule",
      s.count,
      total(s.count, summary.clicks),
    ]),
    ...summary.byHour.map((views, hour) => [
      "Hour of day",
      String(hour).padStart(2, "0") + ":00",
      views,
      total(views, summary.views),
    ]),
  ]);
}

const EVENT_LABELS: Record<string, string> = {
  widget_view: "Widget view",
  facility_view: "Facility page view",
  schedule_view: "Public schedule view",
  view_change: "Switched template",
  program_click: "Opened a session",
  link_click: "Followed registration link",
  session_duration: "Visit length",
};

export function eventsCsv(
  rows: AnalyticsEventRow[],
  range: AnalyticsRange,
  orgName: string,
  facilityName: string | null,
  names: { facilityNames: Map<string, string>; scheduleNames: Map<string, string> }
): string {
  return toCsv([
    ...preamble(orgName, range, facilityName),
    [
      "Occurred at",
      "Day",
      "Hour",
      "Event",
      "Facility",
      "Schedule",
      "Template",
      "Device",
      "Traffic source",
      "Visit length (s)",
    ],
    ...rows.map((row) => {
      const at = new Date(row.occurred_at);
      return [
        row.occurred_at,
        toLocalDay(at),
        at.getHours(),
        EVENT_LABELS[row.event_type] ?? row.event_type,
        row.facility_id ? (names.facilityNames.get(row.facility_id) ?? row.facility_id) : "",
        row.schedule_group_id ? (names.scheduleNames.get(row.schedule_group_id) ?? row.schedule_group_id) : "",
        row.view_template ?? "",
        DEVICE_LABELS[deviceClass(row.user_agent)],
        referrerLabel(row.referrer_url),
        row.duration_ms === null ? "" : (row.duration_ms / 1000).toFixed(1),
      ];
    }),
  ]);
}
