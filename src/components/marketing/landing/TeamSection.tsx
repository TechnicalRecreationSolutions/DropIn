import { h2Class, leadClass } from "./ui";

const HIGHLIGHTS = [
  {
    title: "Staff accounts, scoped to what they run",
    desc: "One building or twenty under one organization. A department coordinator sees their own spaces and sessions, not everyone else’s.",
  },
  {
    title: "Session templates",
    desc: "Build a recurring session once and drop it into any week, instead of rebuilding it every term.",
  },
  {
    title: "Conflicts get flagged, not discovered by a resident",
    desc: "Dropin checks a save against the lanes and sections already taken, so two sessions don’t quietly claim the same space.",
  },
  {
    title: "A record of who changed what",
    desc: "Every edit to a facility, schedule or session is logged, with the option to revert it.",
  },
];

/** Mirrors the shape of /dashboard/analytics — illustrative numbers, not live data. */
const STATS = [
  { value: "1,284", label: "Views" },
  { value: "312", label: "Session clicks" },
  { value: "1m 48s", label: "Avg. time on schedule" },
];
const WEEK = [30, 45, 38, 52, 60, 74, 66];
const TOP = [
  { name: "Lane Swim", count: 96 },
  { name: "Public Skate", count: 71 },
];

export default function TeamSection() {
  return (
    <section id="admin" className="mx-auto max-w-[1344px] scroll-mt-20 px-4 sm:px-6 xl:px-0">
      <div className="flex flex-col gap-14 rounded-[36px] bg-[#f4f4f5] px-6 py-16 sm:rounded-[44px] sm:px-[72px] sm:py-28">
        <div className="flex max-w-[680px] flex-col gap-5">
          <h2 className={h2Class}>Built for the people running it, not just the ones reading it</h2>
          <p className={leadClass}>
            A resident sees a clean schedule. Behind it, your rec coordinators get the structure and
            oversight to keep it that way without a spreadsheet on the side.
          </p>
        </div>
        <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:gap-[72px]">
          <div className="grid flex-1 gap-x-12 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex flex-col gap-2.5 border-t border-[#d9d9de] pt-6 pb-9">
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[#111113]">{h.title}</h3>
                <p className="text-[15px] leading-6 text-[#5d5d63]">{h.desc}</p>
              </div>
            ))}
          </div>
          <div className="flex w-full flex-col gap-[18px] rounded-[22px] border border-[#e4e4e7] bg-white p-6 shadow-[0_1px_2px_rgba(17,17,19,0.05)] lg:w-[460px] lg:shrink-0">
            <div className="flex items-baseline justify-between">
              <p className="text-[15px] font-semibold text-[#111113]">Schedule analytics</p>
              <p className="text-xs text-[#5d5d63]">Sample · Last 30 days</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {STATS.map((s) => (
                <div key={s.label}>
                  <p className="text-[26px] font-semibold tracking-[-0.03em] text-[#111113] tabular-nums">{s.value}</p>
                  <p className="text-xs text-[#5d5d63]">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[#5d5d63]">Views this week</p>
              <div className="flex h-24 items-end gap-2 border-b border-[#e4e4e7]">
                {WEEK.map((h, i) => (
                  <span
                    key={i}
                    className={"flex-1 rounded-t-md " + (i === 5 ? "bg-[#0066cc]" : "bg-[#cfe0f5]")}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div aria-hidden className="flex gap-2 text-center text-[11px] text-[#5d5d63]">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <span key={i} className="flex-1">
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col border-t border-[#efeff1]">
              {TOP.map((t, i) => (
                <div
                  key={t.name}
                  className={"flex justify-between text-sm text-[#111113] " + (i === 0 ? "border-b border-[#efeff1] py-3" : "pt-3")}
                >
                  <span>{t.name}</span>
                  <span className="font-semibold tabular-nums">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
