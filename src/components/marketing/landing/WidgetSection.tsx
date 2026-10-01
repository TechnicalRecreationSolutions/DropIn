"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BRAND_PRESETS } from "@/components/widget/BrandColorField";
import { Hand, btnDark } from "./ui";

/**
 * "Your own widget" on the landing page.
 *
 * The hero already shows what the schedule looks like, so this section shows
 * only the setup: the studio's settings on one side, the three ways to put the
 * widget on a site on the other. The swatches are the real studio presets and
 * the three methods mirror `EmbedMethod` (see components/widget/types.ts).
 *
 * The snippets use a sample address (yourcentre.ca/drop-in) and a placeholder
 * org id, so nothing here reads as working code. They deliberately do not
 * change with the settings: branding lives on the account, so code pasted once
 * never needs touching again.
 */

const SAMPLE_URL = "https://yourcentre.ca/drop-in";

type Method = "script" | "iframe" | "link";

const METHODS: {
  id: Method;
  label: string;
  tag?: string;
  about: string;
  code: string;
}[] = [
  {
    id: "script",
    label: "Script",
    tag: "Recommended",
    about:
      "Grows to fit the schedule, so it never sits in a box with its own scrollbar. Use it on any site that lets you add a script.",
    code: [
      `<div id="dropin-widget"></div>`,
      `<script`,
      `  src="${SAMPLE_URL}/embed/widget.js"`,
      `  data-org-id="your-org-id"`,
      `  async`,
      `></script>`,
    ].join("\n"),
  },
  {
    id: "iframe",
    label: "iframe",
    about:
      "The same widget in a box with a fixed height. Use it when your website builder strips out scripts, as many municipal and school sites do.",
    code: [
      `<iframe`,
      `  src="${SAMPLE_URL}/widget/your-org-id"`,
      `  title="Drop-in schedule"`,
      `  loading="lazy"`,
      `  style="width:100%;height:600px;border:0"`,
      `></iframe>`,
    ].join("\n"),
  },
  {
    id: "link",
    label: "Link",
    about:
      "No code at all: a page Dropin hosts for you. Put it in your menu or behind a button, or use it when your site blocks both of the others.",
    code: SAMPLE_URL,
  },
];

const LAYOUTS = ["Grid", "List", "Map", "Floor plan", "Board"];
const SCHEDULES = ["Aquatics", "Arena", "Fitness"];
/** Labels from MultiSelectToggles — the studio's "Let visitors pick several". */
const PICK_SEVERAL = ["Facilities", "Departments", "Schedules"];
/** Labels from VisitorFilterToggles; the first four are DEFAULT_ENABLED_FILTERS. */
const FILTERS = [
  "Search",
  "Activity",
  "Day",
  "Time of day",
  "Where",
  "Who it's for",
  "Jump to a week",
];
const DEFAULT_FILTERS = FILTERS.slice(0, 4);
/** Labels from FiltersStartToggle — the studio's "Filter section starts". */
const FILTER_START = ["Open", "Collapsed"] as const;

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc]";

function Step({
  n,
  dark,
  children,
}: {
  n: number;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      className={
        "flex items-center gap-2.5 text-[13px] font-semibold " +
        (dark ? "text-white" : "text-[#111113]")
      }
    >
      <span
        className={
          "flex size-6 items-center justify-center rounded-full text-[11px] " +
          (dark ? "bg-white text-[#111113]" : "bg-[#111113] text-white")
        }
      >
        {n}
      </span>
      {children}
    </p>
  );
}

function FieldLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="text-xs text-[#5d5d63]">
      {children}
    </span>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return on ? (
    <span className="flex size-4 items-center justify-center rounded bg-[#111113]">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[11px]"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  ) : (
    <span className="size-4 rounded border-[1.5px] border-[#d9d9de]" />
  );
}

