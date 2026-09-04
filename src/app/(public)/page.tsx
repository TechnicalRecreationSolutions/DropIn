import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarDays,
  MonitorSmartphone,
  Layers,
  Check,
  Waves,
  CircleDot,
  Dumbbell,
  Users,
  ClipboardList,
  ShieldAlert,
  History,
  Eye,
  MousePointerClick,
  Clock,
} from "lucide-react";
import { PLANS, type PlanTier } from "@/lib/stripe/plans";
import FaqSection from "@/components/marketing/FaqSection";
import WidgetPreview from "@/components/marketing/WidgetPreview";

/**
 * No `title` here on purpose. The root layout's template is "%s | Dropin", so a
 * title set on this page renders as "Dropin — … | Dropin". Omitting it falls
 * through to the layout's `default`, which the template does not wrap.
 */
export const metadata: Metadata = {
  description:
    "Build your drop-in schedule once and publish it everywhere: your own website and an embeddable widget. Built for pools, arenas and community centres.",
};

/**
 * The front door for the product Dropin actually is: a tool a recreation centre
 * uses to publish its own schedule.
 *
 * It used to be a consumer search page — a city/postal-code box over a
 * cross-organization index. That was the aggregator product, and this page was
 * its entry point. Nothing here sells discovery any more, because the customer
 * reading it is the centre, not a resident looking for a swim.
 */

const features = [
  {
    icon: CalendarDays,
    title: "Enter it once",
    desc: "Recurring sessions, departments and rooms — described once, not retyped every term. Change a time and every place it appears changes with it.",
  },
  {
    icon: MonitorSmartphone,
    title: "Embed it in your own site",
    desc: "A schedule widget that drops into the website you already have, styled to your colours. No redirect, no second place for residents to look.",
  },
  {
    icon: Layers,
    title: "One building or twenty",
    desc: "Departments, spaces and multiple facilities under one organization, with staff accounts for the people who keep them current.",
  },
];

/** What keeps the org side organized, distinct from what a resident sees. */
const adminHighlights = [
  {
    icon: Users,
    title: "Staff accounts, scoped to what they run",
    desc: "Give a department coordinator access to their own spaces and sessions — not the whole organization.",
  },
  {
    icon: ClipboardList,
    title: "Session templates",
    desc: "Build a recurring session once and drop it into any week, instead of rebuilding it every term.",
  },
  {
    icon: ShieldAlert,
    title: "Conflicts get flagged, not discovered by a resident",
    desc: "Two sessions can't quietly claim the same space at the same time — Dropin catches the overlap before it's published.",
  },
  {
    icon: History,
    title: "A record of who changed what",
    desc: "Every edit to a facility, schedule or session is logged, with the option to revert it.",
  },
];

/** Mirrors the shape of /dashboard/analytics — illustrative numbers, not live data. */
const analyticsStats = [
  { icon: Eye, label: "Views", value: "1,284" },
  { icon: MousePointerClick, label: "Session clicks", value: "312" },
  { icon: Clock, label: "Avg. time on schedule", value: "1m 48s" },
];
const weeklyViewBars = [30, 45, 38, 52, 60, 74, 66];
const topViewed = [
  { name: "Lane Swim", count: 96 },
  { name: "Public Skate", count: 71 },
];

/** Sample rows for the hero's schedule preview card — illustrative, not live data. */
const sampleSchedule = [
  { time: "6:00 AM", name: "Lane Swim", tag: "Pool", icon: Waves },
  { time: "9:30 AM", name: "Aqua Fit", tag: "Pool", icon: Waves },
  { time: "4:00 PM", name: "Public Skate", tag: "Arena", icon: CircleDot },
  { time: "6:30 PM", name: "Youth Basketball", tag: "Gym", icon: Dumbbell },
];

/**
 * Plan tiers in display order. Prices come from the same catalogue billing
 * uses. No free tier yet — every org is on a paid plan from day one.
 */
type PaidTier = Exclude<PlanTier, "free">;
const TIER_ORDER: PaidTier[] = ["pro", "enterprise"];

const planBlurb: Record<PaidTier, string> = {
  pro: "For a centre running several buildings.",
  enterprise: "For a city or a large operator.",
};

function planLines(tier: PlanTier): string[] {
  const { limits } = PLANS[tier];
  const n = (v: number, one: string, many: string) =>
    v === -1 ? `Unlimited ${many}` : `${v} ${v === 1 ? one : many}`;
  return [
    n(limits.facilities, "facility", "facilities"),
    limits.programsPerFacility === -1
      ? "Unlimited schedules per facility"
      : `${limits.programsPerFacility} schedules per facility`,
    n(limits.staffMembers, "staff account", "staff accounts"),
  ];
}

