"use client";

import { useState } from "react";
import { Check, Code2, Copy, ExternalLink, Frame, Link2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { InfoTip, LabelWithInfo } from "@/components/ui/info-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SCOPE_FACILITY_SELECT_ID, type EmbedMethod, type WidgetFacility } from "./types";

interface InstallPanelProps {
  /** The snippet for the current method — HTML for script/iframe, the URL itself for link. */
  embedCode: string;
  method: EmbedMethod;
  onMethodChange: (value: EmbedMethod) => void;
  height: string;
  onHeightChange: (value: string) => void;
  facilities: WidgetFacility[];
  /** Snippet-only: narrows this copy of the embed to one facility. "" = everything. */
  scopeFacilityId: string;
  onScopeFacilityChange: (value: string) => void;
  /** How many switcher entries the org has, for wording the scope control's hint. */
  switcherCount: number;
  /** Direct URL to the widget page — the fallback for sites that can't run scripts. */
  shareUrl: string;
  /** True once a snippet option changed after the code was last copied. */
  snippetStale: boolean;
  onCopyCode: () => void;
}

const METHODS: {
  id: EmbedMethod;
  name: string;
  Icon: typeof Code2;
  tagline: string;
  /** The one-line honest trade-off, shown under the code. */
  note: string;
}[] = [
  {
    id: "script",
    name: "Script",
    Icon: Code2,
    tagline: "Recommended",
    note: "Grows and shrinks with the schedule, so there's never a scrollbar inside your page. Needs a site that allows a <script> tag.",
  },
  {
    id: "iframe",
    name: "iFrame",
    Icon: Frame,
    tagline: "No scripts needed",
    note: "Works anywhere an embed or HTML block is allowed, including CMSes that strip scripts out. The box stays the height you set below and scrolls inside if the schedule is taller.",
  },
  {
    id: "link",
    name: "Link",
    Icon: Link2,
    tagline: "Nothing to embed",
    note: "Send people to the schedule instead of putting it on your page — the same views, filters and colours, hosted for you. Good for a menu item, a button, a newsletter or a QR code.",
  },
];

const CMS_GUIDES: { id: string; name: string; steps: Record<"script" | "iframe", string[]> }[] = [
  {
    id: "wordpress",
    name: "WordPress",
    steps: {
      script: [
        "Edit the page where the schedule should appear.",
        'Add a block, search for "Custom HTML", and choose it.',
        "Paste the code into the block, then Update the page.",
      ],
      iframe: [
        "Edit the page where the schedule should appear.",
        'Add a block, search for "Custom HTML", and choose it.',
        "Paste the code into the block, then Update the page.",
      ],
    },
  },
  {
    id: "squarespace",
    name: "Squarespace",
    steps: {
      script: [
        "Edit the page and click an insert point.",
        'Choose the "Code" block from the block menu.',
        "Paste the code, click outside the block, then Save.",
      ],
      iframe: [
        "Edit the page and click an insert point.",
        'Choose the "Embed" block, then switch it to code entry.',
        "Paste the code, click outside the block, then Save.",
      ],
    },
  },
  {
    id: "wix",
    name: "Wix",
    steps: {
      script: [
        "In the editor, click Add → Embed → Embed a Widget.",
        'Click "Enter Code" and paste the code.',
        "Drag the box to size it, then Publish.",
      ],
      iframe: [
        "In the editor, click Add → Embed → Embed a Site.",
        'Click "Enter Code" and paste the code.',
        "Drag the box to size it, then Publish.",
      ],
    },
  },
  {
    id: "other",
    name: "Any site",
    steps: {
      script: [
        "Open the page's HTML where the schedule should appear.",
        "Paste the code exactly as it is, including both lines.",
        "Save and reload — the widget sizes itself to fit.",
      ],
      iframe: [
        "Open the page's HTML where the schedule should appear.",
        "Paste the code exactly as it is.",
        "Save and reload, then adjust the height above if you want a taller box.",
      ],
    },
  },
];

const LINK_PLACES = [
  "Add it as a menu item — label it “Drop-in Schedule”.",
  "Point an existing button or tile at it.",
  "Paste it into a newsletter, poster QR code, or social bio.",
];

/**
 * Step 4 — the payoff.
 *
 * Two audiences read this section: the staff member who copies the code, and
 * the (often external) web person who pastes it. It has to be portable enough
 * to survive being emailed, and it has to offer a way out for the many
 * municipal CMSes that block `<script>` outright — hence the iframe and link
 * methods sitting alongside the script one rather than buried under it.
 *
 * The method lives in `WidgetStudio` rather than here, because the header's
 * "Copy" button copies the same snippet and the stale-code badge compares
 * against it.
 */
export default function InstallPanel({
  embedCode,
  method,
  onMethodChange,
  height,
  onHeightChange,
  facilities,
  scopeFacilityId,
  onScopeFacilityChange,
  switcherCount,
  shareUrl,
  snippetStale,
  onCopyCode,
}: InstallPanelProps) {
  const [copied, setCopied] = useState(false);
  const [guide, setGuide] = useState(CMS_GUIDES[0].id);

  function copy() {
    navigator.clipboard.writeText(embedCode).then(() => {
      onCopyCode();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const activeMethod = METHODS.find((m) => m.id === method) ?? METHODS[0];
  const activeGuide = CMS_GUIDES.find((g) => g.id === guide) ?? CMS_GUIDES[0];
  const isLink = method === "link";

  return (
    <div className="space-y-5">
      {/* Method first: everything below reads differently depending on it. */}
      <div>
        <span className="block text-body font-medium text-foreground mb-2">
          How do you want to add it?
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {METHODS.map(({ id, name, Icon, tagline }) => (
            <button
              key={id}
              type="button"
              onClick={() => onMethodChange(id)}
              aria-pressed={method === id}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-card border text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                method === id
                  ? "border-brand bg-brand-subtle"
                  : "border-border bg-card hover:bg-muted"
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  method === id ? "text-brand-strong" : "text-muted-foreground"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-foreground">{name}</span>
                <span className="block text-caption text-muted-foreground truncate">{tagline}</span>
              </span>
              {method === id && <Check aria-hidden className="size-4 shrink-0 text-brand" />}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-label text-muted-foreground">
              {isLink ? "Schedule link" : "Embed code"}
            </span>
            {snippetStale && (
              <Badge variant="warning">
                <RefreshCw />
                Updated — copy again
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isLink && (
              <Button asChild variant="ghost" size="sm">
                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Open
                </a>
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : isLink ? "Copy link" : "Copy code"}
            </Button>
          </div>
        </div>
        {isLink ? (
          // Selectable input rather than a <pre>: this one gets dragged into an
          // address bar or a menu-item field, not pasted into an HTML block.
          <Input
            readOnly
            value={embedCode}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Public schedule link"
            className="h-12 border-transparent bg-muted px-4 font-mono text-caption md:text-caption"
          />
        ) : (
          <pre className="p-4 overflow-x-auto rounded-control bg-muted text-caption font-mono text-foreground whitespace-pre">
            {embedCode}
          </pre>
        )}
      </div>

      <p className="text-caption text-muted-foreground -mt-2">{activeMethod.note}</p>

      {/* Per-page scoping — a property of *this copy of the code*, not of the
          saved settings. One organisation's look and one schedule list, but the
          arena's page can still carry an arena-only embed: the facility rides
          in the snippet (data-facility-id / the URL), and the widget narrows
          its switcher to that facility's entries. Deliberately here and not in
          step 1: it changes nothing until the code is copied and pasted. */}
      {facilities.length > 1 && (
        <div>
          <LabelWithInfo
            htmlFor={SCOPE_FACILITY_SELECT_ID}
            className="block text-caption font-medium text-foreground"
            info="Only needed if your website has a separate page per building. Pick it here and this copy of the code shows just that building. Re-copy the code after changing."
          >
            Building page
          </LabelWithInfo>
          <NativeSelect
            id={SCOPE_FACILITY_SELECT_ID}
            value={scopeFacilityId}
            onChange={(e) => onScopeFacilityChange(e.target.value)}
            wrapperClassName="sm:max-w-sm"
          >
            <option value="">No — show everything from step 1</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}’s page only
                {f.isPublished ? "" : " — draft"}
              </option>
            ))}
          </NativeSelect>
          {scopeFacilityId && (
            <span className="block text-caption text-muted-foreground mt-1.5">
              {switcherCount > 1
                ? "This code shows only that facility, and its switcher only lists that facility's schedules."
                : "This code shows only that facility."}
            </span>
          )}
        </div>
      )}

      {!isLink && (
        <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3 sm:items-start">
          <label className="block">
            <span className="flex items-center gap-1.5 text-caption font-medium text-foreground mb-1.5">
              {method === "iframe" ? "Height" : "Starting height"}
              <InfoTip>
                {method === "iframe"
                  ? "The box stays this tall. A week grid usually needs 700–900px."
                  : "Only used until the schedule loads. After that, the widget sizes itself."}
              </InfoTip>
            </span>
            <div className="relative">
              <Input
                type="number"
                value={height}
                onChange={(e) => onHeightChange(e.target.value)}
                min={300}
                max={1200}
                className="pr-9"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted-foreground">
                px
              </span>
            </div>
          </label>
        </div>
      )}

      {isLink ? (
        <div className="rounded-card border border-border p-4 sm:p-5">
          <p className="text-card-title text-foreground">Where do I put this?</p>
          <ol className="mt-3 space-y-2">
            {LINK_PLACES.map((place, i) => (
              <li key={i} className="flex gap-2.5 text-body text-muted-foreground">
                <span className="shrink-0 inline-flex items-center justify-center size-5 rounded-full bg-muted text-label font-semibold text-foreground tabular-nums">
                  {i + 1}
                </span>
                {place}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-caption text-muted-foreground">
            The link stays the same when you publish changes.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-border p-4 sm:p-5">
          <p className="text-card-title text-foreground">Where do I paste this?</p>
          <div className="mt-3 space-y-3">
            <div className="inline-flex max-w-full flex-wrap gap-1 rounded-card sm:rounded-full bg-muted p-1">
              {CMS_GUIDES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGuide(g.id)}
                  aria-pressed={guide === g.id}
                  className={cn(
                    "h-8 px-3.5 rounded-full text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    guide === g.id
                      ? "bg-raised text-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <ol className="space-y-2">
              {activeGuide.steps[method].map((step, i) => (
                <li key={i} className="flex gap-2.5 text-body text-muted-foreground">
                  <span className="shrink-0 inline-flex items-center justify-center size-5 rounded-full bg-muted text-label font-semibold text-foreground tabular-nums">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="text-caption text-muted-foreground">
              Blocked from adding code? Switch to <span className="font-medium text-foreground">Link</span>{" "}
              above and point a menu item at the schedule instead.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
