import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MonitorSmartphone, Layers, Check } from "lucide-react";
import { PLANS, type PlanTier } from "@/lib/stripe/plans";

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

/** Plan tiers in display order. Prices come from the same catalogue billing uses. */
const TIER_ORDER: PlanTier[] = ["free", "pro", "enterprise"];

const planBlurb: Record<PlanTier, string> = {
  free: "One facility, to see whether it fits.",
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
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4">
            Your drop-in schedule, everywhere at once
          </h1>
          <p className="text-lg sm:text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
            Pools, arenas and community centres use Dropin to keep one schedule
            up to date — and publish it to their website and an embeddable
            widget from the same place.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center px-8 py-3.5 bg-white text-blue-700 font-semibold rounded-xl hover:bg-blue-50 transition-colors"
            >
              Start free
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl border border-white/40 font-semibold hover:bg-white/10 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── What it does ──────────────────────────────────────────────────── */}
      <section id="features" className="py-16 sm:py-20 bg-white scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Built for the people who keep the schedule current
          </h2>
          <p className="text-gray-600 mb-10 max-w-2xl">
            Most centres keep the same schedule in more than one place — a
            website and a front-desk sheet — and change it in each one by
            hand. Dropin keeps one and publishes the rest.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {features.map((item) => (
              <div
                key={item.title}
                className="flex gap-4 p-5 rounded-xl border border-gray-100 bg-gray-50"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                  <item.icon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">{item.title}</h3>
                  <p className="text-sm text-gray-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-16 sm:py-20 bg-gray-50 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Pricing</h2>
          <p className="text-gray-600 mb-10">
            Start free with one facility. Prices in CAD, per month.
          </p>

          <div className="grid sm:grid-cols-3 gap-5">
            {TIER_ORDER.map((tier) => {
              const plan = PLANS[tier];
              const featured = tier === "pro";
              return (
                <div
                  key={tier}
                  className={
                    featured
                      ? "rounded-xl border-2 border-blue-600 bg-white p-6 shadow-sm"
                      : "rounded-xl border border-gray-200 bg-white p-6"
                  }
                >
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  <p className="mt-2 text-3xl font-extrabold text-gray-900">
                    {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly / 100}`}
                    {plan.priceMonthly > 0 && (
                      <span className="text-sm font-medium text-gray-500">/mo</span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">{planBlurb[tier]}</p>

                  <ul className="mt-5 space-y-2">
                    {planLines(tier).map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-gray-700">
                        <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        {line}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/signup"
                    className={
                      featured
                        ? "mt-6 block text-center px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        : "mt-6 block text-center px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                    }
                  >
                    {tier === "free" ? "Start free" : `Choose ${plan.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 bg-gray-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Stop retyping the same schedule
          </h2>
          <p className="text-gray-400 mb-8">
            Set up one facility and publish a schedule in an afternoon. No card
            required to start.
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
