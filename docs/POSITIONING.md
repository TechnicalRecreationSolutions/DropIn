# Positioning: what Dropin does and how it works

**Written 2026-09-28.** A working document. The marketing page
(`src/app/(public)/page.tsx`) is written to it, so change the claim here first
and the page second.

Every "built" line below was checked against the code on 2026-09-28, not taken
from a README. Two READMEs turned out to be stale during that check; they are
listed in [section 9](#9-gaps-this-exposed). Anything marked **(assumption)** has
not been confirmed with a customer.

---

## 1. The one line

> Your booking system knows what's been claimed. Dropin shows everyone how the
> space is being shared.

**Headline:** Show the space, not just the time.

**What it is for:** a visual scheduling tool to improve recreation access. When
a schedule shows the space, more people can tell what is on and where before
they come. That is the owner's framing, set on 2026-09-28, and it widened the
headline from the earlier "Your pool schedule, lane by lane": **Dropin is not
just for pools.** Pools are the lead example, not the product.

"Access" here means the schedule is clear. It never means a lane is open or a
spot is there to be had (section 7).

Lines held in reserve, in case the headline is tested or changed:

| Line | Use it if |
|---|---|
| See what's on, and where. | the plainest, most literal line is wanted |
| Lane by lane. Court by court. Room by room. | rhythm matters more than brevity |
| Every lane, every court, one picture. | the page is aimed at patrons |
| A clearer way into recreation. | an access line is needed on its own (now the hero's support line) |

## 2. What Dropin is, and is not

**Is:** a visual schedule for recreation centres that shows what's on, and
where: lane by lane, court by court, room by room. Patrons see it on the centre's website or
on paper. Staff get a printable lane set-up sheet for the deck.

**Is not:** a booking, registration or payment tool. It sits beside ActiveNet
or Xplor Recreation. Those record who booked what; Dropin shows where it is
happening.

**The hand-off is a link.** A session can carry up to three labelled links
("Register"), which open the centre's own registration page. There is no sync
and no import from a booking system. **Staff enter the schedule in Dropin.**
This is the first objection a buyer will raise, so the page says it plainly
rather than leaving it to be discovered.

## 3. Who it is for

In priority order. This is the order of the *examples* on the page, not a
limit on who the product is for: the headline speaks to any shared space.

| # | Space | Why Dropin fits | Weight on the page |
|---|---|---|---|
| 1 | **Pools** | Rec software does not show lanes. The public PDF cannot show that a club has half the pool. Staff keep a separate Excel deck sheet. | Lead story, hero visual |
| 2 | **Shared multi-sport courts** | One floor hosts pickleball, basketball, volleyball. A list cannot show which section is which. | Second story |
| 3 | Arena dressing rooms, fitness and weight rooms, fields | They are spaces on a schedule like any other. Fields got a shape in the map builder on 2026-09-30 (`field-soccer`), so they now draw on a floorplan too. | One strip, no more |

**Not a target:** tennis and racquet clubs, intramurals. A tennis court shape
exists in the map builder and `/find` can filter by sport; neither is marketed.

> 2026-09-30: at the owner's request the hero widget's sample includes a
> **Racquets** space (tennis and pickleball courts), alongside an arena, a
> soccer field and an outdoor multi-sport court. That is a sample, not a
> change to the target list above; revisit this section if the owner means it
> as one.

### The first buyer

- **Aquatics coordinator or aquatics supervisor** at a municipal indoor pool
  where clubs, lessons and public swims share lanes. A recreation manager signs
  off.
- Second: the facility supervisor of a centre with a shared multi-use floor.
  **(assumption)**
- Size: a municipality with one to five facilities. **(assumption)**

### What makes them look **(all assumptions)**

- A new season's schedule is due.
- Front desk complaints: "lane swim was full", "I didn't know the club was in."
- The person who built the Excel deck sheet leaves.
- The website is being redone, or a facility opens or reopens.

### Objections to expect

| Objection | Honest answer |
|---|---|
| "So we type the schedule in twice?" | Yes. In return the website, the paper copy and the deck sheet all come from one place. |
| "ActiveNet already shows our programs." | It shows times. It does not show lanes or sections. |
| "Our website is run by IT or communications." | They need to add the embed. The page Dropin hosts is the fallback. **(assumption)** |

## 4. The problem, in the buyer's terms

The schedule lives in four places and none of them show lanes:

1. **The PDF.** Wrong the day a time changes, hard to read on a phone.
2. **The program page** in the booking system. Says lane swim is at 6, not that
   the club has half the pool.
3. **The deck sheet.** Kept in Excel or a binder, because nothing else shows
   lanes.
4. **The photocopy.** Many patrons are older and want paper. Someone rebuilds
   it by hand.

## 5. How it works

### What staff do

1. **Draw the building.** Place ready-made shapes: pools with lanes, courts,
   a rink, a gym floor, rooms. Name lanes and sections the way staff already do.
2. **Put sessions in lanes.** Each session is added to the lanes or sections it
   uses. A weekly session is set once. Each one is a drop-in, a program, a
   rental or a closure.
3. **Publish.** Embed the schedule in the centre's website, or share the page
   Dropin hosts.
4. **Print.** Patrons print the week. Staff print the day's deck sheet.

### The rule that makes it a space schedule

A **drop-in** session takes whatever lanes are left. Programs, rentals and
closures take their lanes outright. So when a club holds lanes 1 to 3 from 6 to
8, a lane swim entered for lanes 1 to 8 is published as lanes 4 to 8 for those
two hours, and all eight afterwards. Nobody retypes the lane swim.

### What each audience sees

| | Public | Staff |
|---|---|---|
| A rental or club booking | "Reserved", with its time and lanes | The club's name and the set-up notes |
| A drop-in swim | The lanes left to it | The same, plus what took the rest |
| A closure | A notice above the schedule, or a closure on the schedule | The same |
| The deck sheet | Never | One day, lanes across, time down |

## 6. What is built

### Built

| Feature | Caveat to respect in copy |
|---|---|
| Map builder with ready-made shapes | Pools (4, 6, 8 lanes), leisure pool, five court types, rink, gym floor, climbing wall, rooms. The gym floor has no sport markings, on purpose. No field shapes. |
| Public floorplan view | Shows what's on now and what starts within the hour, tags such as "Ends in 6 min" and "→ Aquafit 7:30 PM", and a control to look at other times today. The centre has to turn this view on, and it needs a published map. |
| By-space view | Lanes across, time down, one day at a time. |
| Week grid, list and timetable views | |
| One session across several lanes | |
| Drop-in swims shrink to the lanes left | Only public and "Reserved" bookings count. A booking marked hidden does not reduce what the public sees. |
| "Reserved" for rentals and clubs | The name and notes are held in a table the public cannot read. |
| Staff-only holder name and set-up notes | |
| Deck sheet | One day. Staff only, enforced on the server. |
| Public print button | Prints the week the visitor filtered to, with the print date and a "subject to change" note. **Does not print tags.** Printing from inside an embed on iOS Safari is unchecked. |
| Widget Facility / Department / Schedule menus | Leaving a menu empty shows everything in it. The org chooses, per menu, whether visitors pick one or several (migration 065; off until turned on). The floor map needs exactly one building. A visitor's picks can cover at most 250 schedules at once. |
| Tags | On screen only. |
| Registration links | Up to three per session, labelled, typed in by staff. |
| Repeating sessions and single-date changes | One date can be cancelled or have its **time** changed. Moving one date to a different lane is not possible. |
| Conflict checks | Blocks a save that would double-book a lane. A drop-in and a booking that takes lanes outright do not conflict, because the drop-in takes what is left. **Imported sessions skip this check**, and so does a this-week-only change. |
| Closure notices | Whole building or one space. In an embed, only when the embed shows one building. |
| Brand colour and logo | One colour, set by staff. |
| Embed and hosted facility page | |
| Staff roles, coordinators limited to their department | Enforced in the database. |
| Change history and undo | Covers facilities, departments, spaces, schedules, sessions and templates. Not single-date changes, maps, widget settings or notices. |
| Analytics | Counts views. It does not identify returning visitors across days. |
| Head counts and water temperature | Public display is off until the centre turns it on. |

### Partly built

| Feature | What is missing |
|---|---|
| Spreadsheet import | CSV only. Imported sessions have no lanes and skip the conflict check. Staff assign lanes by hand before a session appears in the lane views. |
| Staff invitations | No email is sent. Staff copy a link. |
| Billing | The Starter plan cannot be bought by card yet. |
| Plan differences | Nothing enforces a plan. Deliberate, see `pricing-tiers.md`. |

### Not built

| Not built | Note |
|---|---|
| Booking, registration, payments | By design. |
| Any link to ActiveNet or Xplor beyond a typed URL | |
| "Open" or "available" space | See section 7. |
| Published lane counts ("3 lanes") | Worked out for staff only. |
| Alternate layouts | No long course and short course, no re-lining one floor into different courts. Built, then removed in migration 049. Sections of a floor are fixed. |
| Club allocation tools, club portal | A rental with a private name is all there is. |
| Lobby TV mode | The floorplan refreshes in a browser tab. There is no display mode. |
| Notifications, calendar export, custom domain, translation | |

## 7. Words

| Say | Do not say | Why |
|---|---|---|
| what's on, where | open, available, free | An empty lane is not a usable lane. |
| the lanes lane swim has | lanes open for swimming | Same. |
| sits beside, links to | integrates with, syncs with | There is no integration. |
| sections of the floor | court layouts, configurations | Sections are fixed. |
| flags, checks | prevents all double-booking | Imports skip the check. |
| views | visitors, unique visitors | It counts views. |
| sample | live preview, demo site | Every picture on the page is a sample. |
| a clearer way in, easier to read | get a spot, find a lane, room for you | "Access" is about the schedule being clear, not about space being there. |

Also never: testimonials, customer logos, statistics, time-saved figures, or a
set-up time ("in an afternoon").

Tone: plain and short. Words a lifeguard supervisor would use. No "platform",
"solution", "seamless", "streamline".

## 8. Questions to settle

These decide the target market and the next features. None is answered yet.

**Market**

1. Is the first customer a single pool, or a municipality with several
   facilities? It changes which plan the page should lead with.
2. Does the aquatics coordinator have the budget, or does every sale go through
   the recreation manager?
3. How many target pools have a club sharing lanes with public swims? That is
   the case the product answers best.
4. For courts: is the buyer the same person as for pools, or a different one in
   the same building?
5. Who controls the website at a typical centre, and how hard is adding an
   embed?

**Features the positioning leans on**

6. Should the floorplan stop calling an empty space "Free"? (Section 9.)
7. Should tags print? The paper schedule is a selling point and tags such as
   "Women only" matter most on paper.
8. Is entering the schedule twice acceptable long term, or is an import from
   the booking system's export the feature that closes sales?
9. Do pools need long course and short course before they will buy?
10. Do shared courts need overlapping layouts (three pickleball courts on one
    basketball court) before the courts story is true for most gyms?
11. Is a lobby screen wanted often enough to build a display mode?

## 9. Gaps this exposed

Found while checking claims. None was changed; each is a decision.

| Gap | Where |
|---|---|
| The public floorplan labels a space with nothing scheduled as **"Free"**. It ignores closure notices and operating hours, so a closed pool at 11 pm reads "Free". | `components/schedule/FloorplanLegend.tsx`, `FloorplanView.tsx`, `SpaceDetailSheet.tsx` |
| Tags do not appear on either printout. A comment in migration 050 says they do. | `components/schedule/PrintableSchedule.tsx` |
| "Starting soon" on water draws white text on a pale wash and is hard to read. | `components/facility-maps/renderer/shapes.tsx` |
| Migration 049 says a long course or short course label "moves onto the session". That label was never added. | `supabase/migrations/049_*.sql` |
| `components/schedule/README.md` says computed lane availability is staff-only. The lane *subtraction* has been public since commit 6ebcb00; only the *counts* are staff-only. | that README |
| Both printouts list lanes one by one ("Lane 4, Lane 5, Lane 6…"). Nothing shortens a run to "Lanes 4–8". | `PrintableSchedule.tsx`, `DeckSheet.tsx` |
| The staff deck sheet prints "5 of 8 free" and "An empty cell is open water". Staff-only, but it is the wording section 7 rules out. | `components/schedule/DeckSheet.tsx` |
| The contact address `hello@dropin.app` is on the pricing cards. Whether the mailbox exists was not confirmed. | `components/marketing/PricingGrid.tsx` |

## 10. Where the copy lives

| Surface | File |
|---|---|
| Landing page | `src/app/(public)/page.tsx` |
| Hero: the live widget (real public widget components on a sample week) | `src/components/marketing/landing/LiveWidgetDemo.tsx`, data in `heroWidgetSample.ts` |
| Other page visuals (hand-drawn copies of the product) | `src/components/marketing/landing/*Section.tsx`, `landing/ui.tsx` |
| No longer used by the page (left in place, not deleted) | `sampleWeek.ts`, `sampleFacilities.ts`, `SampleMap.tsx`, `SharedSpaceDemo.tsx`, `PaperSamples.tsx`, `WidgetPreview.tsx` in `src/components/marketing/` |
| FAQ | `src/components/marketing/FaqSection.tsx` |
| Pricing cards and plan wording | `src/components/marketing/PricingGrid.tsx`, `src/lib/stripe/plans.ts` (unchanged) |
| Default title and description | `src/app/layout.tsx` |
| Nav and footer | `src/components/layout/PublicNav.tsx`, `src/app/(public)/layout.tsx` |
| Signup heading | `src/app/(auth)/signup/page.tsx` |

### How the pictures are made

The two maps on the page are drawn by `FacilityMapSvg`, the same renderer the
public floorplan and the map builder use, fed sample data. They are the product
drawing a made-up building, not an illustration of the product.

The two printouts and the five-view sample are drawn for the page. They copy
the layout and wording of `PrintableSchedule`, `DeckSheet` and the real views.
If one of those changes, change its sample.

There are no customer screenshots, because there is no customer data that can
be shown.
