import { SAMPLE_MONDAY, printRange, spaceList } from "./sampleWeek";

/**
 * The two printouts, shown on screen as samples.
 *
 * These are drawn here rather than by mounting `PrintableSchedule` and
 * `DeckSheet`, for two reasons. Both take `ExpandedSession`s and format their
 * Dates, which a server render in UTC and a hydration in the visitor's zone
 * would disagree about; and `PrintableSchedule` is `hidden print:block` by
 * design, so it cannot be looked at without printing the marketing page.
 *
 * What they must not do is drift from the real sheets. The columns, the notice
 * wording, the "Staff copy" line and the drop-in list under the deck grid are
 * copied from those two components — change them there and change them here.
 * That includes the untidy parts: lanes are listed one by one ("Lane 4, Lane 5,
 * …"), because that is what both sheets print.
 *
 * Neither sample shows anything the real sheet does not print: session tags,
 * for one, are not on the visitor printout, so they are not on this one. The
 * deck sample does leave two real lines out — the "N of M free" count under a
 * drop-in block and the "open water" legend — because this page never calls a
 * lane free or open (docs/POSITIONING.md §7).
 */

/** Monday, from the same sample week the hero widget shows. */
const PRINT_ROWS = SAMPLE_MONDAY.map((s) => ({
  time: printRange(s),
  name: s.name,
  where: spaceList(s),
  notes: s.notes ?? "",
}));

export function PrintedScheduleSample() {
  return (
    <figure>
      <div className="rounded-lg border border-border bg-white text-black p-5 sm:p-6">
        <p className="text-[11px] text-gray-600">Sample aquatic centre</p>
        <p className="text-lg font-bold leading-tight">Drop-in schedule</p>
        <p className="text-sm font-medium">Week of Monday, October 5 – Sunday, October 11, 2026</p>

        <p className="mt-3 border border-gray-400 rounded px-3 py-2 text-[11px] leading-snug">
          <strong>Schedule subject to change.</strong> Sessions can be cancelled, moved or added
          after this was printed — please check the online schedule before you go. Printed
          October 2, 2026 at 9:14 AM.
        </p>

        <p className="mt-4 text-sm font-bold border-b-2 border-black pb-0.5">Monday, October 5</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-[11px] border-collapse">
            <tbody>
              {PRINT_ROWS.map((row) => (
                <tr key={`${row.time}-${row.name}`} className="border-b border-gray-300 align-top">
                  <td className="py-1 pr-3 font-medium whitespace-nowrap">{row.time}</td>
                  <td className="py-1 pr-3 font-semibold">{row.name}</td>
                  <td className="py-1 pr-3">{row.where}</td>
                  <td className="py-1 text-gray-700">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">
        Sample of the sheet a patron prints. One day shown; the printout carries the whole week.
      </figcaption>
    </figure>
  );
}

const DECK_LANES = [1, 2, 3, 4, 5, 6, 7, 8];
const DECK_TIMES = ["6:00", "6:30", "7:00", "7:30", "8:00", "8:30"];

/** Which cell starts a claim, per lane: row index → the claim drawn from there. */
function deckCell(lane: number, row: number) {
  if (lane <= 3 && row < 4) {
    return row === 0
      ? { span: 4, label: "Swim club", marker: "1", time: "6:00 – 8:00 AM", kind: "Rental or club · Reserved publicly" }
      : "covered";
  }
  if (lane >= 5 && row >= 4) {
    return row === 4
      ? { span: 2, label: "Swim lessons", marker: null, time: "8:00 – 9:00 AM", kind: "Program or lesson" }
      : "covered";
  }
  return null;
}

export function DeckSheetSample() {
  return (
    <figure>
      <div className="rounded-lg border border-border bg-white text-black p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4 border-b-2 border-black pb-2 mb-3">
          <div>
            <p className="text-lg font-bold leading-tight">Sample aquatic centre</p>
            <p className="text-sm font-medium">Monday, October 5</p>
          </div>
          <p className="text-right text-[10px] font-semibold uppercase tracking-wide leading-tight">
            Staff copy — not for posting publicly
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[29rem] border-collapse table-fixed">
            <thead>
              <tr>
                <th className="w-12 border border-gray-300 bg-gray-100 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-left">
                  Time
                </th>
                {DECK_LANES.map((lane) => (
                  <th
                    key={lane}
                    className="border border-gray-300 bg-gray-100 px-1 py-1 text-[10px] font-semibold text-left"
                  >
                    Lane {lane}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DECK_TIMES.map((time, row) => (
                <tr key={time}>
                  <th
                    scope="row"
                    className="border border-gray-300 px-1 py-0.5 text-[10px] font-medium text-left align-top whitespace-nowrap"
                  >
                    {time}
                  </th>
                  {DECK_LANES.map((lane) => {
                    const cell = deckCell(lane, row);
                    if (cell === "covered") return null;
                    if (cell === null) {
                      return <td key={lane} className="border border-gray-300 h-6" />;
                    }
                    return (
                      <td
                        key={lane}
                        rowSpan={cell.span}
                        className="border border-gray-300 bg-gray-100 px-1 py-0.5 align-top text-[10px] leading-tight"
                      >
                        <span className="font-semibold">
                          {cell.label}
                          {cell.marker && <sup className="ml-0.5 font-bold">{cell.marker}</sup>}
                        </span>
                        <span className="block">{cell.time}</span>
                        <span className="block text-gray-600">{cell.kind}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide">
          Drop-in blocks — running in whatever lanes are left
        </p>
        <p className="text-[11px]">
          <span className="font-semibold">Lane swim</span> · 6:00 AM – 9:00 AM · Lane 1, Lane 2, Lane 3, Lane 4, Lane 5, Lane 6, Lane 7, Lane 8
        </p>

        <p className="mt-3 border-t border-gray-300 pt-2 text-[11px] font-bold uppercase tracking-wide">
          Setup notes — staff only
        </p>
        <p className="text-[11px]">
          <span className="font-bold">1.</span>{" "}
          <span className="font-semibold">Swim club</span> (6:00 – 8:00 AM) — Backstroke
          flags in. Pace clock at lane 2.
        </p>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">
        Sample of the deck sheet staff print, cut down to the lanes and the morning. The club
        name and set-up note appear here and nowhere public.
      </figcaption>
    </figure>
  );
}
