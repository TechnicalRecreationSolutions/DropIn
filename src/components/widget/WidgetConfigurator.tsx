"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Code2, Eye, LayoutGrid, List, Columns3, Image as ImageIcon } from "lucide-react";

interface WidgetConfiguratorProps {
  orgId: string;
  orgSlug: string;
  facilities: { id: string; name: string }[];
  /** When set, the widget config is locked to this facility/department scope — hides the pickers. */
  lockedFacilityId?: string;
  lockedDepartmentId?: string;
}

type Theme = "light" | "dark";
type Template = "grid" | "list" | "map" | "floorplan";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

const TEMPLATE_OPTIONS: { value: Template; label: string; icon: typeof LayoutGrid }[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
  { value: "map", label: "Map", icon: Columns3 },
  { value: "floorplan", label: "Floorplan", icon: ImageIcon },
];

export default function WidgetConfigurator({
  orgId,
  orgSlug,
  facilities,
  lockedFacilityId,
  lockedDepartmentId,
}: WidgetConfiguratorProps) {
  const scopeLocked = !!lockedFacilityId;
  const [facilityId, setFacilityId] = useState<string>(lockedFacilityId ?? "");
  const [departmentId, setDepartmentId] = useState<string>(lockedDepartmentId ?? "");
  const [theme, setTheme] = useState<Theme>("light");
  const [height, setHeight] = useState<string>("600");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");

  const [allowedTemplates, setAllowedTemplates] = useState<Template[]>(["grid", "list", "map"]);
  const [primaryColor, setPrimaryColor] = useState("#0066CC");
  const [secondaryColor, setSecondaryColor] = useState("#FFFFFF");
  const [customTitle, setCustomTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleFacilityChange(newFacilityId: string) {
    setFacilityId(newFacilityId);
    // A department belongs to exactly one facility, so switching facilities
    // invalidates any previously selected department.
    setDepartmentId("");
  }

  const { data: departmentsData } = useQuery({
    queryKey: ["widget-departments", facilityId],
    queryFn: async () => {
      const res = await fetch(`/api/departments?facilityId=${facilityId}`);
      if (!res.ok) throw new Error(`Failed to load departments (${res.status})`);
      const data = await res.json();
      return (data.departments ?? []) as { id: string; name: string }[];
    },
    enabled: !!facilityId,
  });
  const departments = departmentsData ?? [];

  // Floorplan is scoped to exactly one facility, so it can only be enabled
  // once that facility has a published facility_maps row to show — an org
  // shouldn't be able to turn on a widget view with nothing to render.
  const { data: facilityMapData } = useQuery({
    queryKey: ["widget-facility-map", facilityId],
    queryFn: async () => {
      const res = await fetch(`/api/facility-maps?facilityId=${facilityId}`);
      if (!res.ok) throw new Error(`Failed to load facility map (${res.status})`);
      const data = await res.json();
      return data.facilityMap as { is_published: boolean } | null;
    },
    enabled: !!facilityId,
  });
  const floorplanAvailable = !!facilityId && !!facilityMapData?.is_published;

  // Load the widget config for the current (facility, department) scope
  const { data: widgetConfigData, isLoading: loading } = useQuery({
    queryKey: ["widget-config", orgId, facilityId, departmentId],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId });
      if (facilityId) params.set("facilityId", facilityId);
      if (departmentId) params.set("departmentId", departmentId);
      const res = await fetch(`/api/widget-config?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load widget config (${res.status})`);
      return res.json();
    },
  });

  // Sync loaded config into editable local state — this is the one legitimate
  // "seed local edit state from a query result" case, not a derived value.
  useEffect(() => {
    if (!widgetConfigData?.config) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllowedTemplates(widgetConfigData.config.allowed_templates ?? ["grid", "list", "map"]);
    setPrimaryColor(widgetConfigData.config.primary_color ?? "#0066CC");
    setSecondaryColor(widgetConfigData.config.secondary_color ?? "#FFFFFF");
    setCustomTitle(widgetConfigData.config.custom_title ?? "");
  }, [widgetConfigData]);

  function toggleTemplate(value: Template) {
    setAllowedTemplates((prev) => {
      if (prev.includes(value)) {
        // At least one view must stay enabled — ignore the toggle if it would empty the set.
        return prev.length === 1 ? prev : prev.filter((t) => t !== value);
      }
      return [...prev, value];
    });
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/widget-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facilityId: facilityId || null,
        departmentId: departmentId || null,
        allowedTemplates,
        primaryColor,
        secondaryColor,
        customTitle: customTitle || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [facilityId, departmentId, allowedTemplates, primaryColor, secondaryColor, customTitle]);

  // Build iframe src for preview — `preview=1` lets this iframe reflect an
  // unsaved allowed-views choice; the real embed ignores `templates` unless it's set.
  const iframeSrc = (() => {
    const url = new URL(`/widget/${orgId}`, BASE_URL);
    if (facilityId) url.searchParams.set("facilityId", facilityId);
    if (departmentId) url.searchParams.set("departmentId", departmentId);
    if (theme !== "light") url.searchParams.set("theme", theme);
    url.searchParams.set("templates", allowedTemplates.join(","));
    url.searchParams.set("preview", "1");
    return url.toString();
  })();

  // Build the embed snippet
  const embedCode = [
    `<div id="dropin-widget"></div>`,
    `<script`,
    `  src="${BASE_URL}/embed/widget.js"`,
    `  data-org-id="${orgId}"`,
    facilityId ? `  data-facility-id="${facilityId}"` : null,
    departmentId ? `  data-department-id="${departmentId}"` : null,
    theme !== "light" ? `  data-theme="${theme}"` : null,
    height !== "600" ? `  data-height="${height}"` : null,
    `  async`,
    `></script>`,
  ]
    .filter(Boolean)
    .join("\n");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [embedCode]);

  return (
    <div className="space-y-6">
      {/* Configuration */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900">Configuration</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Facility filter — hidden when scope is locked by the current tree node */}
          {scopeLocked ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
              <p className="px-3 py-2.5 text-sm text-gray-700 bg-gray-100 rounded-lg">
                {facilities.find((f) => f.id === facilityId)?.name ?? "This facility"}
                {lockedDepartmentId && departments.find((d) => d.id === lockedDepartmentId)
                  ? ` › ${departments.find((d) => d.id === lockedDepartmentId)?.name}`
                  : ""}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                This embed is scoped to the facility/department you navigated from.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Facility <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <select
                value={facilityId}
                onChange={(e) => handleFacilityChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All facilities</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Show sessions from one facility only.</p>
            </div>
          )}

          {/* Department filter — only shown once a facility with departments is selected, and never when locked */}
          {!scopeLocked && facilityId && departments.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Department <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Each facility + department combination has its own embed and appearance.
              </p>
            </div>
          )}

          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Theme</label>
            <div className="flex gap-2">
              {(["light", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors capitalize ${
                    theme === t
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Height */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Initial height <span className="font-normal text-gray-400">(px)</span>
            </label>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              min={300}
              max={1200}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Auto-adjusts after load.</p>
          </div>
        </div>
      </div>

      {/* Appearance — persisted to widget_configs */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900">Appearance</h2>

        {/* Schedule layouts */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Schedule layouts</label>
          <div className="flex gap-2">
            {TEMPLATE_OPTIONS.map(({ value, label, icon: Icon }) => {
              const checked = allowedTemplates.includes(value);
              const disabled = loading || (value === "floorplan" && !floorplanAvailable);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleTemplate(value)}
                  disabled={disabled}
                  aria-pressed={checked}
                  title={
                    value === "floorplan" && !floorplanAvailable
                      ? "Publish a facility map first (Map tab) to enable this layout."
                      : undefined
                  }
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                    checked
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Choose which layouts visitors can switch between. Applies to both the embedded widget
            and your public schedule page — the first enabled layout loads by default. Floorplan
            requires a published facility map and a single facility scope.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                disabled={loading}
                className="w-10 h-10 rounded-lg border border-gray-300 disabled:opacity-50"
              />
              <span className="text-sm text-gray-500 font-mono">{primaryColor}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Secondary color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                disabled={loading}
                className="w-10 h-10 rounded-lg border border-gray-300 disabled:opacity-50"
              />
              <span className="text-sm text-gray-500 font-mono">{secondaryColor}</span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Custom title <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            disabled={loading}
            placeholder="e.g. This Week's Drop-In Schedule"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" /> Saved
            </>
          ) : saving ? (
            "Saving…"
          ) : (
            "Save appearance"
          )}
        </button>
      </div>

      {/* Code / Preview tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {(["code", "preview"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "code" ? <Code2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === "code" && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">Paste this into your website&apos;s HTML</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-green-600">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="bg-gray-950 text-green-300 text-xs rounded-lg p-4 overflow-x-auto whitespace-pre leading-relaxed font-mono">
              {embedCode}
            </pre>
          </div>
        )}

        {activeTab === "preview" && (
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-3">
              Live preview — shows your published sessions.
            </p>
            <div className="rounded-xl overflow-hidden border border-gray-200">
              <iframe
                src={iframeSrc}
                style={{ width: "100%", height: `${height}px`, border: "none" }}
                title="Widget preview"
              />
            </div>
          </div>
        )}
      </div>

      {/* Public schedule link */}
      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
        <ExternalLink className="w-4 h-4 text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">Public schedule page</p>
          <p className="text-xs text-gray-500 truncate">
            {BASE_URL}/org/{orgSlug}
          </p>
        </div>
        <a
          href={`${BASE_URL}/org/${orgSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
        >
          Open ↗
        </a>
      </div>
    </div>
  );
}
