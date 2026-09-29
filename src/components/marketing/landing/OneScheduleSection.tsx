import { Hand, h2Class, leadClass } from "./ui";

const TODAY = [
  { name: "Schedule PDF", note: "re-exported every change", tilt: "-rotate-[1.5deg]" },
  { name: "Excel deck sheet", note: "retyped for the guards", tilt: "rotate-1" },
  { name: "Photocopy", note: "taped up at the front desk", tilt: "-rotate-1" },
];

const OUTPUTS = [
  { name: "The website", note: "widget and public page" },
  { name: "The printed week", note: "for the front desk and the wall" },
  { name: "The staff deck sheet", note: "lane by lane, for the guards" },
];

export default function OneScheduleSection() {
  return (
    <section className="mx-auto flex max-w-[1200px] flex-col gap-12 px-4 pb-28 sm:px-6 sm:pb-40 xl:px-0">
      <div className="flex flex-col items-center gap-5 text-center">
        <h2 className={h2Class}>One schedule instead of four.</h2>
        <p className={leadClass + " max-w-[620px]"}>
          Today it&rsquo;s a PDF, a crazy Excel sheet, a photocopy and your program page. Dropin
          replaces three of them. Your booking system stays where it is.
        </p>
      </div>

      <div className="flex flex-col gap-10 rounded-[36px] bg-[#f4f4f5] p-6 sm:p-12 lg:flex-row">
        {/* What stays */}
        <div className="flex flex-col gap-3 border-b-[1.5px] border-dashed border-[#d9d9de] pb-8 lg:w-[220px] lg:shrink-0 lg:border-r-[1.5px] lg:border-b-0 lg:pr-10 lg:pb-0">
          <p className="text-xs font-semibold text-[#5d5d63]">Stays as it is</p>
          <div className="flex flex-col gap-1.5 rounded-[14px] border border-[#e4e4e7] bg-white p-4">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="#111113" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18" />
            </svg>
            <p className="text-[15px] font-semibold text-[#111113]">Program page</p>
            <p className="text-[13px] leading-[19px] text-[#5d5d63]">
              Your booking system: ActiveNet, Xplor or whatever you run. Registrations and payments
              stay there.
            </p>
          </div>
          <Hand tone="teal" className="mt-2 -rotate-2 text-[22px]">
            untouched
          </Hand>
        </div>

        {/* What Dropin replaces, and what it produces */}
        <div className="flex flex-1 flex-col items-center">
          <p className="mb-3 self-start text-xs font-semibold text-[#5d5d63]">Rebuilt by hand today</p>
          <ul className="grid w-full gap-3 sm:grid-cols-3 sm:gap-6">
            {TODAY.map((t) => (
              <li key={t.name} className={"rounded-[14px] border border-[#e4e4e7] bg-white px-4 py-3.5 " + t.tilt}>
                <p className="text-[15px] font-semibold text-[#111113] line-through decoration-[#9a3412]">
                  {t.name}
                </p>
                <p className="text-xs text-[#5d5d63]">{t.note}</p>
              </li>
            ))}
          </ul>
          <svg aria-hidden viewBox="0 0 860 64" preserveAspectRatio="none" className="hidden h-16 w-full sm:block">
            <path d="M143 4 C 143 40, 430 24, 430 60 M430 4 V 60 M717 4 C 717 40, 430 24, 430 60" fill="none" stroke="#a1a1a8" strokeWidth="2" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          </svg>
          <span aria-hidden className="my-3 h-8 border-l-2 border-dashed border-[#a1a1a8] sm:hidden" />
          <div className="flex items-center gap-3.5 rounded-2xl bg-[#111113] px-7 py-4 text-white">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[22px]">
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M8 2v4M16 2v4M3 10h18" />
            </svg>
            <div>
              <p className="text-[17px] font-semibold">One Dropin schedule</p>
              <p className="text-xs text-[#c9c9ce]">entered once by your staff</p>
            </div>
          </div>
          <svg aria-hidden viewBox="0 0 860 64" preserveAspectRatio="none" className="hidden h-16 w-full sm:block">
            <path d="M430 4 C 430 40, 143 24, 143 60 M430 4 V 60 M430 4 C 430 40, 717 24, 717 60" fill="none" stroke="#0066cc" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <span aria-hidden className="my-3 h-8 border-l-2 border-[#0066cc] sm:hidden" />
          <ul className="grid w-full gap-3 sm:grid-cols-3 sm:gap-6">
            {OUTPUTS.map((o) => (
              <li key={o.name} className="rounded-[14px] border-[1.5px] border-[#0066cc] bg-white px-4 py-3.5">
                <p className="text-[15px] font-semibold text-[#111113]">{o.name}</p>
                <p className="text-xs text-[#5d5d63]">{o.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mx-auto max-w-[760px] text-center text-[19px] leading-[1.5] font-medium tracking-[-0.01em] text-[#111113] sm:text-[22px]">
        Change it once.{" "}
        <span className="text-[#5d5d63]">
          When a rental moves, the website, the printed week and the deck sheet all change with it.
        </span>
      </p>
    </section>
  );
}
