"use client";

import { useState, useCallback } from "react";
import { Check, Copy, ExternalLink, Code2, Eye } from "lucide-react";

interface WidgetConfiguratorProps {
  orgId: string;
  orgSlug: string;
  facilities: { id: string; name: string }[];
}

type Theme = "light" | "dark";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

export default function WidgetConfigurator({ orgId, orgSlug, facilities }: WidgetConfiguratorProps) {
  const [facilityId, setFacilityId] = useState<string>("");
  const [theme, setTheme] = useState<Theme>("light");
  const [height, setHeight] = useState<string>("600");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");

  // Build iframe src for preview
  const iframeSrc = (() => {
    const url = new URL(`/widget/${orgId}`, BASE_URL);
    if (facilityId) url.searchParams.set("facilityId", facilityId);
    if (theme !== "light") url.searchParams.set("theme", theme);
    return url.toString();
  })();

  // Build the embed snippet
  const embedCode = [
    `<div id="dropin-widget"></div>`,
    `<script`,
    `  src="${BASE_URL}/embed/widget.js"`,
    `  data-org-id="${orgId}"`,
    facilityId ? `  data-facility-id="${facilityId}"` : null,
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
          {/* Facility filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Facility <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <select
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All facilities</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Show sessions from one facility only.</p>
          </div>

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