function SettingGroup({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-[#efeff1] pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-col gap-1.5">
        <Step n={n}>{title}</Step>
        <p className="pl-[34px] text-[13px] leading-5 text-[#5d5d63]">{hint}</p>
      </div>
      <div className="flex flex-col gap-4 sm:pl-[34px]">{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        "rounded-lg px-3 py-[7px] text-xs transition-colors " +
        focusRing +
        " " +
        (on
          ? "border-[1.5px] border-[#111113] font-semibold text-[#111113]"
          : "border border-[#e4e4e7] font-medium text-[#5d5d63] hover:border-[#a1a1aa]")
      }
    >
      {children}
    </button>
  );
}

function SettingsStep() {
  const [schedules, setSchedules] = useState<string[]>(["Aquatics", "Arena"]);
  const [color, setColor] = useState(BRAND_PRESETS[1].hex);
  const [title, setTitle] = useState("Your Centre");
  const [layouts, setLayouts] = useState<string[]>(["Grid", "List"]);
  const [theme, setTheme] = useState<"Light" | "Dark">("Light");
  const [filters, setFilters] = useState<string[]>(DEFAULT_FILTERS);
  const [print, setPrint] = useState(true);
  const [filterStart, setFilterStart] =
    useState<(typeof FILTER_START)[number]>("Open");
  const [pickSeveral, setPickSeveral] = useState<string[]>(["Schedules"]);
  const colorName = BRAND_PRESETS.find((p) => p.hex === color)?.name;
  const initials =
    title
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "YC";

  const toggle = (list: string[], set: (v: string[]) => void, item: string) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <div className="relative flex h-full min-w-0 flex-col gap-6 rounded-[20px] border border-[#e4e4e7] bg-white p-5 sm:p-7">
      <Hand
        tone="teal"
        className="absolute top-5 right-6 hidden rotate-3 text-[25px] lg:block"
      >
        try it
      </Hand>

      <SettingGroup
        n={1}
        title="What to show"
        hint="Everything you run, one schedule, or several with a switcher for visitors."
      >
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#111113]">
          {SCHEDULES.map((s) => {
            const on = schedules.includes(s);
            return (
              <button
                key={s}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(schedules, setSchedules, s)}
                className={"flex items-center gap-2 rounded " + focusRing}
              >
                <CheckBox on={on} />
                {s}
              </button>
            );
          })}
        </div>
      </SettingGroup>

      <SettingGroup
        n={2}
        title="Look and feel"
        hint="Your logo, your colour, the views visitors get."
      >
        <div className="flex flex-col gap-2.5">
          <FieldLabel>Logo and heading</FieldLabel>
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold text-white transition-colors duration-300"
              style={{ background: color }}
            >
              {initials}
            </span>
            <input
              aria-label="Heading"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 40))}
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#d9d9de] px-3 text-[14px] text-[#111113] outline-none focus:border-[#111113]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel id="widget-colour-label">Brand colour</FieldLabel>
            <span className="font-mono text-[11px] text-[#5d5d63]">
              {colorName} · {color}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="widget-colour-label"
            className="flex flex-wrap gap-2"
          >
            {BRAND_PRESETS.map(({ hex, name }) => {
              const on = hex === color;
              return (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={name}
                  title={name}
                  onClick={() => setColor(hex)}
                  className={
                    "size-7 rounded-full transition-transform hover:scale-110 sm:size-8 " +
                    focusRing
                  }
                  style={
                    on
                      ? {
                          background: hex,
                          border: "3px solid #fff",
                          boxShadow: `0 0 0 2px ${hex}`,
                        }
                      : { background: hex }
                  }
                />
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <FieldLabel>Views visitors can switch between</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {LAYOUTS.map((l) => (
              <Chip
                key={l}
                on={layouts.includes(l)}
                onClick={() => toggle(layouts, setLayouts, l)}
              >
                {l}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <FieldLabel>Theme</FieldLabel>
          <div className="flex h-9 w-fit gap-1 rounded-full bg-[#f4f4f5] p-1">
            {(["Light", "Dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
                className={
                  "rounded-full px-4 text-xs font-medium transition-colors " +
                  focusRing +
                  " " +
                  (theme === t
                    ? "bg-white text-[#111113] shadow-[0_1px_2px_rgba(17,17,19,0.12)]"
                    : "text-[#5d5d63] hover:text-[#111113]")
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </SettingGroup>

      <SettingGroup
        n={3}
        title="Filters and printing"
        hint="Optional. Let visitors narrow the schedule, pick several at once, and print what they see. Filters fold away behind one tap."
      >
        <div className="flex flex-col gap-2.5">
          <FieldLabel>Filters visitors get</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Chip
                key={f}
                on={filters.includes(f)}
                onClick={() => toggle(filters, setFilters, f)}
              >
                {f}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <FieldLabel>Filter section starts</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_START.map((option) => (
              <Chip
                key={option}
                on={filterStart === option}
                onClick={() => setFilterStart(option)}
              >
                {option}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <FieldLabel>Let visitors pick several</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {PICK_SEVERAL.map((level) => (
              <Chip
                key={level}
                on={pickSeveral.includes(level)}
                onClick={() => toggle(pickSeveral, setPickSeveral, level)}
              >
                {level}
              </Chip>
            ))}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={print}
          onClick={() => setPrint(!print)}
          className={
            "flex items-center justify-between gap-3 rounded-lg text-left " +
            focusRing
          }
        >
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-[#111113]">
              Print button
            </span>
            <span className="text-xs text-[#5d5d63]">
              A clean printout of the week they&rsquo;re looking at
            </span>
          </span>
          <span
            className={
              "flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors " +
              (print ? "bg-[#111113]" : "bg-[#d9d9de]")
            }
          >
            <span
              className={
                "size-5 rounded-full bg-white shadow transition-transform " +
                (print ? "translate-x-4" : "")
              }
            />
          </span>
        </button>
      </SettingGroup>
    </div>
  );
}

/** Light syntax colouring: attribute names blue, values (and a bare URL) green. */
function CodeLines({ code }: { code: string }) {
  return (
    <code>
      {code.split("\n").map((line, i) => {
        const eq = line.indexOf("=");
        let body: ReactNode = line;
        if (!line.startsWith("<") && !line.startsWith(" ")) {
          body = <span className="text-[#86efac]">{line}</span>;
        } else if (line.startsWith("  ")) {
          body = (
            <>
              {"  "}
              <span className="text-[#7dd3fc]">
                {eq < 0 ? line.trim() : line.slice(2, eq)}
              </span>
              {eq >= 0 && (
                <>
                  =<span className="text-[#86efac]">{line.slice(eq + 1)}</span>
                </>
              )}
            </>
          );
        }
        return (
          <span key={i} className="block">
            {body}
          </span>
        );
      })}
    </code>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  // Tied to the text, so switching method drops the tick instead of carrying it over.
  const copied = copiedText === text;
  useEffect(() => {
    if (copiedText === null) return;
    const t = setTimeout(() => setCopiedText(null), 1800);
    return () => clearTimeout(t);
  }, [copiedText]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      // Clipboard blocked (insecure origin, permissions): the code is still selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/20 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/10 " +
        focusRing
      }
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={copied ? 3 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </>
        )}
      </svg>
      {copied ? "Copied" : label}
    </button>
  );
}

function EmbedStep() {
  const [method, setMethod] = useState<Method>("script");
  const current = METHODS.find((m) => m.id === method) ?? METHODS[0];

  return (
    <div className="flex min-w-0 flex-col gap-5 rounded-[20px] bg-[#111113] p-5 sm:p-7">
      <div className="flex flex-col gap-1.5">
        <Step n={4} dark>
          Add it to your website
        </Step>
        <p className="pl-[34px] text-[13px] leading-5 text-[#a1a1aa]">
          Pick whichever your site allows, then paste it in or send it to
          whoever runs the site.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Embed method"
        className="flex flex-col gap-2"
      >
        {METHODS.map((m) => {
          const on = m.id === method;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMethod(m.id)}
              className={
                "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors " +
                focusRing +
                " " +
                (on
                  ? "border-white/40 bg-white/[0.08]"
                  : "border-white/10 hover:border-white/25")
              }
            >
              <span
                className={
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] " +
                  (on ? "border-white" : "border-white/30")
                }
              >
                {on && <span className="size-2 rounded-full bg-white" />}
              </span>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[14px] font-semibold text-white">
                  {m.label}
                  {m.tag && (
                    <span className="rounded-full bg-[#0f766e] px-2 py-px text-[10px] font-semibold text-white">
                      {m.tag}
                    </span>
                  )}
                </span>
                <span className="text-[13px] leading-5 text-[#a1a1aa]">
                  {m.about}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-white">
            {method === "link" ? "Your link" : "Your code"}
          </p>
          <CopyButton
            text={current.code}
            label={method === "link" ? "Copy link" : "Copy code"}
          />
        </div>
        <pre className="overflow-x-auto rounded-xl bg-white/[0.06] p-4 font-mono text-[12px] leading-[20px] text-[#e4e4e7]">
          <CodeLines code={current.code} />
        </pre>
        <p className="text-[12px] leading-[18px] text-[#71717a]">
          Sample code: yours comes with your account. Change your colours or
          your schedule later and every copy updates on its own, without
          touching this code again.
        </p>
      </div>
    </div>
  );
}

export default function WidgetSection() {
  return (
    <div className="-mt-12 flex flex-col gap-10 sm:-mt-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
        <div className="flex max-w-[640px] flex-col gap-5">
          <h3 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-[#111113] sm:text-[32px]">
            Your own widget, in your colours.
          </h3>
          <p className="text-[17px] leading-[27px] text-[#5d5d63]">
            Add your logo and colour, choose what it shows, then put it on your
            website or staff intranet with a script, an iframe or just a link.
          </p>
        </div>
        <Link
          href="/signup"
          className={btnDark + " shrink-0 self-start lg:self-auto"}
        >
          Build your widget
        </Link>
      </div>

      <div className="relative grid grid-cols-[minmax(0,1fr)] gap-5 rounded-[36px] bg-[#f4f4f5] p-4 sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-12">
        <SettingsStep />
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <EmbedStep />
        </div>
      </div>
    </div>
  );
}
