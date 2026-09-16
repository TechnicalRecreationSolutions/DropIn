"use client";

import { cn } from "@/lib/utils/cn";
import { formatSessionDayFull } from "@/lib/utils/dates";
import { RESERVED_PUBLIC_LABEL } from "@/lib/sessions/occupancy";
import { deckCellAt, type DeckSheetModel } from "@/lib/schedule/deckSheet";
import { bandTimeLabel } from "@/lib/schedule/availability";

interface DeckSheetProps {
  model: DeckSheetModel;
  facilityName: string;
  day: Date;
  /** Rendered in the corner so a sheet found on deck can be dated. Omitted while still loading. */
  printedAt: Date | null;
}

/**
 * The printable deck sheet: spaces across, time down, one day.
 *
 * A **table**, not the pixel grid the other time-axis views use, and that is the
 * whole reason this component exists rather than a print stylesheet over
 * `WeeklyScheduleMap`. Absolutely-positioned blocks on a fixed-height canvas
 * cannot paginate — a page break slices through them mid-block — whereas a table
 * breaks between rows, repeats its header on every page via
 * `display: table-header-group`, and is closer to the spreadsheet being
 * replaced. Print is the only output that matters here; the screen version is
 * the preview of it.
 *
 * What is drawn is only the **exclusive** claims (see `buildDeckSheet`): the grid
 * answers "who has the water", and the drop-in blocks that occupy the remainder
 * are listed under it with their own times. Setup notes are footnotes rather
 * than cell text — a cell has room for a name and a time, and a guard reading
 * "soft lane ropes, wave breakers, polo nets" needs it legible, not truncated.
 *
 * Every staff-only string here (holder names, setup notes) arrives already
 * gated: it comes from `session_internal` through `/api/sessions/expand`, which
 * queries that table only for members of the owning org. This component never
 * decides an audience — see components/schedule/README.md.
 */
