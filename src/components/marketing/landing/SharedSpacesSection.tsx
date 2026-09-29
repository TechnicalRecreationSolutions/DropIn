"use client";

import Link from "next/link";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Check, Hand, MapView, h2Class, leadClass, type MapBlock } from "./ui";

interface SpaceExample {
  id: string;
  tab: string;
  hook: string;
  points: string[];
  map: {
    subtitle: string;
    columns: string[];
    start: number;
    end: number;
    ticks: string[];
    blocks: MapBlock[];
  };
}

/** One sample schedule per kind of space. Illustrative, not live data. */
const EXAMPLES: SpaceExample[] = [
  {
    id: "pool",
    tab: "Pool",
    hook: "The swim club takes lanes 1–3. Lane swim keeps the rest.",
    points: ["Lanes, the teach tank and the leisure pool as their own spaces", "Rentals reserve lanes; drop-in takes what’s left"],
    map: {
      subtitle: "Sample · Tuesday evening · Map view",
      columns: ["Lane 1", "Lane 2", "Lane 3", "Lane 4", "Lane 5", "Lane 6", "Lane 7", "Lane 8"],
      start: 18,
      end: 21,
      ticks: ["6 PM", "7 PM", "8 PM", "9 PM"],
      blocks: [
        { col: 0, span: 3, start: 18, end: 20, tone: "reserved", title: "Swim Club", detail: "Reserved · 6–8 PM" },
        { col: 3, span: 5, start: 18, end: 20, tone: "blue", title: "Lane Swim · Lanes 4–8", detail: "6:00 – 8:00 PM" },
        { col: 0, span: 8, start: 20, end: 21, tone: "blue", title: "Lane Swim · Lanes 1–8", detail: "8:00 – 9:00 PM" },
      ],
    },
  },
  {
    id: "gym",
    tab: "Gym",
    hook: "Pickleball on courts 2–3 while basketball runs on court 1.",
    points: ["Each court is its own column", "Visitors filter to the sport they play"],
    map: {
      subtitle: "Sample · Saturday morning · Map view",
      columns: ["Court 1", "Court 2", "Court 3"],
      start: 9,
      end: 13,
      ticks: ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM"],
      blocks: [
        { col: 0, span: 1, start: 9, end: 11, tone: "green", title: "Youth Basketball", detail: "9:00 – 11:00 AM" },
        { col: 1, span: 2, start: 9, end: 12, tone: "orange", title: "Pickleball · Courts 2–3", detail: "9:00 AM – 12:00 PM" },
        { col: 0, span: 1, start: 11, end: 12, tone: "reserved", title: "Birthday rental", detail: "Reserved" },
        { col: 0, span: 3, start: 12, end: 13, tone: "blue", title: "Drop-in Gym · all courts", detail: "12:00 – 1:00 PM" },
      ],
    },
  },
  {
    id: "arena",
    tab: "Arena",
    hook: "Hockey rents half the ice. Public skate keeps the other half.",
    points: ["Full ice or half ice, from the same rink", "Rentals and drop-in skate side by side"],
    map: {
      subtitle: "Sample · Friday evening · Map view",
      columns: ["Rink · Half A", "Rink · Half B"],
      start: 16,
      end: 20,
      ticks: ["4 PM", "5 PM", "6 PM", "7 PM", "8 PM"],
      blocks: [
        { col: 0, span: 2, start: 16, end: 17.5, tone: "blue", title: "Public Skate · full ice", detail: "4:00 – 5:30 PM" },
        { col: 0, span: 1, start: 17.5, end: 19, tone: "reserved", title: "Minor Hockey", detail: "Reserved · half ice" },
        { col: 1, span: 1, start: 17.5, end: 19, tone: "blue", title: "Public Skate · half ice", detail: "5:30 – 7:00 PM" },
        { col: 0, span: 2, start: 19, end: 20, tone: "orange", title: "Adult Shinny · full ice", detail: "7:00 – 8:00 PM" },
      ],
    },
  },
  {
    id: "court",
    tab: "Multisport court",
    hook: "Badminton, volleyball and pickleball share one floor, section by section.",
    points: ["The floor’s sections, each its own column", "A whole-floor booking covers every section under it"],
    map: {
      subtitle: "Sample · Wednesday evening · Map view",
      columns: ["Court A", "Court B", "Court C", "Court D"],
      start: 18,
      end: 22,
      ticks: ["6 PM", "7 PM", "8 PM", "9 PM", "10 PM"],
      blocks: [
        { col: 0, span: 4, start: 18, end: 19.5, tone: "teal", title: "Badminton · Courts A–D", detail: "6:00 – 7:30 PM" },
        { col: 0, span: 4, start: 19.5, end: 21, tone: "green", title: "Drop-in Volleyball · full floor", detail: "7:30 – 9:00 PM" },
        { col: 0, span: 2, start: 21, end: 22, tone: "teal", title: "Badminton · A–B", detail: "9:00 – 10:00 PM" },
        { col: 2, span: 2, start: 21, end: 22, tone: "orange", title: "Pickleball · C–D", detail: "9:00 – 10:00 PM" },
      ],
    },
  },
  {
    id: "studios",
    tab: "Studios and rooms",
    hook: "Yoga in Studio A, spin in the cycle studio, a rental in the hall.",
    points: ["Every bookable room, side by side", "Fitness classes and room rentals on one schedule"],
    map: {
      subtitle: "Sample · Monday morning · Map view",
      columns: ["Studio A", "Studio B", "Cycle studio", "Hall"],
      start: 9,
      end: 13,
      ticks: ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM"],
      blocks: [
        { col: 0, span: 1, start: 9, end: 10, tone: "green", title: "Yoga", detail: "9:00 – 10:00 AM" },
        { col: 0, span: 1, start: 10.5, end: 11.5, tone: "orange", title: "Zumba", detail: "10:30 – 11:30 AM" },
        { col: 1, span: 1, start: 10, end: 11, tone: "pink", title: "Seniors’ Fitness", detail: "10:00 – 11:00 AM" },
        { col: 1, span: 1, start: 12, end: 13, tone: "teal", title: "Stretch", detail: "12:00 – 1:00 PM" },
        { col: 2, span: 1, start: 9.5, end: 10.25, tone: "blue", title: "Spin", detail: "9:30 – 10:15 AM" },
        { col: 2, span: 1, start: 12, end: 12.75, tone: "blue", title: "Spin", detail: "12:00 – 12:45 PM" },
        { col: 3, span: 1, start: 9, end: 12, tone: "reserved", title: "Community rental", detail: "Reserved · 9 AM – 12 PM" },
      ],
    },
  },
];

