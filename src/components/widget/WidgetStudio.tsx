"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, Copy, Loader2 } from "lucide-react";
import {
  DEFAULT_ENABLED_FILTERS,
  parseEnabledFilters,
  type SessionFilterKey,
} from "@/lib/schedule/sessionFilters";
import { cn } from "@/lib/utils/cn";
import { parseScopeLevels, type ScopeLevel } from "@/lib/schedule/scopeSelection";
import BrandColorField from "./BrandColorField";
import FilterEditor from "./FilterEditor";
import InstallPanel, { SectionHeading } from "./InstallPanel";
import LayoutPicker, { VIEW_LABELS, type FloorplanState, type MapStatus } from "./LayoutPicker";
import PreviewPanel from "./PreviewPanel";
import PreviewWindow from "./PreviewWindow";
import SectionTiles, { panelId, tabId, type SectionTile } from "./SectionTiles";
import VisitorFilterToggles from "./VisitorFilterToggles";
import MultiSelectToggles from "./MultiSelectToggles";
import PrintToggle from "./PrintToggle";
import FiltersStartToggle from "./FiltersStartToggle";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SCOPE_FACILITY_SELECT_ID,
  SECTION_SETTINGS,
  changedSettings,
  savedScopeToLocal,
  type EmbedMethod,
  type LocalScope,
  type PublishedSettings,
  type SavedScope,
  type ScheduleTemplate,
  type StudioSection,
  type WidgetFacility,
  type WidgetTheme,
} from "./types";

interface WidgetStudioProps {
  orgId: string;
  facilities: WidgetFacility[];
  /** Whether the org has any schedule at all — the Schedules section's empty state. */
  hasSchedules: boolean;
  /** Settings › Embedding's list; null before migration 067. */
  trustedHosts: string[] | null;
  canManageTrustedSites: boolean;
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

const METHOD_NAMES: Record<EmbedMethod, string> = {
  script: "Script embed",
  iframe: "iFrame",
  link: "Link",
};

/** "Sep 29, 4:12 PM", in the viewer's own time — the same fixed patterns as `lib/utils/dates.ts`. */
const formatPublishedAt = (iso: string) => format(new Date(iso), "MMM d, h:mm a");

let scopeKeySeq = 0;
function newScopeKey() {
  scopeKeySeq += 1;
  return `new-${scopeKeySeq}`;
}

/** "Pool", "Pool and Gym", "Pool, Arena and Gym", "Pool, Arena, Gym and 2 more". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * `/dashboard/widget` — the publishing studio.
 *
 * A dashboard rather than a form: four section tiles that summarise what the
 * widget does now and open its settings, a 520px settings card for the open
 * one, and the live preview beside it. See README.md in this folder.
 *
 * The one distinction the layout is built to protect: **published settings vs
 * snippet options.** Schedules, Appearance and Visitor tools edit
 * `widget_configs`/`widget_config_scopes` and change the live embed *and* the
 * public schedule page the moment the header's Publish button is pressed.
 * Install holds what only exists inside the code on the customer's own site
 * (method, theme, height, one-building narrowing), so changing one does
 * nothing until the code is copied again; its tile and its code block say so.
 * Mixing those two sets is what made the old page's "I changed it and nothing
 * happened" reports. `SECTION_SETTINGS` in types.ts is that line, in code.
 *
 * The preview's own Light/Dark is a third thing: it only changes the preview.
 * It starts from the snippet's theme and follows it when Install changes it,
 * but never writes back.
 */
export default function WidgetStudio({
  orgId,
  facilities,
  hasSchedules,
  trustedHosts,
  canManageTrustedSites,
}: WidgetStudioProps) {
  // Published settings.
  const [allowedTemplates, setAllowedTemplates] = useState<ScheduleTemplate[]>(["grid", "list", "map"]);
  const [primaryColor, setPrimaryColor] = useState("#0066CC");
  const [customTitle, setCustomTitle] = useState("");
  const [enabledFilters, setEnabledFilters] = useState<SessionFilterKey[]>(DEFAULT_ENABLED_FILTERS);
  const [allowPrint, setAllowPrint] = useState(false);
  const [multiSelectLevels, setMultiSelectLevels] = useState<ScopeLevel[]>([]);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [scopeRows, setScopeRows] = useState<LocalScope[]>([]);
  /** The last state the server confirmed — the baseline for "unsaved changes" and for Discard. */
  const [savedState, setSavedState] = useState<PublishedSettings | null>(null);
  /** When the saved row was last written, or null if the org has never published. */
  const [publishedAt, setPublishedAt] = useState<string | null>(null);

  // Snippet options — these never touch the database.
  const [theme, setTheme] = useState<WidgetTheme>("light");
  const [height, setHeight] = useState("600");
  const [embedMethod, setEmbedMethod] = useState<EmbedMethod>("script");
  /** Narrows this copy of the snippet to one facility; "" = the whole schedule. */
  const [scopeFacilityId, setScopeFacilityId] = useState("");

  /** The preview's own Light/Dark. Never the snippet's theme. */
  const [previewTheme, setPreviewTheme] = useState<WidgetTheme>("light");

  const [section, setSection] = useState<StudioSection>("schedules");
  /** Sections opened and then left — what ticks the first-run checklist's first two items. */
  const [visited, setVisited] = useState<Set<StudioSection>>(() => new Set());

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedHeader, setCopiedHeader] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  /** The snippet text as it stood the last time it was copied, or null if never. */
  const [lastCopiedCode, setLastCopiedCode] = useState<string | null>(null);

