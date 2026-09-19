"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, Copy, Eye, Loader2, Moon, Sun, Sparkles } from "lucide-react";
import {
  DEFAULT_ENABLED_FILTERS,
  parseEnabledFilters,
  type SessionFilterKey,
} from "@/lib/schedule/sessionFilters";
import { cn } from "@/lib/utils/cn";
import BrandColorField from "./BrandColorField";
import FilterEditor from "./FilterEditor";
import InstallPanel from "./InstallPanel";
import LayoutPicker, { type FloorplanState, type MapStatus } from "./LayoutPicker";
import PreviewWindow from "./PreviewWindow";
import VisitorFilterToggles from "./VisitorFilterToggles";
import PrintToggle from "./PrintToggle";
import StepCard from "@/components/ui/step-card";
import {
  SCOPE_FACILITY_SELECT_ID,
  publishedSignature,
  savedScopeToLocal,
  type EmbedMethod,
  type LocalScope,
  type PublishedSettings,
  type SavedScope,
  type ScheduleTemplate,
  type WidgetFacility,
  type WidgetTheme,
} from "./types";

interface WidgetStudioProps {
  orgId: string;
  facilities: WidgetFacility[];
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

const TEMPLATE_NAMES: Record<ScheduleTemplate, string> = {
  grid: "Week grid",
  list: "List",
  map: "By space",
  board: "Timetable",
  floorplan: "Floorplan",
};

let scopeKeySeq = 0;
function newScopeKey() {
  scopeKeySeq += 1;
  return `new-${scopeKeySeq}`;
}

/**
 * `/dashboard/widget` — the publishing studio.
 *
 * Structure follows the job rather than the schema: pick what to show, design
 * it, optionally let visitors filter, then take the code. The steps get the
 * full page width; the preview opens as a near-fullscreen window (see
 * `PreviewWindow`) from the header, the floating pill, or the publish bar,
 * because at 420px in a side column it was both cramped and expensive.
 *
 * Step 1 carries *both* facility-shaped controls — the scope tiles and the
 * visitor-facing switcher list — because they answer the same question and the
 * list wins: with entries in it, `WidgetScheduleClient` renders the selected
 * entry's facility and department rather than the config's. Splitting them
 * (tiles in step 1, list in step 3) hid that override behind a page of
 * scrolling, so an admin could set the embed to one facility and, without any
 * warning, publish another. They now sit together, the first entry is seeded
 * from the tiles, and the tiles say what they still decide.
 *
 * The one distinction the layout is built to protect: **published settings vs
 * snippet options.** Layouts, colour, title and filters are written to
 * `widget_configs`/`widget_config_scopes` and change the live embed *and* the
 * public schedule page — they publish together, from the one bar at the bottom.
 * Theme and height only exist inside the `<script>` tag on the customer's own
 * site, so changing them does nothing until the code is re-copied and re-pasted;
 * the code panel says so when it happens. Mixing those two sets in one card is
 * what made the old page's "I changed it and nothing happened" reports.
 */
export default function WidgetStudio({ orgId, facilities }: WidgetStudioProps) {
  // Published settings.
  const [allowedTemplates, setAllowedTemplates] = useState<ScheduleTemplate[]>(["grid", "list", "map"]);
  const [primaryColor, setPrimaryColor] = useState("#0066CC");
  const [customTitle, setCustomTitle] = useState("");
  const [enabledFilters, setEnabledFilters] = useState<SessionFilterKey[]>(DEFAULT_ENABLED_FILTERS);
  const [allowPrint, setAllowPrint] = useState(false);
  const [scopeRows, setScopeRows] = useState<LocalScope[]>([]);
  /** The last state the server confirmed — the baseline for "unsaved changes" and for Discard. */
  const [savedState, setSavedState] = useState<PublishedSettings | null>(null);

  // Snippet options — these never touch the database.
  const [theme, setTheme] = useState<WidgetTheme>("light");
  const [height, setHeight] = useState("600");
  const [embedMethod, setEmbedMethod] = useState<EmbedMethod>("script");
  /** Narrows this copy of the snippet to one facility; "" = the whole schedule. */
  const [scopeFacilityId, setScopeFacilityId] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  const [copiedHeader, setCopiedHeader] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  /** The snippet text as it stood the last time it was copied, or null if never. */
  const [lastCopiedCode, setLastCopiedCode] = useState<string | null>(null);

  // Floorplan is drawn per building, so the embed needs one — in the same
  // order of precedence the widget itself uses: the snippet's own scope
  // (step 4), else the step 1 switcher (the map follows the visitor's pick, so
  // every entry's building counts), else the org's only building.
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

  /** "Choose a building" on the locked Floorplan card — step 4 is a page away. */
  function goToFacilityPicker() {
    const select = document.getElementById(SCOPE_FACILITY_SELECT_ID);
    select?.scrollIntoView({ behavior: "smooth", block: "center" });
    select?.focus({ preventScroll: true });
  }

  const { data: widgetConfigData, isLoading: loading } = useQuery({
    queryKey: ["widget-config", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/widget-config?orgId=${orgId}`);
      if (!res.ok) throw new Error(`Failed to load widget config (${res.status})`);
      return res.json() as Promise<{
        config: {
          allowed_templates?: ScheduleTemplate[];
          primary_color?: string;
          custom_title?: string | null;
          enabled_filters?: string[];
          allow_print?: boolean;
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
      scopes: (widgetConfigData.scopes ?? []).map(savedScopeToLocal),
    });
  }, [widgetConfigData, adoptSaved]);

  /** Throw away local edits and go back to what is actually live. */
  function discardEdits() {
    if (savedState) adoptSaved(savedState);
  }

  // Migrations are applied by hand, so the column can lag the code. The row is
  // read with `*`, so a missing key means 051 hasn't landed — and sending
  // allowPrint then would fail the whole publish, not just this toggle.
  const printSupported = !!widgetConfigData && "allow_print" in widgetConfigData.config;

  const currentSignature = publishedSignature({ allowedTemplates, primaryColor, customTitle, enabledFilters, allowPrint, scopes: scopeRows });
  const dirty = savedState !== null && currentSignature !== publishedSignature(savedState);

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
      scopes: savedRows,
    });
    setPreviewVersion((v) => v + 1);
    setJustPublished(true);
    setTimeout(() => setJustPublished(false), 2500);
    return true;
  }, [allowedTemplates, primaryColor, customTitle, enabledFilters, allowPrint, printSupported, scopeRows, facilities, adoptSaved]);

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
  // params, which a real embed never sends.
  const previewSrc = useMemo(() => {
    const url = new URL(`/widget/${orgId}`, BASE_URL);
    if (scopeFacilityId) url.searchParams.set("facilityId", scopeFacilityId);
    if (theme !== "light") url.searchParams.set("theme", theme);
    url.searchParams.set("templates", allowedTemplates.join(","));
    if (/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) url.searchParams.set("primary", primaryColor);
    if (customTitle.trim()) url.searchParams.set("title", customTitle.trim().slice(0, 80));
    // Always set, even when empty: "no filters" is a real choice, and an
    // absent param would fall back to the saved value instead of showing it.
    url.searchParams.set("filters", enabledFilters.join(","));
    url.searchParams.set("print", allowPrint ? "1" : "0");
    url.searchParams.set("preview", "1");
    return url.toString();
  }, [orgId, scopeFacilityId, theme, allowedTemplates, primaryColor, customTitle, enabledFilters, allowPrint]);

  // Typing in the colour or title field would otherwise reload the iframe on
  // every keystroke.
  const [debouncedSrc, setDebouncedSrc] = useState(previewSrc);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSrc(previewSrc), 400);
    return () => clearTimeout(timer);
  }, [previewSrc]);

  const viewSummary = allowedTemplates.map((t) => TEMPLATE_NAMES[t]).join(", ");
  /** Entries in the visitor-facing switcher — two or more is what renders one. */
  const filledRows = scopeRows.filter((r) => !!r.facilityId);
  const switcherCount = filledRows.length;

  /** What the embed shows, said the way the list says it. */
  const scopeSummary =
    switcherCount === 0
      ? "Everything you run"
      : switcherCount === 1
        ? filledRows[0].label.trim() ||
          facilities.find((f) => f.id === filledRows[0].facilityId)?.name ||
          "One schedule"
        : `${switcherCount} schedules, with a switcher`;
  /** …and, on top of that, what this particular copy of the code narrows to. */
  const snippetSummary = scopeFacility ? `${scopeFacility.name} only` : null;
  const snippetStale = lastCopiedCode !== null && lastCopiedCode !== embedCode;

  function copyFromHeader() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setLastCopiedCode(embedCode);
      setCopiedHeader(true);
      setTimeout(() => setCopiedHeader(false), 2000);
    });
  }

  const previewSummary = `${scopeSummary} · ${viewSummary || "no views selected"}`;

  /* ------------------------------------------------------------------ render */

  return (
    <div className="space-y-5">
      {/* Headline CTA — what this embed is, whether it's live, and the code. */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-white p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 text-[11px] font-semibold uppercase tracking-wide">
                <Sparkles className="w-3 h-3" />
                Your embed
              </span>
              <StatusChip dirty={dirty} justPublished={justPublished} loading={loading} />
            </div>
            <p className="mt-2 text-lg font-semibold leading-snug">{scopeSummary}</p>
            <p className="text-sm text-blue-100 mt-0.5">
              {viewSummary || "No views selected"}
              {snippetSummary ? ` · this code: ${snippetSummary}` : ""}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={copyFromHeader}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white text-blue-700 text-sm font-semibold hover:bg-blue-50 transition-colors"
            >
              {copiedHeader ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedHeader ? "Copied!" : embedMethod === "link" ? "Copy link" : "Copy embed code"}
            </button>
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25 transition-colors"
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>
        </div>
      </div>

      <StepCard
        step={1}
        title="What should it show?"
        description="One list. Leave it empty for everything you run, name one schedule to show just that, or add several and visitors get a switcher."
        meta={<SavedBadge />}
      >
        <FilterEditor
          rows={scopeRows}
          facilities={facilities}
          primaryColor={/^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : "#0066CC"}
          disabled={loading || saving}
          onAdd={addScopeRow}
          onAddPerFacility={addRowPerFacility}
          onChange={updateScopeRow}
          onRemove={removeScopeRow}
          onMove={moveScopeRow}
        />
      </StepCard>

      <StepCard
        step={2}
        title="Make it yours"
        description="Choose the views visitors can use and match your brand. Open the preview to see it full size."
        meta={<SavedBadge />}
      >
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-medium text-foreground">Views visitors can switch between</h3>
            <p className="text-xs text-muted-foreground">
              The one marked <span className="font-medium text-foreground">Loads first</span> is what
              they see on arrival.
            </p>
          </div>
          <LayoutPicker
            value={allowedTemplates}
            onChange={setAllowedTemplates}
            floorplan={floorplanState}
            onAddBuildings={addRowPerFacility}
            onPickFacility={goToFacilityPicker}
            disabled={loading || saving}
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Brand colour</h3>
          <BrandColorField value={primaryColor} onChange={setPrimaryColor} disabled={loading || saving} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1">Heading</span>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              disabled={loading || saving}
              placeholder="Schedule"
              aria-label="Widget heading"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <span className="block text-xs text-muted-foreground mt-1">
              Shown in the coloured bar. Defaults to &ldquo;Schedule&rdquo;.
            </span>
          </label>

          <div>
            <span className="block text-sm font-medium text-foreground mb-1">Theme</span>
            <div className="flex gap-2">
              {([
                { value: "light" as const, label: "Light", Icon: Sun },
                { value: "dark" as const, label: "Dark", Icon: Moon },
              ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg border transition-colors",
                    theme === value
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-border text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
            <span className="block text-xs text-muted-foreground mt-1">
              Travels in the embed code — re-copy it in step 4 after changing.
            </span>
          </div>
        </div>
      </StepCard>

      <StepCard
        step={3}
        title="Let visitors find their session"
        description="Optional. Filters that narrow whatever schedule is on screen — by what it is and when it runs — and a button to print the result."
        meta={<SavedBadge />}
      >
        <VisitorFilterToggles
          value={enabledFilters}
          onChange={setEnabledFilters}
          disabled={loading || saving}
        />

        <PrintToggle
          value={allowPrint}
          onChange={setAllowPrint}
          disabled={loading || saving || !printSupported}
          unavailable={!loading && !printSupported}
        />
      </StepCard>

      <StepCard
        step={4}
        title="Put it on your website"
        description="Pick whichever your site allows, then copy it in — or send it to whoever looks after the site."
      >
        <InstallPanel
          embedCode={embedCode}
          method={embedMethod}
          onMethodChange={setEmbedMethod}
          height={height}
          onHeightChange={setHeight}
          facilities={facilities}
          scopeFacilityId={scopeFacilityId}
          onScopeFacilityChange={setScopeFacilityId}
          switcherCount={switcherCount}
          shareUrl={shareUrl}
          snippetStale={snippetStale}
          onCopyCode={() => setLastCopiedCode(embedCode)}
        />
      </StepCard>

      {/* Publish bar — the single home for everything the database keeps.
          Sticky as the last flow child so it rides the bottom of the
          viewport instead of hiding at the end of a long page. bottom-20 on
          mobile clears the fixed dashboard tab bar, which sits at z-50 and
          would otherwise cover this. */}
      {(dirty || saveError) && (
        <div className="sticky bottom-20 lg:bottom-3 z-20">
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/70 backdrop-blur px-4 py-3 shadow-lg flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {saveError ?? "Not live yet"}
              </p>
              {!saveError && (
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                  Your views, colour, heading, filters and print button change for visitors only once you publish.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {/* The floating Preview pill hides while this bar is up, so
                  it moves in here rather than disappearing. */}
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
              <button
                type="button"
                onClick={discardEdits}
                disabled={saving}
                className="px-3 py-2 text-sm font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg transition-colors disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? "Publishing…" : "Publish changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reachable from anywhere on a long page, without stealing a column from
          the steps. Steps aside for the publish bar, which carries its own. */}
      {!dirty && !saveError && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-foreground text-background text-sm font-semibold shadow-lg hover:opacity-90 transition-opacity"
        >
          <Eye className="w-4 h-4" />
          Preview
        </button>
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
        theme={theme}
        onThemeChange={setTheme}
      />

    </div>
  );
}

function StatusChip({
  dirty,
  justPublished,
  loading,
}: {
  dirty: boolean;
  justPublished: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 text-[11px] font-medium">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading
      </span>
    );
  }
  if (justPublished) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-400 text-green-950 text-[11px] font-semibold">
        <Check className="w-3 h-3" />
        Published
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold",
        dirty ? "bg-amber-300 text-amber-950" : "bg-white/15 text-white"
      )}
    >
      <span className={cn("size-1.5 rounded-full", dirty ? "bg-amber-700" : "bg-green-400")} />
      {dirty ? "Unsaved changes" : "Live"}
    </span>
  );
}

/** Marks the sections whose settings are stored, not baked into the snippet. */
function SavedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
      Published with the widget
    </span>
  );
}