export default function SharedSpacesSection() {
  return (
    <section id="features" className="mx-auto flex max-w-[1200px] scroll-mt-20 flex-col gap-11 px-4 pb-28 sm:px-6 sm:pb-40 xl:px-0">
      <TabsPrimitive.Root defaultValue="pool" className="flex flex-col gap-11">
        <div className="relative flex flex-col items-center gap-5 text-center">
          <h2 className={h2Class}>Every shared space, not just the pool.</h2>
          <p className={leadClass + " max-w-[660px]"}>
            Most centres print a paper drop-in schedule for each department: aquatics, arena, gym and
            fitness, each one retyped by hand. Dropin runs them all from one place, and every
            department gets its own schedule on the website and a printable week for the front desk.
          </p>
          <div className="mt-2 w-full overflow-x-auto sm:w-auto">
            <TabsPrimitive.List
              aria-label="Kind of space"
              className="mx-auto flex w-max gap-0.5 rounded-full bg-[#f4f4f5] p-1"
            >
              {EXAMPLES.map((ex) => (
                <TabsPrimitive.Trigger
                  key={ex.id}
                  value={ex.id}
                  className="cursor-pointer rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap text-[#5d5d63] transition-colors hover:text-[#111113] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc] data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-[#111113] data-[state=active]:shadow-[0_1px_2px_rgba(17,17,19,0.1)]"
                >
                  {ex.tab}
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
          </div>
          <span className="sr-only">Works for any space you book, including fields, halls and climbing walls.</span>
          <Hand className="-rotate-2 text-[22px] xl:hidden">…and any space you book: fields, halls, climbing walls</Hand>
          <Hand className="absolute right-0 -bottom-4 hidden -rotate-3 items-center gap-2 text-[25px] leading-6 xl:flex">
            <svg viewBox="0 0 46 26" className="h-[26px] w-[46px]">
              <path d="M44 8 C 30 2, 16 6, 6 16" fill="none" stroke="#0066cc" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M4 7 L 5 17 L 15 17" fill="none" stroke="#0066cc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-left">
              …and any space you book:
              <br />
              fields, halls, climbing walls
            </span>
          </Hand>
        </div>

        <div className="rounded-[36px] bg-[#f4f4f5] p-5 sm:p-12">
          {EXAMPLES.map((ex) => (
            <TabsPrimitive.Content
              key={ex.id}
              value={ex.id}
              className="flex flex-col gap-8 outline-none lg:flex-row lg:items-center lg:gap-14"
            >
              <div className="flex flex-col gap-4 lg:w-[320px] lg:shrink-0">
                <p className="text-[13px] font-semibold text-[#5d5d63]">{ex.tab}</p>
                <h3 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.03em] text-[#111113] sm:text-[30px]">
                  {ex.hook}
                </h3>
                <ul className="flex flex-col gap-2.5">
                  {ex.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[15px] leading-[23px] text-[#111113]">
                      <Check className="mt-1" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0 flex-1 overflow-x-auto">
                <MapView
                  className="min-w-[520px]"
                  title={ex.tab}
                  subtitle={ex.map.subtitle}
                  columns={ex.map.columns}
                  start={ex.map.start}
                  end={ex.map.end}
                  ticks={ex.map.ticks}
                  blocks={ex.map.blocks}
                />
              </div>
            </TabsPrimitive.Content>
          ))}
        </div>
      </TabsPrimitive.Root>

      <p className="text-center text-[17px] leading-[27px] text-[#5d5d63]">
        One schedule per department, one login per coordinator, all on one account. Departments are
        unlimited on every plan.{" "}
        <Link href="#pricing" className="font-medium text-[#111113] underline">
          See pricing
        </Link>
      </p>
    </section>
  );
}
