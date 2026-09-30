import Link from "next/link";
import { LOWEST_MONTHLY, TRIAL_PERIOD_DAYS, dollars } from "@/lib/stripe/plans";
import { ArrowRight, Panel, btnDark, btnLine } from "./ui";
import HeroWidget from "./HeroWidget";

export default function Hero() {
  return (
    <section id="top" className="flex flex-col items-center px-4 pt-16 pb-24 sm:px-6 sm:pt-24 sm:pb-28">
      <h1 className="max-w-[900px] text-center text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] text-[#111113] sm:text-[72px] sm:leading-[74px]">
        Show the{" "}
        <span className="relative inline-block">
          space
          <svg
            aria-hidden
            viewBox="0 0 196 20"
            className="absolute -bottom-2.5 left-0 w-full sm:-bottom-3"
            preserveAspectRatio="none"
          >
            <path
              d="M4 12 C 44 5, 96 4, 132 8 S 178 13, 192 6"
              fill="none"
              stroke="#0066cc"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        ,<br /> not just the time.
      </h1>
      <p className="mt-9 max-w-[620px] text-center text-lg leading-[1.6] text-[#5d5d63] sm:text-[19px]">
        Dropin is a visual schedule for recreation centres that shows what&rsquo;s on and where: lane
        by lane, court by court, room by room.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link href="/signup" className={btnDark}>
          Start free trial
          <ArrowRight />
        </Link>
        <Link href="#features" className={btnLine}>
          See it for every space
        </Link>
      </div>
      <p className="mt-4 text-center text-[13px] text-[#5d5d63]">
        {TRIAL_PERIOD_DAYS}-day free trial · Plans from ${dollars(LOWEST_MONTHLY)}/month · Cancel anytime
      </p>

      {/* Product picture: the real widget on a sample week, touring its views.
          Wider than the page's 1200 px column, because the schedule is the
          picture: nearly edge to edge on a phone (the panel eats into the
          section gutter), capped at 1480 px so the grid's day columns do not
          stretch into lines too long to scan. */}
      <Panel className="-mx-2 mt-16 w-[calc(100%+1rem)] max-w-[1480px] rounded-[28px] px-2 pt-3 pb-3 sm:mx-0 sm:mt-24 sm:w-full sm:rounded-[36px] sm:px-6 sm:pt-14 sm:pb-8 lg:px-10">
        <HeroWidget />
      </Panel>
    </section>
  );
}
