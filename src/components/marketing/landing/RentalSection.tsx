import { Panel, h2Class, leadClass } from "./ui";

type Lane = "swim" | "club";

/** A pool drawn from above: eight lanes side by side, with labels floating over them. */
function PoolFromAbove({
  lanes,
  labels,
}: {
  lanes: Lane[];
  labels: { from: number; to: number; title: string; lines: string[]; tone: Lane }[];
}) {
  return (
    <div className="relative grid h-[260px] grid-cols-8 overflow-hidden rounded-[14px] border-2 border-[#cfe0f5] sm:h-[300px]">
      {lanes.map((l, i) => (
        <div
          key={i}
          className={
            (l === "swim" ? "bg-[#e6f0fa] text-[#004a94]" : "bg-[#f6d3be] text-[#9a3412]") +
            " pt-2 text-center text-[11px] font-semibold" +
            (i < 7 ? (lanes[i + 1] === l ? " border-r-2 border-dashed border-white" : " border-r-2 border-white") : "")
          }
        >
          {i + 1}
        </div>
      ))}
      {labels.map((lb) => (
        <div
          key={lb.title + lb.from}
          className="absolute top-9 bottom-0 flex items-center justify-center px-1"
          style={{ left: `${(lb.from / 8) * 100}%`, width: `${((lb.to - lb.from) / 8) * 100}%` }}
        >
          <div className="rounded-xl bg-white px-3 py-2.5 text-center shadow-[0_1px_2px_rgba(17,17,19,0.08)]">
            <p className="text-sm font-semibold text-[#111113]">{lb.title}</p>
            {lb.lines.map((line) => (
              <p key={line} className={"text-xs " + (lb.tone === "swim" ? "text-[#004a94]" : "text-[#9a3412]")}>
                {line}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RentalSection() {
  return (
    <section id="how-it-works" className="mx-auto flex max-w-[1200px] scroll-mt-20 flex-col gap-12 px-4 pb-28 sm:px-6 sm:pb-40 xl:px-0">
      <div className="flex flex-col items-center gap-5 text-center">
        <h2 className={h2Class + " max-w-[820px]"}>Add the rental. The lane swim adjusts itself.</h2>
        <p className={leadClass + " max-w-[640px]"}>
          The swim club takes lanes 1 to 3 from 6 to 8. You add the club, and that&rsquo;s it. Lane
          swim is published as lanes 4 to 8 for those two hours, and all eight afterwards. Nobody
          retypes the lane swim.
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-6 lg:flex-row lg:items-center">
        <Panel className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold text-[#111113]">Lane swim only</p>
            <p className="text-xs text-[#5d5d63]">Sample · Tuesday 6:00 PM</p>
          </div>
          <PoolFromAbove
            lanes={Array(8).fill("swim")}
            labels={[{ from: 0, to: 8, title: "Lane Swim", lines: ["Lanes 1–8 · 6:00 – 9:00 PM"], tone: "swim" }]}
          />
          <p className="text-[13px] text-[#5d5d63]">One session, published everywhere.</p>
        </Panel>

        <div className="flex shrink-0 flex-col items-center justify-center gap-3 lg:w-[150px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#111113] px-3 py-2 text-xs font-semibold whitespace-nowrap text-white">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="size-3">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add swim club
          </span>
          <svg aria-hidden viewBox="0 0 120 24" className="hidden h-6 w-[120px] lg:block">
            <path d="M4 12 H 110" stroke="#111113" strokeWidth="2" strokeLinecap="round" />
            <path d="M102 5 L 112 12 L 102 19" fill="none" stroke="#111113" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg aria-hidden viewBox="0 0 24 48" className="h-12 w-6 lg:hidden">
            <path d="M12 3 V 42" stroke="#111113" strokeWidth="2" strokeLinecap="round" />
            <path d="M5 35 L 12 44 L 19 35" fill="none" stroke="#111113" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-center text-xs text-[#5d5d63]">
            Lanes 1–3
            <br />
            6:00 – 8:00 PM
          </p>
        </div>

        <Panel className="flex flex-1 flex-col gap-4 p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold text-[#111113]">Swim club added</p>
            <p className="text-xs text-[#5d5d63]">Sample · Tuesday 6:00 PM</p>
          </div>
          <PoolFromAbove
            lanes={["club", "club", "club", "swim", "swim", "swim", "swim", "swim"]}
            labels={[
              { from: 0, to: 3, title: "Swim club", lines: ["Reserved", "6:00 – 8:00 PM"], tone: "club" },
              {
                from: 3,
                to: 8,
                title: "Lane Swim",
                lines: ["Lanes 4–8 · 6:00 – 8:00 PM", "Lanes 1–8 from 8:00 PM"],
                tone: "swim",
              },
            ]}
          />
          <p className="font-hand -rotate-1 text-[25px] leading-none font-semibold text-[#0066cc]">
            One entry. The lane swim changed itself.
          </p>
        </Panel>
      </div>
    </section>
  );
}
