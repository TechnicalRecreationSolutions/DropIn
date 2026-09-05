"use client";

import { useState } from "react";
import { Check, Code2, Copy, ExternalLink, Frame, Link2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EmbedMethod } from "./types";

interface InstallPanelProps {
  /** The snippet for the current method — HTML for script/iframe, the URL itself for link. */
  embedCode: string;
  method: EmbedMethod;
  onMethodChange: (value: EmbedMethod) => void;
  height: string;
  onHeightChange: (value: string) => void;
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
        <span className="block text-sm font-medium text-foreground mb-2">
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
                "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors",
                method === id
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40"
                  : "border-border hover:bg-muted"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0",
                  method === id ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{name}</span>
                <span className="block text-xs text-muted-foreground truncate">{tagline}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/60 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isLink ? "Schedule link" : "Embed code"}
            </span>
            {snippetStale && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400 text-[10px] font-semibold">
                <RefreshCw className="w-2.5 h-2.5" />
                Updated — copy again
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isLink && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
            )}
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : isLink ? "Copy link" : "Copy code"}
            </button>
          </div>
        </div>
        {isLink ? (
          // Selectable input rather than a <pre>: this one gets dragged into an
          // address bar or a menu-item field, not pasted into an HTML block.
          <input
            readOnly
            value={embedCode}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Public schedule link"
            className="w-full px-4 py-3.5 text-[12px] font-mono bg-card text-foreground/85 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          />
        ) : (
          <pre className="p-4 overflow-x-auto text-[12px] leading-relaxed font-mono text-foreground/85 bg-card whitespace-pre">
            {embedCode}
          </pre>
        )}
      </div>

      <p className="text-xs text-muted-foreground -mt-2">{activeMethod.note}</p>

      {!isLink && (
        <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3 sm:items-start">
          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1">
              {method === "iframe" ? "Height" : "Starting height"}
            </span>
            <div className="relative">
              <input
                type="number"
                value={height}
                onChange={(e) => onHeightChange(e.target.value)}
                min={300}
                max={1200}
                className="w-full px-3 py-2.5 pr-9 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                px
              </span>
            </div>
          </label>
          <p className="text-xs text-muted-foreground sm:pt-8">
            {method === "iframe"
              ? "The box stays this tall. Give it enough room for a busy week — a week grid usually wants 700–900px."
              : "Only matters for the split second before the schedule loads — after that the widget measures itself and tells your page what height to use."}
          </p>
        </div>
      )}

      {isLink ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium text-foreground">Where do I put this?</p>
          <ol className="mt-3 space-y-2">
            {LINK_PLACES.map((place, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-muted-foreground">
                <span className="shrink-0 inline-flex items-center justify-center size-5 rounded-full bg-card border border-border text-[11px] font-semibold text-foreground">
                  {i + 1}
                </span>
                {place}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            The link keeps working as you publish changes — you never have to send it out again.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium text-foreground">Where do I paste this?</p>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {CMS_GUIDES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGuide(g.id)}
                  aria-pressed={guide === g.id}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    guide === g.id
                      ? "bg-foreground border-foreground text-background"
                      : "bg-card border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <ol className="space-y-2">
              {activeGuide.steps[method].map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-muted-foreground">
                  <span className="shrink-0 inline-flex items-center justify-center size-5 rounded-full bg-card border border-border text-[11px] font-semibold text-foreground">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">
              Blocked from adding code? Switch to <span className="font-medium text-foreground">Link</span>{" "}
              above and point a menu item at the schedule instead.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
