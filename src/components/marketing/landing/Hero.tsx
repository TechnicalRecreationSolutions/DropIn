import Link from "next/link";
import { LOWEST_MONTHLY, TRIAL_PERIOD_DAYS, dollars } from "@/lib/stripe/plans";
import { ArrowRight, Hand, Legend, MapView, Panel, btnDark, btnLine, type MapBlock } from "./ui";

/** Sample morning for the hero's pool map. Illustrative, not live data. */
const LANES = ["Lane 1", "Lane 2", "Lane 3", "Lane 4", "Lane 5", "Lane 6", "Lane 7", "Lane 8"];
const MORNING: MapBlock[] = [
  { col: 0, span: 4, start: 6, end: 7.5, tone: "blue", title: "Lane Swim · Lanes 1–4", detail: "6:00 – 7:30 AM" },
  { col: 4, span: 4, start: 6, end: 7.5, tone: "reserved", title: "Swim Club · Lanes 5–8", detail: "Reserved · 5:30 – 7:30 AM" },
  { col: 0, span: 8, start: 7.5, end: 9, tone: "blue", title: "Lane Swim · Lanes 1–8", detail: "7:30 – 9:00 AM" },
  { col: 0, span: 4, start: 9.5, end: 10.25, tone: "teal", title: "Aqua Fit · Lanes 1–4", detail: "9:30 – 10:15 AM" },
  { col: 0, span: 4, start: 10.5, end: 12, tone: "pink", title: "Lessons · Lanes 1–4", detail: "10:30 AM – 12:00 PM" },
  { col: 4, span: 4, start: 9, end: 12, tone: "blue", title: "Lane Swim · Lanes 5–8", detail: "9:00 AM – 12:00 PM" },
  { col: 0, span: 8, start: 12, end: 13.5, tone: "blue", title: "Lane Swim · Lanes 1–8", detail: "12:00 – 1:30 PM" },
];

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
      <p className="mt-7 flex max-w-full items-center gap-2.5 rounded-full border border-[#e4e4e7] px-4 py-2.5 text-center text-sm text-[#111113] sm:text-left">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0066cc"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="hidden size-4 shrink-0 sm:block"
        >
          <rect x="3" y="4" width="7" height="16" rx="2" />
          <rect x="14" y="4" width="7" height="16" rx="2" />
        </svg>
        <span>
          Sits beside ActiveNet or Xplor. They record who booked what; Dropin shows where it&rsquo;s
          happening.
        </span>
      </p>

      {/* Product picture: a pool in the widget's Map layout. */}
      <Panel className="mt-20 w-full max-w-[1200px] rounded-[36px] px-3 pt-4 pb-4 sm:mt-24 sm:px-16 sm:pt-14 sm:pb-20">
        <Hand className="absolute -top-14 right-20 hidden -rotate-[4deg] text-[26px] md:flex md:items-end md:gap-1.5">
          one column per lane
          <svg viewBox="0 0 54 72" className="-mb-14 h-[72px] w-[54px]">
            <path d="M6 4 C 34 8, 48 30, 40 66" fill="none" stroke="#0066cc" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M32 58 L 40 67 L 47 57" fill="none" stroke="#0066cc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Hand>
        <Hand tone="teal" className="absolute right-36 bottom-6 hidden -rotate-2 text-[27px] md:block">
          ↑ the swim club has half the pool
        </Hand>
        <div className="overflow-x-auto">
          <MapView
            className="min-w-[680px]"
            title="Pool"
            subtitle="Sample · Monday, Sep 28"
            columns={LANES}
            start={6}
            end={14}
            ticks={["6 AM", "8 AM", "10 AM", "12 PM", "2 PM"]}
            blocks={MORNING}
            bodyHeight={420}
            header={
              <div
                aria-hidden
                className="hidden rounded-full bg-[#f4f4f5] p-[3px] text-[13px] font-medium sm:flex"
              >
                {["Grid", "List", "Map", "Board"].map((v) => (
                  <span
                    key={v}
                    className={
                      v === "Map"
                        ? "rounded-full bg-white px-3.5 py-1.5 text-[#111113] shadow-[0_1px_2px_rgba(17,17,19,0.08)]"
                        : "px-3.5 py-1.5 text-[#5d5d63]"
                    }
                  >
                    {v}
                  </span>
                ))}
              </div>
            }
            footer={
              <Legend
                items={[
                  { label: "Drop-in", tone: "blue" },
                  { label: "Program", tone: "teal" },
                  { label: "Reserved", tone: "reserved" },
                  { label: "Nothing scheduled", tone: "open" },
                ]}
              />
            }
          />
        </div>
      </Panel>
    </section>
  );
}