export default function DeckSheet({ model, facilityName, day, printedAt }: DeckSheetProps) {
  return (
    <div className="deck-sheet text-foreground" data-deck-sheet={model.dateKey}>
      <header className="flex items-end justify-between gap-4 border-b-2 border-foreground pb-2 mb-3">
        <div>
          <h1 className="text-xl font-bold leading-tight">{facilityName}</h1>
          <p className="text-sm font-medium">
            {formatSessionDayFull(day)}
          </p>
        </div>
        <div className="text-right text-[10px] leading-tight">
          <p className="font-semibold uppercase tracking-wide">Staff copy — not for posting publicly</p>
          {/* A sheet on a wall outlives the day it was printed for. Without this
              there is no way to tell a current sheet from last Tuesday's. */}
          {printedAt && (
            <p>
              Printed {printedAt.toLocaleDateString("en-CA")}{" "}
              {printedAt.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </div>
      </header>

      {model.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No spaces at this facility yet — add lanes or courts and they become the columns of this
          sheet.
        </p>
      ) : (
        <table className="deck-grid w-full border-collapse table-fixed">
          <thead>
            <tr>
              <th className="w-16 border border-border bg-muted px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-left">
                Time
              </th>
              {model.columns.map((column) => (
                <th
                  key={column.spaceId}
                  data-deck-space={column.spaceId}
                  colSpan={column.tracks.length}
                  className="border border-border bg-muted px-1 py-1 text-xs font-semibold text-left"
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, slotIndex) => (
              <tr key={row.minutes} className={row.isHour ? "deck-hour" : undefined}>
                <th
                  scope="row"
                  className={cn(
                    "border border-border px-1 py-0.5 text-[10px] font-medium text-left align-top whitespace-nowrap",
                    row.isHour ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {row.label ?? ""}
                </th>

                {model.columns.flatMap((column) =>
                  column.tracks.map((track, trackIndex) => {
                    const cell = deckCellAt(track, slotIndex);
                    // A covered row must emit NO cell at all — an empty <td>
                    // under a rowSpan shifts every column after it by one.
                    if (cell === "covered") return null;

                    const key = `${column.spaceId}-${trackIndex}`;
                    if (cell === null) {
                      return (
                        <td
                          key={key}
                          data-deck-empty={column.spaceId}
                          className="border border-border px-1 py-0.5 align-top h-6"
                        />
                      );
                    }

                    return (
                      <td
                        key={key}
                        data-deck-claim={column.spaceId}
                        data-deck-session={cell.key}
                        rowSpan={cell.slotSpan}
                        className={cn(
                          "border border-border px-1 py-0.5 align-top text-[10px] leading-tight",
                          cell.kind === "closure" ? "deck-closure" : "deck-claim"
                        )}
                      >
                        <span className="font-semibold">
                          {cell.label}
                          {cell.noteMarker !== null && (
                            <sup className="ml-0.5 font-bold">{cell.noteMarker}</sup>
                          )}
                        </span>
                        <span className="block">{cell.timeLabel}</span>
                        <span className="block text-muted-foreground">
                          {cell.kindLabel}
                          {cell.disclosure === "reserved" && ` · ${RESERVED_PUBLIC_LABEL} publicly`}
                          {cell.disclosure === "internal" && " · not published"}
                        </span>
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Residual blocks. Deliberately below the grid and not in it: a drop-in
          block holds whatever the claims above leave, so putting it in a lane
          column would state something about that lane which isn't true. */}
      <section className="deck-after mt-3" data-deck-residual>
        <h2 className="text-xs font-bold uppercase tracking-wide">
          Drop-in blocks — running in whatever lanes are left
        </h2>
        {model.residual.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">None scheduled today.</p>
        ) : (
          <ul className="text-[11px] leading-snug" data-deck-residual-list>
            {model.residual.map((block) => (
              <li key={block.key}>
                <span className="font-semibold">{block.label}</span> · {block.timeLabel}
                {block.spaceNames.length > 0 && ` · ${block.spaceNames.join(", ")}`}
                {block.noteMarker !== null && <sup className="ml-0.5 font-bold">{block.noteMarker}</sup>}

                {/* What is actually left, once the grid above is subtracted
                    (stage 5, shadow mode). Printed only where it differs from
                    what the block claims: "all six lanes, all block" is already
                    what the line above says, and a deck sheet earns its space. */}
                {block.availability?.differs && (
                  <span className="block pl-3 text-muted-foreground" data-deck-availability={block.key}>
                    {block.availability.bands.map((band) => (
                      <span key={band.startMinutes} className="block">
                        {bandTimeLabel(band.startMinutes, band.endMinutes)}:{" "}
                        <span className="font-semibold text-foreground">
                          {band.available} of {block.availability!.claimed}
                        </span>{" "}
                        free{band.takenBy.length > 0 && ` — rest held by ${band.takenBy.join(", ")}`}
                      </span>
                    ))}
                    {block.availability.suppressed.map((gap) => (
                      <span key={gap.startMinutes} className="block font-semibold text-foreground">
                        {bandTimeLabel(gap.startMinutes, gap.endMinutes)}: nothing left
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {model.unplaced.length > 0 && (
        <section className="deck-after mt-3" data-deck-unplaced>
          <h2 className="text-xs font-bold uppercase tracking-wide">
            Booked, but no space recorded
          </h2>
          <ul className="text-[11px] leading-snug">
            {model.unplaced.map((block) => (
              <li key={block.key}>
                <span className="font-semibold">{block.label}</span> · {block.timeLabel} ·{" "}
                {block.kindLabel}
                {block.noteMarker !== null && <sup className="ml-0.5 font-bold">{block.noteMarker}</sup>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.notes.length > 0 && (
        <section className="deck-after mt-3 border-t border-border pt-2" data-deck-notes>
          <h2 className="text-xs font-bold uppercase tracking-wide">Setup notes — staff only</h2>
          <ol className="text-[11px] leading-snug">
            {model.notes.map((note) => (
              <li key={note.marker}>
                <span className="font-bold">{note.marker}.</span>{" "}
                <span className="font-semibold">{note.label}</span> ({note.timeLabel}) — {note.note}
              </li>
            ))}
          </ol>
        </section>
      )}

      {model.isEmpty && (
        <p className="deck-after mt-3 text-[11px] text-muted-foreground">
          Nothing is scheduled on this day. The empty grid above is still worth posting if the
          building is open — it is what the deck has to work from.
        </p>
      )}

      {/* The legend. An empty cell is the sheet's most common state and its
          meaning is not self-evident on paper: it is water the drop-in blocks
          above are entitled to. */}
      <p className="deck-after mt-2 text-[10px] text-muted-foreground">
        An empty cell is open water — it belongs to whichever drop-in block is running then.
      </p>
    </div>
  );
}
