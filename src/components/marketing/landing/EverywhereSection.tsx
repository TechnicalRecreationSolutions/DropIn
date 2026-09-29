import Link from "next/link";
import { Hand, btnDark, btnLine, h2Class, leadClass } from "./ui";

/** The same brand-colour presets the real widget studio offers (BrandColorField). */
const SWATCHES = ["#0066CC", "#0F766E", "#166534", "#C2410C", "#6D28D9", "#1F2937"];
const SELECTED = "#0F766E";

const TODAY = [
  { time: "6:00 PM", name: "Lane Swim", where: "Pool · Lanes 4–8", now: true },
  { time: "6:00 PM", name: "Public Skate", where: "Arena · Half B" },
  { time: "8:00 PM", name: "Lane Swim", where: "Pool · Lanes 1–8" },
  { time: "8:00 PM", name: "Adult Shinny", where: "Arena · Full ice" },
];

function CheckBox({ on }: { on: boolean }) {
  return on ? (
    <span className="flex size-4 items-center justify-center rounded bg-[#111113]">
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="size-[11px]">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  ) : (
    <span className="size-4 rounded border-[1.5px] border-[#d9d9de]" />
  );
}

function WidgetStudio() {
  return (
    <div className="flex w-full shrink-0 flex-col gap-[18px] rounded-[18px] border border-[#e4e4e7] bg-white p-5 shadow-[0_1px_2px_rgba(17,17,19,0.05)] lg:w-[290px]">
      <div className="flex items-baseline justify-between"><p className="text-[15px] font-semibold tracking-[-0.02em] text-[#111113]">Widget studio</p><span className="text-[11px] text-[#5d5d63]">Sample</span></div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-[#5d5d63]">Logo</span>
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-[#0f766e] text-[13px] font-bold text-white">YC</span>
          <span className="text-[13px] font-medium text-[#111113]">your-logo.png</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-[#5d5d63]">Brand colour</span>
        <div className="flex gap-1.5">
          {SWATCHES.map((c) => (
            <span
              key={c}
              className="size-[26px] rounded-full"
              style={
                c === SELECTED
                  ? { background: c, border: "3px solid #fff", boxShadow: `0 0 0 2px ${c}` }
                  : { background: c }
              }
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-[#5d5d63]">Layout</span>
        <div className="grid grid-cols-2 gap-1.5 text-center text-xs font-medium text-[#111113]">
          {["Grid", "List", "Map", "Board"].map((l) => (
            <span
              key={l}
              className={
                l === "List"
                  ? "rounded-lg border-[1.5px] border-[#111113] py-[7px] font-semibold"
                  : "rounded-lg border border-[#e4e4e7] py-[7px]"
              }
            >
              {l}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-[#5d5d63]">Schedules shown</span>
        <div className="flex flex-col gap-1.5 text-[13px] text-[#111113]">
          {[
            ["Aquatics", true],
            ["Arena", true],
            ["Fitness", false],
          ].map(([name, on]) => (
            <span key={name as string} className="flex items-center gap-2">
              <CheckBox on={on as boolean} />
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmbeddedSite() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#e4e4e7] bg-white shadow-[0_1px_2px_rgba(17,17,19,0.05)]">
      <div className="flex h-[34px] shrink-0 items-center border-b border-[#e4e4e7] bg-[#f4f4f5] px-3">
        <span className="flex h-[22px] flex-1 items-center rounded-full border border-[#e4e4e7] bg-white pl-2.5 text-[11px] text-[#5d5d63]">
          yourcentre.ca/drop-in
        </span>
      </div>
      <div className="flex h-[46px] shrink-0 items-center justify-between bg-[#0f766e] px-4 text-white">
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-[7px] bg-white text-[10px] font-bold text-[#0f766e]">YC</span>
          <b className="text-[13px]">Your Centre</b>
        </span>
        <span className="hidden gap-3 text-[11px] opacity-90 sm:flex">
          <span>Programs</span>
          <span>Facilities</span>
          <span className="underline">Drop-in</span>
        </span>
      </div>
      <div className="flex flex-col gap-3 p-[18px]">
        <div>
          <p className="text-lg font-bold tracking-[-0.02em] text-[#111113]">Drop-in schedules</p>
          <p className="text-xs text-[#5d5d63]">Sample · Recreation · Aquatics &amp; Arena</p>
        </div>
        <div className="relative flex flex-col gap-2.5 rounded-xl border-[1.5px] border-dashed border-[#0f766e] p-3.5">
          <span className="absolute -top-2.5 right-3 rounded-full bg-[#0f766e] px-2 py-0.5 text-[10px] font-semibold text-white">
            Dropin widget
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#111113]">Today · Tue, Sep 29</p>
            <div className="flex gap-1.5 text-[11px] font-medium text-[#111113]">
              <span className="rounded-full bg-[#0f766e] px-2.5 py-1 text-white">All</span>
              <span className="rounded-full border border-[#e4e4e7] px-2.5 py-1">Aquatics</span>
              <span className="rounded-full border border-[#e4e4e7] px-2.5 py-1">Arena</span>
            </div>
          </div>
          <ul className="flex flex-col">
            {TODAY.map((r) => (
              <li key={r.time + r.name} className="flex items-center gap-3 border-t border-[#efeff1] py-2.5">
                <span className="w-14 shrink-0 text-xs font-semibold text-[#0b5a54]">{r.time}</span>
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#111113]">
                    {r.name}
                    {r.now && (
                      <span className="rounded-full bg-[#e2f2ef] px-1.5 py-px text-[10px] text-[#0b5a54]">Now</span>
                    )}
                  </p>
                  <p className="text-[11px] text-[#5d5d63]">{r.where}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function PrintedWeek() {
  const days = [
    { day: "Monday", rows: [["Public Skate", "4:00 – 5:30 · Full ice"], ["Adult Shinny", "7:00 – 8:00 · Full ice"]] },
    { day: "Tuesday", rows: [["Parent & Tot Skate", "10:00 – 11:00 · Half A"], ["Public Skate", "5:30 – 7:00 · Half B"]] },
    { day: "Wednesday", rows: [["Stick & Puck", "12:00 – 1:00 · Full ice"], ["Public Skate", "4:00 – 5:30 · Full ice"]] },
  ];
  return (
    <div className="flex w-[260px] max-w-full flex-col gap-2.5 rounded-md border border-[#e4e4e7] bg-white px-[18px] py-5 shadow-[0_2px_6px_rgba(17,17,19,0.08)]">
      <div>
        <p className="text-[10px] text-[#5d5d63]">Sample · Your Centre · Arena drop-in</p>
        <p className="text-[15px] font-bold tracking-[-0.02em] text-[#111113]">Week of Oct 5</p>
      </div>
      <div className="flex flex-col text-[10px] text-[#111113]">
        {days.map((d) => (
          <div key={d.day}>
            <p className="border-b-[1.5px] border-[#111113] pt-2 pb-[3px] font-bold">{d.day}</p>
            {d.rows.map(([name, when]) => (
              <div key={name + when} className="flex justify-between border-b border-[#efeff1] py-1">
                <span>{name}</span>
                <span className="text-[#5d5d63]">{when}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeckSheet() {
  const cell = "border-r border-[#d9d9de]";
  return (
    <div className="flex w-[420px] max-w-full flex-col gap-2.5 rounded-md border border-[#e4e4e7] bg-white p-[18px] shadow-[0_2px_8px_rgba(17,17,19,0.1)]">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold tracking-[-0.02em] text-[#111113]">Pool deck sheet · Tuesday</p>
        <p className="text-[10px] text-[#5d5d63]">Sample · Staff only</p>
      </div>
      <div className="grid grid-cols-[44px_repeat(8,minmax(0,1fr))] border border-[#111113] text-[9.5px] text-[#111113]">
        <span className={cell + " bg-[#f3f4f6]"} />
        {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => (
          <span key={l} className={(l < 8 ? cell : "") + " bg-[#f3f4f6] py-[5px] text-center font-bold"}>
            {l}
          </span>
        ))}
        {["6 PM", "7 PM"].map((h, i) => (
          <div key={h} className="contents">
            <span className={cell + " px-[3px] py-3 font-semibold " + (i === 0 ? "border-t border-t-[#111113]" : "border-t")}>{h}</span>
            <span className={cell + " col-span-3 flex items-center bg-[#e5e7eb] p-1.5 font-semibold " + (i === 0 ? "border-t border-t-[#111113]" : "border-t")}>
              Swim Club
            </span>
            <span className={"col-span-5 " + (i === 0 ? "border-t border-t-[#111113]" : "border-t border-[#d9d9de]")} />
          </div>
        ))}
        <span className={cell + " border-t border-t-[#111113] px-[3px] py-3 font-semibold"}>8 PM</span>
        <span className="col-span-8 border-t border-t-[#111113]" />
      </div>
      <p className="text-[9.5px] text-[#3f3f45]">
        <b>Drop-in, in the lanes left:</b> Lane Swim 6:00 – 9:00 PM
      </p>
    </div>
  );
}

export default function EverywhereSection() {
  return (
    <section id="product" className="mx-auto flex max-w-[1200px] scroll-mt-20 flex-col gap-24 px-4 pb-28 sm:gap-32 sm:px-6 sm:pb-40 xl:px-0">
      <div className="flex flex-col items-center gap-5 text-center">
        <h2 className={h2Class}>Put your schedule wherever people look.</h2>
        <p className={leadClass + " max-w-[620px]"}>
          Your website, your staff intranet and the paper on the wall, with one schedule behind all
          of them.
        </p>
      </div>

      {/* Widget */}
      <div className="-mt-12 flex flex-col gap-10 sm:-mt-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <div className="flex max-w-[640px] flex-col gap-5">
            <h3 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-[#111113] sm:text-[32px]">
              Your own widget, in your colours.
            </h3>
            <p className="text-[17px] leading-[27px] text-[#5d5d63]">
              Pick a layout, add your logo and brand colour, and choose which schedules it shows.
              Then add it to your website or your staff intranet, or share the page Dropin hosts.
              Change the schedule once and every copy updates.
            </p>
          </div>
          <Link href="/signup" className={btnDark + " shrink-0 self-start lg:self-auto"}>
            Build your widget
          </Link>
        </div>
        <div className="relative flex flex-col items-center gap-6 rounded-[36px] bg-[#f4f4f5] p-5 sm:p-10 lg:flex-row lg:gap-8 lg:px-[72px] lg:py-16">
          <Hand tone="blue" className="absolute top-5 right-20 hidden rotate-3 text-[25px] lg:block">
            embedded in your own site
          </Hand>
          <Hand tone="teal" className="absolute bottom-4 left-24 hidden -rotate-3 text-[25px] lg:block">
            your logo, your colour
          </Hand>
          <WidgetStudio />
          <div aria-hidden className="flex shrink-0 flex-col items-center gap-2">
            <svg viewBox="0 0 72 24" className="hidden h-6 w-[72px] lg:block">
              <path d="M3 12 H 66" fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M57 4 L 67 12 L 57 20" fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg viewBox="0 0 24 48" className="h-12 w-6 lg:hidden">
              <path d="M12 3 V 42" fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M4 34 L 12 44 L 20 34" fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-center text-[11px] leading-[14px] font-medium text-[#0b5a54]">
              paste
              <br />
              one line
            </span>
          </div>
          <EmbeddedSite />
        </div>
      </div>

      {/* Paper */}
      <div className="flex flex-col-reverse gap-10 lg:flex-row lg:items-center lg:gap-28">
        <div className="relative flex min-h-[560px] flex-1 flex-col items-center gap-6 overflow-hidden rounded-[32px] bg-[#f4f4f5] p-6 sm:block sm:p-0">
          <div className="max-w-full sm:absolute sm:top-14 sm:left-11 sm:-rotate-3">
            <PrintedWeek />
          </div>
          <div className="w-full max-w-[420px] sm:absolute sm:right-10 sm:bottom-16 sm:w-auto sm:rotate-2">
            <DeckSheet />
          </div>
          <Hand className="absolute top-12 right-14 hidden rotate-[5deg] text-center text-[25px] sm:block">
            printed from the
            <br />
            same schedule
          </Hand>
        </div>
        <div className="flex flex-col gap-5 lg:w-[440px] lg:shrink-0">
          <svg aria-hidden viewBox="0 0 44 44" className="size-11">
            <path d="M12 16 V 5 H 32 V 16 M12 32 H 7 V 17 H 37 V 32 H 32 M12 26 H 32 V 40 H 12 Z" fill="none" stroke="#0066cc" strokeWidth="3" strokeLinejoin="round" transform="rotate(-4 22 22)" />
          </svg>
          <h3 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-[#111113] sm:text-[32px]">
            Paper still works.
          </h3>
          <p className="text-[17px] leading-[27px] text-[#5d5d63]">
            Every department still gets its printout: a clean week for the front desk and the wall,
            and a lane-by-lane deck sheet for the guards. Both come from the same schedule, so
            they&rsquo;re never out of date.
          </p>
          <Link href="/signup" className={btnLine + " mt-3 self-start"}>
            See it with your schedule
          </Link>
        </div>
      </div>
    </section>
  );
}