  function selectSection(next: StudioSection) {
    if (next === section) return;
    setVisited((prev) => new Set(prev).add(section));
    setSection(next);
  }

  /** Install's theme is the real one; the preview follows it, but not the other way round. */
  function changeTheme(next: WidgetTheme) {
    setTheme(next);
    setPreviewTheme(next);
  }

  // Floorplan is drawn per building, so the embed needs one — in the same
  // order of precedence the widget itself uses: the snippet's own scope
  // (Install), else the Schedules switcher (the map follows the visitor's
  // pick, so every entry's building counts), else the org's only building.
  // /widget/[orgId] applies the same rule when deciding to offer Floorplan.
  const floorplanFacilityIds = useMemo(() => {
    if (scopeFacilityId) return [scopeFacilityId];
    const fromSwitcher = [...new Set(scopeRows.map((r) => r.facilityId).filter(Boolean))];
    if (fromSwitcher.length > 0) return fromSwitcher;
    return facilities.length === 1 ? [facilities[0].id] : [];
  }, [scopeFacilityId, scopeRows, facilities]);
  const floorplanFollowsSwitcher = !scopeFacilityId && scopeRows.some((r) => r.facilityId);

  const facilityMapQueries = useQueries({
    queries: floorplanFacilityIds.map((id) => ({
      queryKey: ["widget-facility-map", id],
      queryFn: async () => {
        const res = await fetch(`/api/facility-maps?facilityId=${id}`);
        if (!res.ok) throw new Error(`Failed to load facility map (${res.status})`);
        const data = await res.json();
        return data.facilityMap as { is_published: boolean } | null;
      },
    })),
  });
  const floorplanState: FloorplanState =
    floorplanFacilityIds.length === 0
      ? { kind: "pick-facility" }
      : {
          kind: "buildings",
          followsSwitcher: floorplanFollowsSwitcher,
          buildings: floorplanFacilityIds.map((id, i) => {
            const q = facilityMapQueries[i];
            const map: MapStatus = q.isLoading
              ? "checking"
              : !q.data
                ? "none"
                : q.data.is_published
                  ? "published"
                  : "draft";
            return { id, name: facilities.find((f) => f.id === id)?.name ?? "This building", map };
          }),
        };

  /** "Pick one under Install" on the locked Floorplan row. */
  function goToFacilityPicker() {
    selectSection("install");
    // The panel is `hidden` until this render commits.
    requestAnimationFrame(() => {
      const select = document.getElementById(SCOPE_FACILITY_SELECT_ID);
      select?.scrollIntoView({ behavior: "smooth", block: "center" });
      select?.focus({ preventScroll: true });
    });
  }

