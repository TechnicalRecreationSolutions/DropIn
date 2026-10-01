"use client";

import { useState } from "react";
import { Geist_Mono } from "next/font/google";
import { Check, Copy, ExternalLink, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { InfoTip } from "@/components/ui/info-tip";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { SCOPE_FACILITY_SELECT_ID, type EmbedMethod, type WidgetFacility, type WidgetTheme } from "./types";

interface InstallPanelProps {
  /** The snippet for the current method — HTML for script/iframe, the URL itself for link. */
  embedCode: string;
  method: EmbedMethod;
  onMethodChange: (value: EmbedMethod) => void;
  /** The snippet's theme. Not the preview's Light/Dark, which only changes the preview. */
  theme: WidgetTheme;
  onThemeChange: (value: WidgetTheme) => void;
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

// The code block is the one place the dashboard sets type in mono, so Geist
// Mono is loaded here rather than app-wide (`--font-mono` stays the system
// stack for everything else).
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap" });

const METHODS: { id: EmbedMethod; name: string; blurb: string }[] = [
  { id: "script", name: "Script", blurb: "Grows to fit. Best." },
  { id: "iframe", name: "iFrame", blurb: "When scripts are blocked." },
  { id: "link", name: "Link", blurb: "Menus, emails, QR codes." },
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
 * The Install section: every snippet option, and the snippet.
 *
 * Nothing here is published. Method, theme, height and the one-building
 * narrowing exist only inside the code on the customer's site, so a change
 * does nothing until the code is copied again — which is why the code block
 * flags itself as stale after one, and why theme lives here and not beside
 * the brand colour (it used to, and read as a published setting).
 *
 * Two audiences read this section: the staff member who copies the code, and
 * the (often external) web person who pastes it. It has to be portable enough
 * to survive being emailed, and it has to offer a way out for the many
 * municipal CMSes that block `<script>` outright — hence the iframe and link
 * methods sitting alongside the script one rather than buried under it.
 *
 * The method and theme live in `WidgetStudio` rather than here, because the
 * header's "Copy embed code" button copies the same snippet and the stale
 * check compares against it.
 */
export default function InstallPanel({
  embedCode,
  method,
  onMethodChange,
  theme,
  onThemeChange,
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

  const activeGuide = CMS_GUIDES.find((g) => g.id === guide) ?? CMS_GUIDES[0];
  const isLink = method === "link";

  return (
    <div className="space-y-6">
      {/* Method first: everything below reads differently depending on it. */}
      <section className="space-y-2">
        <SectionHeading>How it goes on your site</SectionHeading>
        <div role="radiogroup" aria-label="How it goes on your site" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {METHODS.map(({ id, name, blurb }) => {
            const active = method === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onMethodChange(id)}
                className={cn(
                  "min-h-11 rounded-banner border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-brand bg-brand-subtle" : "border-border bg-card hover:bg-muted"
                )}
              >
                <span className={cn("block text-body font-semibold", active ? "text-brand-strong" : "text-foreground")}>
                  {name}
                </span>
                <span className={cn("block text-caption", active ? "text-brand-strong" : "text-muted-foreground")}>
                  {blurb}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeading note="The page your site puts it on">Theme</SectionHeading>
        <Segmented
          label="Theme"
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: "light", label: "Light", icon: Sun },
            { value: "dark", label: "Dark", icon: Moon },
          ]}
          className="w-full sm:w-64"
        />
      </section>

      {/* Per-page scoping — a property of *this copy of the code*, not of the
          saved settings. One organisation's look and one schedule list, but the
          arena's page can still carry an arena-only embed: the facility rides
          in the snippet (data-facility-id / the URL), and the widget narrows
          its switcher to that facility's entries. */}
      {facilities.length > 1 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor={SCOPE_FACILITY_SELECT_ID} className="text-body font-semibold text-foreground">
              Only show one building
            </label>
            <InfoTip>
              Only needed if your website has a separate page per building. Pick it here and this copy of the code
              shows just that building.
            </InfoTip>
          </div>
          <NativeSelect
            id={SCOPE_FACILITY_SELECT_ID}
            value={scopeFacilityId}
            onChange={(e) => onScopeFacilityChange(e.target.value)}
          >
            <option value="">No, show everything under Schedules</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} only
                {f.isPublished ? "" : " (draft)"}
              </option>
            ))}
          </NativeSelect>
          {scopeFacilityId && (
            <p className="text-caption text-muted-foreground">
              {switcherCount > 1
                ? "This code shows only that facility, and its switcher only lists that facility's schedules."
                : "This code shows only that facility."}
            </p>
          )}
        </section>
      )}

      {/* The loader sizes itself to the schedule, so only a hand-written
          iframe has a height worth asking about. */}
      {method === "iframe" && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor="widget-embed-height" className="text-body font-semibold text-foreground">
              Height
            </label>
            <InfoTip>The box stays this tall and scrolls inside. A week grid usually needs 700–900px.</InfoTip>
          </div>
          <div className="relative w-40">
            <Input
              id="widget-embed-height"
              type="number"
              value={height}
              onChange={(e) => onHeightChange(e.target.value)}
              min={300}
              max={1200}
              className="pr-9"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted-foreground">px</span>
          </div>
        </section>
      )}

      {snippetStale && (
        <Banner variant="warning">
          You changed an option above since you last copied this. Copy the code again and replace the old one on your
          site.
        </Banner>
      )}

      <section className="overflow-hidden rounded-banner bg-muted">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <span className="text-caption font-medium text-muted-foreground">
            {isLink ? "Schedule link" : "Embed code"}
          </span>
          <div className="flex items-center gap-1">
            {isLink && (
              <Button asChild variant="ghost" size="sm" className="touch-target">
                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Open
                </a>
              </Button>
            )}
            <Button type="button" size="sm" onClick={copy} className="touch-target">
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
        {isLink ? (
          // Selectable input rather than a <pre>: this one gets dragged into an
          // address bar or a menu-item field, not pasted into an HTML block.
          <div className="px-4 pb-4">
            <Input
              readOnly
              value={embedCode}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Public schedule link"
              className={cn(geistMono.className, "text-xs md:text-xs")}
            />
          </div>
        ) : (
          <pre className={cn(geistMono.className, "overflow-x-auto whitespace-pre px-4 pb-4 text-xs leading-5 text-foreground")}>
            {embedCode}
          </pre>
        )}
      </section>

      {isLink ? (
        <section className="space-y-2">
          <SectionHeading note="The link stays the same when you publish">Where do I put this?</SectionHeading>
          <NumberedSteps steps={LINK_PLACES} />
        </section>
      ) : (
        <section className="space-y-3">
          <SectionHeading>Where do I paste this?</SectionHeading>
          <Segmented
            label="Your website builder"
            value={guide}
            onChange={setGuide}
            options={CMS_GUIDES.map((g) => ({ value: g.id, label: g.name }))}
            className="grid h-auto w-full grid-cols-2 sm:flex"
          />
          <NumberedSteps steps={activeGuide.steps[method]} />
          <p className="text-caption text-muted-foreground">
            Blocked from adding code? Pick <span className="font-medium text-foreground">Link</span> above and point a
            menu item at the schedule instead.
          </p>
        </section>
      )}
    </div>
  );
}

/** A section heading with an optional short note on the right. */
export function SectionHeading({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-body font-semibold text-foreground">{children}</h3>
      {note && <span className="text-right text-caption text-muted-foreground">{note}</span>}
    </div>
  );
}

function NumberedSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2.5 text-body text-muted-foreground">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-label font-semibold tabular-nums text-foreground">
            {i + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

