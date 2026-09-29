import type { Metadata } from "next";
import Link from "next/link";
import { ALWAYS_UNLIMITED, LOWEST_MONTHLY, TRIAL_PERIOD_DAYS, dollars } from "@/lib/stripe/plans";
import FaqSection from "@/components/marketing/FaqSection";
import PricingGrid from "@/components/marketing/PricingGrid";
import Hero from "@/components/marketing/landing/Hero";
import RentalSection from "@/components/marketing/landing/RentalSection";
import OneScheduleSection from "@/components/marketing/landing/OneScheduleSection";
import SharedSpacesSection from "@/components/marketing/landing/SharedSpacesSection";
import EverywhereSection from "@/components/marketing/landing/EverywhereSection";
import TeamSection from "@/components/marketing/landing/TeamSection";
import { Hand, btnDark, h2Class, leadClass } from "@/components/marketing/landing/ui";

/**
 * No `title` here on purpose. The root layout's template is "%s | Dropin", so a
 * title set on this page renders as "Dropin — … | Dropin". Omitting it falls
 * through to the layout's `default`, which the template does not wrap.
 */
export const metadata: Metadata = {
  description:
    "A visual schedule for recreation centres. Dropin shows patrons and staff what's on, and where: lane by lane, court by court, room by room.",
};

/**
 * The front door, written to the positioning in docs/POSITIONING.md — read that
 * file before changing a claim here (what is built, and the words the page
 * avoids: "open", "available", "integrates with", set-up times).
 *
 * The page leads with the one thing a buyer can't get from their booking
 * system — a picture of how each space is shared — then shows the rental that
 * reshapes lane swim by itself, the four hand-kept copies it replaces, that it
 * works for every department (not just aquatics), and where the schedule ends
 * up: the website widget and the printouts. Copy stays honest about the cost:
 * staff enter the schedule; Dropin sits beside ActiveNet or Xplor rather than
 * syncing with them.
 */
export default function HomePage() {
  return (
    <div className="bg-white text-[#111113]">
      <Hero />
      <RentalSection />
      <OneScheduleSection />
      <SharedSpacesSection />
      <EverywhereSection />
      <TeamSection />

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-28 sm:px-6 sm:pt-40 xl:px-0">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <h2 className={h2Class}>Priced by facility, nothing else</h2>
          <p className={leadClass + " max-w-[620px]"}>
            You pay for the buildings you publish. Everything else is unlimited on every plan. Prices
            in CAD, with a {TRIAL_PERIOD_DAYS}-day free trial.
          </p>
        </div>

        <PricingGrid />

        {/* Stated once rather than repeated as a tick on all four cards. */}
        <div className="mt-6 flex flex-col gap-4 rounded-[20px] bg-[#f4f4f5] px-7 py-5 sm:flex-row sm:items-center sm:gap-7">
          <p className="shrink-0 text-[15px] font-semibold">Unlimited on every plan</p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {ALWAYS_UNLIMITED.map((item) => (
              <li key={item} className="rounded-full bg-white px-3 py-1.5">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section
        id="faq"
        className="mx-auto flex max-w-[1200px] scroll-mt-20 flex-col gap-10 px-4 pt-28 sm:px-6 sm:pt-40 lg:flex-row lg:items-start lg:gap-24 xl:px-0"
      >
        <div className="flex flex-col gap-5 lg:w-[380px] lg:shrink-0">
          <h2 className={h2Class}>Questions, answered.</h2>
          <p className="text-[17px] leading-[27px] text-[#5d5d63]">
            Something we missed? Email{" "}
            <a href="mailto:hello@dropin.app" className="font-medium text-[#111113] underline">
              hello@dropin.app
            </a>
          </p>
        </div>
        <FaqSection />
      </section>

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center gap-6 px-4 pt-36 pb-32 text-center sm:pt-48 sm:pb-44">
        <h2 className={h2Class + " sm:text-[64px] sm:leading-[66px] sm:tracking-[-0.04em]"}>
          Your next schedule change
          <br className="hidden sm:block" /> should take one edit.
        </h2>
        <p className={leadClass}>
          Start with one building. Plans from ${dollars(LOWEST_MONTHLY)}/month.
        </p>
        <div className="relative mt-4">
          <Link href="/signup" className={btnDark + " h-[52px] px-8 text-base"}>
            Start your {TRIAL_PERIOD_DAYS}-day trial
          </Link>
          <Hand className="absolute top-[-18px] left-full ml-[18px] hidden -rotate-6 whitespace-nowrap sm:block">
            ← cancel anytime
          </Hand>
        </div>
      </section>
    </div>
  );
}