  const { data: widgetConfigData, isLoading: loading } = useQuery({
    queryKey: ["widget-config", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/widget-config?orgId=${orgId}`);
      if (!res.ok) throw new Error(`Failed to load widget config (${res.status})`);
      return res.json() as Promise<{
        config: {
          /** Absent when the org has never published: the route hands back defaults. */
          id?: string;
          updated_at?: string;
          allowed_templates?: ScheduleTemplate[];
          primary_color?: string;
          custom_title?: string | null;
          enabled_filters?: string[];
          allow_print?: boolean;
          multi_select_levels?: string[];
          filters_collapsed?: boolean;
        };
        scopes?: SavedScope[];
      }>;
    },
  });

  /** Load a server state into both the editable fields and the saved baseline. */
  const adoptSaved = useCallback((next: PublishedSettings) => {
    setAllowedTemplates(next.allowedTemplates);
    setPrimaryColor(next.primaryColor);
    setCustomTitle(next.customTitle);
    setEnabledFilters(next.enabledFilters);
    setAllowPrint(next.allowPrint);
    setMultiSelectLevels(next.multiSelectLevels);
    setFiltersCollapsed(next.filtersCollapsed);
    setScopeRows(next.scopes);
    setSavedState(next);
  }, []);

  // Seed local edit state from the loaded config — the one legitimate
  // "set state from a query result" case, not a derived value.
  useEffect(() => {
    if (!widgetConfigData?.config) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    adoptSaved({
      allowedTemplates: widgetConfigData.config.allowed_templates ?? ["grid", "list", "map"],
      primaryColor: widgetConfigData.config.primary_color ?? "#0066CC",
      customTitle: widgetConfigData.config.custom_title ?? "",
      enabledFilters: parseEnabledFilters(widgetConfigData.config.enabled_filters ?? DEFAULT_ENABLED_FILTERS),
      allowPrint: widgetConfigData.config.allow_print === true,
      multiSelectLevels: parseScopeLevels(widgetConfigData.config.multi_select_levels),
      filtersCollapsed: widgetConfigData.config.filters_collapsed === true,
      scopes: (widgetConfigData.scopes ?? []).map(savedScopeToLocal),
    });
    setPublishedAt(widgetConfigData.config.id ? widgetConfigData.config.updated_at ?? null : null);
  }, [widgetConfigData, adoptSaved]);

  /** Throw away local edits and go back to what is actually live. */
  function discardEdits() {
    if (savedState) adoptSaved(savedState);
    setSaveError(null);
  }

  // Migrations are applied by hand, so the column can lag the code. The row is
  // read with `*`, so a missing key means 051 hasn't landed — and sending
  // allowPrint then would fail the whole publish, not just this toggle.
  const printSupported = !!widgetConfigData && "allow_print" in widgetConfigData.config;
  // Same for the switcher's pick-several setting (migration 065).
  const multiSelectSupported = !!widgetConfigData && "multi_select_levels" in widgetConfigData.config;
  // And whether the filters start collapsed (migration 066).
  const collapsedSupported = !!widgetConfigData && "filters_collapsed" in widgetConfigData.config;

  const current: PublishedSettings = {
    allowedTemplates,
    primaryColor,
    customTitle,
    enabledFilters,
    allowPrint,
    multiSelectLevels,
    filtersCollapsed,
    scopes: scopeRows,
  };
  const changed = savedState ? changedSettings(current, savedState) : [];
  const dirty = changed.length > 0;
  /** Never published: the server has no row, and the tiles are a first-run checklist. */
  const firstRun = !loading && !!widgetConfigData && !widgetConfigData.config.id && publishedAt === null;
  const sectionDirty = (s: StudioSection) => SECTION_SETTINGS[s].some((k) => changed.includes(k));

  const scopeFacility = facilities.find((f) => f.id === scopeFacilityId);

  /* ---------------------------------------------------------------- actions */

  function addScopeRow() {
    setScopeRows((prev) => [
      ...prev,
      { key: newScopeKey(), label: "", facilityId: "", departmentId: "", scheduleGroupId: "" },
    ]);
  }
  /** Seed the list from the org's own facilities — the common shape of this feature. */
  function addRowPerFacility() {
    setScopeRows((prev) => {
      const already = new Set(prev.filter((r) => !r.departmentId && !r.scheduleGroupId).map((r) => r.facilityId));
      const additions = facilities
        .filter((f) => !already.has(f.id))
        .map((f) => ({
          key: newScopeKey(),
          label: f.name,
          facilityId: f.id,
          departmentId: "",
          scheduleGroupId: "",
        }));
      return [...prev, ...additions];
    });
  }
  function updateScopeRow(key: string, patch: Partial<LocalScope>) {
    setScopeRows((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeScopeRow(key: string) {
    setScopeRows((prev) => prev.filter((s) => s.key !== key));
  }
  function moveScopeRow(key: string, direction: -1 | 1) {
    setScopeRows((prev) => {
      const index = prev.findIndex((s) => s.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  /** Drag-and-drop: the dragged row takes the drop target's place. */
  function moveScopeRowTo(key: string, toKey: string) {
    setScopeRows((prev) => {
      const from = prev.findIndex((s) => s.key === key);
      const to = prev.findIndex((s) => s.key === toKey);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  const publish = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    // A row only counts once it has a facility — an empty row added and left
    // untouched is dropped rather than saved as a broken filter. An unlabelled
    // but otherwise-filled row falls back to its facility's name so it never
    // saves as a blank pill in the embed.
    const scopes = scopeRows
      .filter((s) => !!s.facilityId)
      .map((s) => ({
        label: s.label.trim() || facilities.find((f) => f.id === s.facilityId)?.name || "Schedule",
        facilityId: s.facilityId,
        departmentId: s.departmentId || null,
        scheduleGroupId: s.scheduleGroupId || null,
      }));

    const res = await fetch("/api/widget-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowedTemplates,
        primaryColor,
        customTitle: customTitle.trim() || null,
        enabledFilters,
        ...(printSupported ? { allowPrint } : {}),
        ...(multiSelectSupported ? { multiSelectLevels } : {}),
        ...(collapsedSupported ? { filtersCollapsed } : {}),
        scopes,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setSaveError(body?.error ?? "Could not publish those changes. Please try again.");
      return false;
    }

    const body = await res.json().catch(() => null);
    // Re-sync from what the server actually persisted (it applies the label
    // fallback and hands back real row ids) rather than trusting the optimistic
    // local list — that is what makes `dirty` a trustworthy "is this live yet".
    const savedRows: LocalScope[] = ((body?.scopes ?? []) as SavedScope[]).map(savedScopeToLocal);
    adoptSaved({
      allowedTemplates: body?.config?.allowed_templates ?? allowedTemplates,
      primaryColor: body?.config?.primary_color ?? primaryColor,
      customTitle: body?.config?.custom_title ?? "",
      enabledFilters: parseEnabledFilters(body?.config?.enabled_filters ?? enabledFilters),
      allowPrint: body?.config?.allow_print ?? allowPrint,
      multiSelectLevels: body?.config?.multi_select_levels
        ? parseScopeLevels(body.config.multi_select_levels)
        : multiSelectLevels,
      filtersCollapsed: body?.config?.filters_collapsed ?? filtersCollapsed,
      scopes: savedRows,
    });
    setPublishedAt(body?.config?.updated_at ?? new Date().toISOString());
    setPreviewVersion((v) => v + 1);
    return true;
  }, [allowedTemplates, primaryColor, customTitle, enabledFilters, allowPrint, printSupported, multiSelectLevels, multiSelectSupported, filtersCollapsed, collapsedSupported, scopeRows, facilities, adoptSaved]);

  /* ------------------------------------------------------------- derivations */

  // A half-typed or cleared height field must not produce a snippet that says
  // `height:px` on someone else's website, so it falls back to the default.
  const heightPx = /^\d{2,4}$/.test(height.trim()) ? height.trim() : "600";

  /**
   * The page every method points at. The script loader builds this same URL
   * from its data- attributes; the iframe method writes it out directly.
   */
  const widgetUrl = useMemo(() => {
    const url = new URL(`/widget/${orgId}`, BASE_URL);
    if (scopeFacilityId) url.searchParams.set("facilityId", scopeFacilityId);
    if (theme !== "light") url.searchParams.set("theme", theme);
    return url.toString();
  }, [orgId, scopeFacilityId, theme]);

  const shareUrl = useMemo(() => {
    if (scopeFacility?.slug && scopeFacility.isPublished) return `${BASE_URL}/facility/${scopeFacility.slug}`;
    return widgetUrl;
  }, [scopeFacility, widgetUrl]);

  // What the Copy button hands over, for whichever method is selected. The
  // link method's "snippet" is the URL itself — it goes in a menu-item field,
  // not an HTML block — which keeps one copy path and one stale check for all
  // three. Note the share URL, not `widgetUrl`: where a facility has a
  // published public page, that is the better thing to send a person to.
  const embedCode = useMemo(() => {
    if (embedMethod === "link") return shareUrl;
    if (embedMethod === "iframe") {
      return [
        `<iframe`,
        `  src="${widgetUrl}"`,
        `  title="Drop-in schedule"`,
        `  loading="lazy"`,
        `  style="width:100%;height:${heightPx}px;border:0;border-radius:12px"`,
        `></iframe>`,
      ].join("\n");
    }
    return [
      `<div id="dropin-widget"></div>`,
      `<script`,
      `  src="${BASE_URL}/embed/widget.js"`,
      `  data-org-id="${orgId}"`,
      scopeFacilityId ? `  data-facility-id="${scopeFacilityId}"` : null,
      theme !== "light" ? `  data-theme="${theme}"` : null,
      heightPx !== "600" ? `  data-height="${heightPx}"` : null,
      `  async`,
      `></script>`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [embedMethod, shareUrl, widgetUrl, orgId, scopeFacilityId, theme, heightPx]);

  // Preview reflects *unsaved* choices through the widget route's preview-only
  // params, which a real embed never sends. The theme is the preview's own
  // Light/Dark, not the snippet's.
  //
  // Relative, unlike the snippets above: the dashboard's CSP is
  // `frame-src 'self'`, so a preview pointed at BASE_URL is blocked outright
  // ("This content is blocked") whenever the dashboard is open on any other
  // origin — a Vercel alias, a preview deployment, www vs apex. The preview is
  // of this session's own app, so it belongs on whatever origin is serving it.
  const previewSrc = useMemo(() => {
    const url = new URL(`/widget/${orgId}`, "http://preview.invalid");
    if (scopeFacilityId) url.searchParams.set("facilityId", scopeFacilityId);
    if (previewTheme !== "light") url.searchParams.set("theme", previewTheme);
    url.searchParams.set("templates", allowedTemplates.join(","));
    if (/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) url.searchParams.set("primary", primaryColor);
    if (customTitle.trim()) url.searchParams.set("title", customTitle.trim().slice(0, 80));
    // Always set, even when empty: "no filters" is a real choice, and an
    // absent param would fall back to the saved value instead of showing it.
    url.searchParams.set("filters", enabledFilters.join(","));
    url.searchParams.set("print", allowPrint ? "1" : "0");
    // Always set, like filters: "one at a time everywhere" is a real choice.
    url.searchParams.set("multi", multiSelectLevels.join(","));
    url.searchParams.set("collapsed", filtersCollapsed ? "1" : "0");
    url.searchParams.set("preview", "1");
    return `${url.pathname}${url.search}`;
  }, [orgId, scopeFacilityId, previewTheme, allowedTemplates, primaryColor, customTitle, enabledFilters, allowPrint, multiSelectLevels, filtersCollapsed]);

  // Typing in the colour or title field would otherwise reload the iframe on
  // every keystroke.
  const [debouncedSrc, setDebouncedSrc] = useState(previewSrc);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSrc(previewSrc), 400);
    return () => clearTimeout(timer);
  }, [previewSrc]);

  /** Entries in the visitor-facing switcher — two or more is what renders one. */
  const filledRows = scopeRows.filter((r) => !!r.facilityId);
  const switcherCount = filledRows.length;
  const rowNames = filledRows.map(
    (r) => r.label.trim() || facilities.find((f) => f.id === r.facilityId)?.name || "Schedule"
  );

  const snippetStale = lastCopiedCode !== null && lastCopiedCode !== embedCode;

  function copyFromHeader() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setLastCopiedCode(embedCode);
      setCopiedHeader(true);
      setTimeout(() => setCopiedHeader(false), 2000);
    });
  }

  const viewSummary = allowedTemplates.map((t) => VIEW_LABELS[t]).join(", ");
  const scopeSummary =
    switcherCount === 0 ? "Everything you run" : switcherCount === 1 ? rowNames[0] : `${switcherCount} schedules, with a switcher`;
  const previewSummary = `${scopeSummary} · ${viewSummary || "no views selected"}`;

  /** Where to send someone to see the hosted page: the first facility with a published one. */
  const facilityPage = facilities.find((f) => f.isPublished && f.slug);

  /* ------------------------------------------------------------------ tiles */

  const [firstView, ...otherViews] = allowedTemplates;
  const swatch = /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : null;
  const filterCount = enabledFilters.length;

  const summaryTiles: SectionTile[] = [
    {
      section: "schedules",
      label: "Schedules",
      value:
        switcherCount === 0 ? "Everything you run" : `${switcherCount} schedule${switcherCount === 1 ? "" : "s"}`,
      note:
        switcherCount === 0
          ? "Add one to narrow it down"
          : switcherCount === 1
            ? `${rowNames[0]}, no switcher`
            : `${joinNames(rowNames)}, with a switcher`,
      attention: sectionDirty("schedules"),
    },
    {
      section: "appearance",
      label: "Appearance",
      value: (
        <>
          {swatch && (
            // The org's own colour, so an inline style: it is data, not chrome.
            <span aria-hidden className="size-4 shrink-0 rounded-full ring-1 ring-inset ring-foreground/15" style={{ backgroundColor: swatch }} />
          )}
          {firstView ? `${VIEW_LABELS[firstView]} first` : "No views"}
        </>
      ),
      note: otherViews.length ? `Also ${joinNames(otherViews.map((t) => VIEW_LABELS[t]))}` : "No other views",
      attention: sectionDirty("appearance"),
    },
    {
      section: "tools",
      label: "Visitor tools",
      value: filterCount === 0 ? "No filters" : `${filterCount} filter${filterCount === 1 ? "" : "s"}`,
      note: `Print button ${allowPrint ? "on" : "off"}`,
      attention: sectionDirty("tools"),
    },
    {
      section: "install",
      label: "Install",
      value: METHOD_NAMES[embedMethod],
      // Only a copy made on this visit can be compared, so before one the tile
      // says the code is ready rather than claiming it matches the site.
      note: snippetStale ? "Copy the code again" : lastCopiedCode ? "Code is up to date" : "Ready to copy",
      noteTone: snippetStale ? "warning" : "muted",
      attention: snippetStale,
    },
  ];

  const scheduleStepDone = visited.has("schedules") || switcherCount > 0;
  const lookStepDone = visited.has("appearance") || sectionDirty("appearance");
  const copyStepDone = lastCopiedCode !== null;
  const firstRunTiles: SectionTile[] = [
    {
      section: "schedules",
      step: 1,
      label: "Step 1",
      value: "Pick what to show",
      note: scheduleStepDone ? "Done" : "Not done yet",
      noteTone: scheduleStepDone ? "success" : "muted",
      attention: sectionDirty("schedules"),
    },
    {
      section: "appearance",
      step: 2,
      label: "Step 2",
      value: "Choose a look",
      note: lookStepDone ? "Done" : "Not done yet",
      noteTone: lookStepDone ? "success" : "muted",
      attention: sectionDirty("appearance"),
    },
    {
      section: "install",
      step: 3,
      label: "Step 3",
      value: "Copy the code",
      note: copyStepDone ? "Done" : "Not done yet",
      noteTone: copyStepDone ? "success" : "muted",
      attention: snippetStale,
    },
    // Not a step, but it has to stay reachable before the first publish.
    {
      section: "tools",
      label: "Optional",
      value: "Visitor tools",
      note: `${filterCount === 0 ? "No filters" : `${filterCount} filter${filterCount === 1 ? "" : "s"}`}, print ${allowPrint ? "on" : "off"}`,
      attention: sectionDirty("tools"),
    },
  ];

  /* ------------------------------------------------------------------ render */

  const busy = loading || saving;
  const publishLabel = saving ? "Publishing…" : firstRun ? "Publish" : dirty ? "Publish changes" : "Published";
  // Never published: publishing the defaults is a real first publish, so the
  // button stays live with nothing changed.
  const canPublish = !busy && (dirty || firstRun);

  const statusPill = saveError ? (
    <span role="alert" className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-destructive-subtle px-3 text-caption font-medium text-destructive">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
      {saveError}
    </span>
  ) : dirty ? (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-warning-subtle px-3 text-caption font-medium text-warning">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      {changed.length} unpublished change{changed.length === 1 ? "" : "s"}
    </span>
  ) : null;

  const publishButton = (
    <Button type="button" onClick={publish} disabled={!canPublish}>
      {saving ? <Loader2 className="animate-spin" /> : !dirty && !firstRun ? <Check /> : null}
      {publishLabel}
    </Button>
  );

  const publishedNote = (
    <div className="flex items-center gap-2 rounded-control bg-muted px-3 py-2 text-label font-normal text-muted-foreground">
      Changes here reach every page the widget is on as soon as you publish.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header: title, what the app knows about publishing, and the actions. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-title text-foreground">Website widget</h1>
            <InfoTip label="About this page">
              Design the schedule your visitors see, then copy the code that puts it on your site.
            </InfoTip>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            {loading
              ? "Loading…"
              : publishedAt
                ? `Published ${formatPublishedAt(publishedAt)}`
                : "Not published yet"}
            {facilityPage && (
              <>
                {" · "}
                <a
                  href={`/facility/${facilityPage.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  View your facility page
                </a>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Below 640px the status and publish actions move to the bottom bar. */}
          <div className="hidden items-center gap-2 sm:flex">
            {statusPill}
            {dirty && (
              <Button type="button" variant="ghost" onClick={discardEdits} disabled={saving}>
                Discard
              </Button>
            )}
          </div>
          <Button type="button" variant="outline" onClick={copyFromHeader}>
            {copiedHeader ? <Check /> : <Copy />}
            {copiedHeader ? "Copied" : embedMethod === "link" ? "Copy link" : "Copy embed code"}
          </Button>
          <div className="hidden sm:block">{publishButton}</div>
        </div>
      </div>

      <SectionTiles
        label={firstRun ? "Set up your widget" : "Widget settings"}
        tiles={firstRun ? firstRunTiles : summaryTiles}
        active={section}
        onSelect={selectSection}
      />

      <div className="grid grid-cols-1 items-start gap-6 studio:grid-cols-[520px_minmax(0,1fr)]">
        {/* Settings for the open tile. Every panel stays mounted (`hidden`
            when closed) so an open schedule row or a picked CMS guide survives
            a trip to another tile. */}
        <div className="min-w-0 rounded-card border border-border bg-card p-5">
          <div role="tabpanel" id={panelId("schedules")} aria-labelledby={tabId("schedules")} hidden={section !== "schedules"} className="space-y-6">
            {publishedNote}
            <section className="space-y-3">
              <SectionHeading note="In switcher order">What visitors see</SectionHeading>
              <FilterEditor
                rows={scopeRows}
                facilities={facilities}
                hasSchedules={hasSchedules}
                disabled={busy}
                onAdd={addScopeRow}
                onAddPerFacility={addRowPerFacility}
                onChange={updateScopeRow}
                onRemove={removeScopeRow}
                onMove={moveScopeRow}
                onMoveTo={moveScopeRowTo}
              />
            </section>
          </div>

          <div role="tabpanel" id={panelId("appearance")} aria-labelledby={tabId("appearance")} hidden={section !== "appearance"} className="space-y-6">
            {publishedNote}
            <section className="space-y-3">
              <SectionHeading note="The first one on loads first">Views</SectionHeading>
              <LayoutPicker
                value={allowedTemplates}
                onChange={setAllowedTemplates}
                floorplan={floorplanState}
                onAddBuildings={addRowPerFacility}
                onPickFacility={goToFacilityPicker}
                disabled={busy}
              />
            </section>

            <section className="space-y-3">
              <SectionHeading note="The bar along the top">Brand colour</SectionHeading>
              <BrandColorField value={primaryColor} onChange={setPrimaryColor} disabled={busy} />
            </section>

            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="widget-heading" className="text-body font-semibold text-foreground">
                  Heading
                </label>
                <span className="text-caption text-muted-foreground">Defaults to &ldquo;Schedule&rdquo;</span>
              </div>
              <Input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                disabled={busy}
                id="widget-heading"
                placeholder="Schedule"
              />
            </section>
          </div>

          <div role="tabpanel" id={panelId("tools")} aria-labelledby={tabId("tools")} hidden={section !== "tools"} className="space-y-6">
            {publishedNote}
            <section className="space-y-3">
              <SectionHeading note="Optional">Filters</SectionHeading>
              <VisitorFilterToggles value={enabledFilters} onChange={setEnabledFilters} disabled={busy} />
              <FiltersStartToggle
                value={filtersCollapsed}
                onChange={setFiltersCollapsed}
                disabled={busy || !collapsedSupported || enabledFilters.length === 0}
                unavailable={!loading && !collapsedSupported}
                noFilters={enabledFilters.length === 0}
              />
            </section>

            <section className="space-y-3">
              <SectionHeading>Switcher</SectionHeading>
              <MultiSelectToggles
                value={multiSelectLevels}
                onChange={setMultiSelectLevels}
                disabled={busy || !multiSelectSupported}
                unavailable={!loading && !multiSelectSupported}
              />
            </section>

            <section className="space-y-3">
              <SectionHeading>Printing</SectionHeading>
              <PrintToggle
                value={allowPrint}
                onChange={setAllowPrint}
                disabled={busy || !printSupported}
                unavailable={!loading && !printSupported}
              />
            </section>
          </div>

          <div role="tabpanel" id={panelId("install")} aria-labelledby={tabId("install")} hidden={section !== "install"} className="space-y-6">
            <div className="rounded-control bg-muted px-3 py-2 text-label font-normal text-muted-foreground">
              These options live in the code on your site. After changing one, copy the code again.
            </div>
            <InstallPanel
              embedCode={embedCode}
              method={embedMethod}
              onMethodChange={setEmbedMethod}
              theme={theme}
              onThemeChange={changeTheme}
              height={height}
              onHeightChange={setHeight}
              facilities={facilities}
              scopeFacilityId={scopeFacilityId}
              onScopeFacilityChange={setScopeFacilityId}
              switcherCount={switcherCount}
              shareUrl={shareUrl}
              snippetStale={snippetStale}
              onCopyCode={() => setLastCopiedCode(embedCode)}
              trustedHosts={trustedHosts}
              canManageTrustedSites={canManageTrustedSites}
            />
          </div>
        </div>

        <PreviewPanel
          src={debouncedSrc}
          version={previewVersion}
          dirty={dirty}
          theme={previewTheme}
          onThemeChange={setPreviewTheme}
          onOpenFullScreen={() => setPreviewOpen(true)}
        />
      </div>

      {/* Below 640px only: the header's publish actions, on a bar that rides
          the bottom of the viewport while there is something to publish. It
          sits on --tabbar-clearance (published by DashboardBottomNav), since
          the tab bar is z-50 and would otherwise cover it. */}
      {(dirty || saveError || firstRun) && (
        <div className="sticky bottom-[calc(var(--tabbar-clearance,86px)+0.75rem)] z-20 transition-[bottom] duration-300 ease-out motion-reduce:transition-none sm:hidden">
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 rounded-banner px-3 py-2 shadow-lg",
              saveError ? "bg-destructive-subtle" : dirty ? "bg-warning-subtle" : "bg-card border border-border"
            )}
          >
            <p
              role={saveError ? "alert" : undefined}
              className={cn(
                "min-w-0 flex-1 text-caption font-medium",
                saveError ? "text-destructive" : dirty ? "text-warning" : "text-muted-foreground"
              )}
            >
              {saveError ??
                (dirty
                  ? `${changed.length} unpublished change${changed.length === 1 ? "" : "s"}`
                  : "Not published yet")}
            </p>
            <div className="flex items-center gap-1">
              {dirty && (
                <Button type="button" variant="ghost" onClick={discardEdits} disabled={saving}>
                  Discard
                </Button>
              )}
              {publishButton}
            </div>
          </div>
        </div>
      )}

      <PreviewWindow
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        src={debouncedSrc}
        version={previewVersion}
        onRefresh={() => setPreviewVersion((v) => v + 1)}
        summary={previewSummary}
        dirty={dirty}
        primaryColor={primaryColor}
        onPrimaryColorChange={setPrimaryColor}
        theme={previewTheme}
        onThemeChange={setPreviewTheme}
      />
    </div>
  );
}
