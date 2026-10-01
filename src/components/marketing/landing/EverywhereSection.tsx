import Link from "next/link";
import { Hand, btnLine, h2Class, leadClass } from "./ui";
import WidgetSection from "./WidgetSection";

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
      <WidgetSection />

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