export default function HomePage() {
  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 to-blue-800 text-white">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-blue-400/20 blur-3xl"
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="flex flex-col lg:flex-row items-center gap-14">
            <div className="flex-1 text-center lg:text-left">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-medium text-blue-100 mb-6">
                For pools, arenas &amp; community centres
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4">
                Your drop-in schedule, everywhere at once
              </h1>
              <p className="text-lg sm:text-xl text-blue-100 mb-10 max-w-2xl mx-auto lg:mx-0">
                Keep one schedule up to date — and publish it to your own
                website and an embeddable widget from the same place.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center px-8 py-3.5 bg-card text-blue-700 dark:text-blue-300 font-semibold rounded-xl hover:bg-blue-50 transition-colors"
                >
                  Get started
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl border border-white/40 font-semibold hover:bg-white/10 transition-colors"
                >
                  Sign in
                </Link>
              </div>
              <p className="mt-5 text-sm text-blue-200">
                Plans start at $49/month · Cancel anytime
              </p>
            </div>

            {/* Schedule preview mockup */}
            <div className="flex-1 w-full max-w-md">
              <div className="rounded-2xl bg-card shadow-2xl ring-1 ring-black/5 p-1.5">
                <div className="rounded-xl bg-muted p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                      <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                    </div>
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide">
                      This week
                    </p>
                  </div>
                  <div className="space-y-2">
                    {sampleSchedule.map((row) => (
                      <div
                        key={row.name}
                        className="flex items-center gap-3 bg-card rounded-lg border border-border px-3 py-2.5"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                          <row.icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {row.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{row.time}</p>
                        </div>
                        <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50 rounded-full px-2 py-1 shrink-0">
                          {row.tag}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── What it does ──────────────────────────────────────────────────── */}
      <section id="features" className="py-16 sm:py-20 bg-card scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3">
            Platform
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            Built for the people who keep the schedule current
          </h2>
          <p className="text-muted-foreground mb-10 max-w-2xl">
            Most centres keep the same schedule in more than one place — a
            website and a front-desk sheet — and change it in each one by
            hand. Dropin keeps one and publishes the rest.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((item) => (
              <div
                key={item.title}
                className="flex flex-col gap-3 p-5 rounded-xl border border-border bg-muted hover:border-blue-100 hover:bg-blue-50/40 transition-colors"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                  <item.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Admin & analytics ────────────────────────────────────────────── */}
      <section id="admin" className="py-16 sm:py-20 bg-muted scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 max-w-2xl">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3">
              For your team
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
              Built for the people running it, not just the ones reading it
            </h2>
            <p className="text-muted-foreground">
              A resident sees a clean schedule. Behind it, your rec
              coordinators get the structure and oversight to keep it that
              way without a spreadsheet on the side.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-10 items-start">
            <div className="grid sm:grid-cols-2 gap-5">
              {adminHighlights.map((item) => (
                <div key={item.title} className="flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1 text-sm">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Analytics mock */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-3">
                Analytics · Last 30 days
              </p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {analyticsStats.map((s) => (
                  <div key={s.label} className="bg-muted rounded-lg border border-border p-3">
                    <s.icon className="w-4 h-4 text-blue-600 dark:text-blue-400 mb-1.5" />
                    <p className="text-lg font-bold text-foreground tabular-nums leading-none">
                      {s.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="bg-muted rounded-lg border border-border p-3 mb-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-2">Views this week</p>
                <div className="flex items-end gap-1.5 h-14">
                  {weeklyViewBars.map((h, i) => (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className="flex-1 rounded-t bg-blue-200"
                    />
                  ))}
                </div>
              </div>

              <div className="bg-muted rounded-lg border border-border divide-y divide-border">
                {topViewed.map((s) => (
                  <div key={s.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-foreground">{s.name}</span>
                    <span className="font-medium text-foreground tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Widget preview ───────────────────────────────────────────────── */}
      <section id="product" className="py-16 sm:py-20 bg-card scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3">
              Live preview
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
              What visitors see on your site
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Five layouts, one schedule behind all of them. Click through
              the toggle below — it works the same way on your own site.
            </p>
          </div>
          <WidgetPreview />
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-16 sm:py-20 bg-muted scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3">
            Pricing
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Simple, per facility</h2>
          <p className="text-muted-foreground mb-10">
            Prices in CAD, per month. Cancel anytime.
          </p>

          <div className="grid sm:grid-cols-2 gap-5 max-w-2xl">
            {TIER_ORDER.map((tier) => {
              const plan = PLANS[tier];
              const featured = tier === "pro";
              return (
                <div
                  key={tier}
                  className={
                    featured
                      ? "rounded-xl border-2 border-blue-600 bg-card p-6 shadow-sm"
                      : "rounded-xl border border-border bg-card p-6"
                  }
                >
                  <p className="font-semibold text-foreground">{plan.name}</p>
                  <p className="mt-2 text-3xl font-extrabold text-foreground">
                    ${plan.priceMonthly / 100}
                    <span className="text-sm font-medium text-muted-foreground">/mo</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{planBlurb[tier]}</p>

                  <ul className="mt-5 space-y-2">
                    {planLines(tier).map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-foreground">
                        <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                        {line}
                      </li>
                    ))}
                  </ul>

                  {tier === "enterprise" ? (
                    <a
                      href="mailto:hello@dropin.app?subject=Enterprise plan"
                      className="mt-6 block text-center px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
                    >
                      Contact us
                    </a>
                  ) : (
                    <Link
                      href="/signup"
                      className="mt-6 block text-center px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      Choose {plan.name}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-16 sm:py-20 bg-card scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3 text-center">
            FAQ
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10 text-center">
            Questions
          </h2>
          <FaqSection />
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 bg-gray-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Stop retyping the same schedule
          </h2>
          {/* Explicit grey, like the footer: this section is deliberately
              near-black, and --muted-foreground is tuned for a light surface. */}
          <p className="text-gray-400 mb-8">
            Set up one facility and publish a schedule in an afternoon.
            Plans start at $49/month.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center px-8 py-3.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-500 transition-colors"
          >
            Create your organization
          </Link>
        </div>
      </section>
    </div>
  );
}
