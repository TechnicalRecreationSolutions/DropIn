# Prompt: Learn How Crystal Pool Runs Its Deck

Paste the block below into a fresh Dropin session. It produces a **learning
document**, not code and not a plan. Its output is the source that later
deck-sheet prompts will quote, so structure matters as much as content.

Do not let it start implementing. Do not let it skip the extraction step and
summarise from the filenames.

---

You are reviewing three real internal documents from **Crystal Pool, Victoria
BC** — a prospective Dropin customer with an unusually complex tank. Your job is
to understand how their staff actually use these artifacts and write a detailed
learning document. **Write no application code in this session** and change
nothing under `src/` or `supabase/`.

## Read first

1. `docs/DISCOVERY-internal-view.md` — the Commonwealth Rec conversation that
   started the internal-view track. Section 8 lists seven open questions.
   Several of them are answered outright by the Crystal Pool documents; finding
   which is part of your job.
2. `docs/PLAN-internal-view.md` — the model that was actually built
   (migrations 046/047/048). Pay attention to §3 "Facility configuration (the
   bulkhead)" and §15 "Stage 4 — the sheet is a table".
3. `docs/RESUME.md` — project state.
4. `src/lib/schedule/deckSheet.ts` and `src/components/schedule/DeckSheet.tsx` —
   the artifact you are ultimately trying to improve.

Note the standing constraints: Dropin is **not a marketplace** and this is a
**simplify-for-launch** phase. A document describing a next phase is not
authorisation to build it. This prompt is discovery only.

## The three documents

All three sit in the repo root (`dropin/`):

- **`Pool Layout Map with depths.pdf`** — a scale plan of the tank with every
  space name and every depth marked.
- **`Lane Set-Up - September 2026.xlsx`** — 80 sheets.
- **`At-a-Glance 2026.xlsx`** — 15 sheets.

For reference, `SCP Lengths Schedule Aug 10-16.pdf` (also in the root) is
*Commonwealth's* public PDF, a different facility. Use it only for contrast.

### Extracting the spreadsheets — read this before you start

There is **no Python on this machine**. `unzip` and Node 22 are available. An
`.xlsx` is a zip of XML; unzip it into your scratchpad and parse it. Budget real
effort here — the meaning of these sheets lives in formatting, not just text:

- **Merged cells are the bookings.** `<mergeCell ref="B8:E12"/>` means one claim
  spanning four lanes and five time rows. A cell-value dump alone loses every
  block's extent.
- **Fill colour carries meaning.** `xl/styles.xml` → `cellXfs[s].fillId` →
  `fills[fillId]`. Cell `s=` attributes point into `cellXfs`.
- **Cell comments are a whole hidden data layer.** `xl/comments*.xml`, mapped to
  sheets via `xl/worksheets/_rels/sheetN.xml.rels`. Do not skip them — they are
  one of the most important findings available in these files.
- **Times are Excel day fractions.** `0.22916666` = 05:30. Rows are 15-minute
  steps in At-a-Glance.
- **Regex trap:** when scanning `<c ...>` elements, use a *lazy* attribute class
  (`<c ([^>]*?)(\/>|>([\s\S]*?)<\/c>)`). A greedy `[^>]*` swallows the `/` of a
  self-closing `<c .../>` and silently merges dozens of cells into one match.
  This will produce a confident, wrong answer if you do not check it.

A starting point you may adapt:

```js
// node xl.mjs <unzipped-dir> --list          -> sheet names
// node xl.mjs <unzipped-dir> "Sheet Name"    -> merges + non-empty cells
import fs from 'fs';
const base = process.argv[2], P = p => fs.readFileSync(base + '/' + p, 'utf8');
const ss = [...P('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
// ...resolve xl/_rels/workbook.xml.rels for sheet files, then per sheet:
//   merges: /<mergeCell ref="([^"]+)"/g
//   cells : /<c ([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g   <- lazy, see trap above
//   t="s" -> ss[<v>], t="inlineStr" -> <t>, else numeric
```

**Verify before asserting.** If you claim a colour means something, show the
cells that prove it and the cells that break it. Several claims that look
obvious in these files are wrong.

## Anchors confirmed while writing this prompt

These were checked against the files. Treat them as leads to **re-verify**, not
as facts to repeat — and correct them if your extraction disagrees.

- At-a-Glance is one sheet per **date range**, and the ranges are irregular:
  `Jan 14-Mar 14`, `SB (Mar 15-29)`, monthly April–July, then weekly from
  `Aug 1-13` through `Sept 21-27`. Ask what drives the granularity change.
- Each sheet is 7 days side by side; each day is a time column plus **8 lane
  columns**; rows are 15 minutes from 05:30 to 21:30.
- The **time column's fill colour is the tank configuration.** Row 70 is the
  legend, and the swatch sits to the *left* of its label. Pink `FFFF9999` = 50m,
  white/no-fill = 25m, a pale tint = FACILITY CLOSED, another = "20m Lane
  Set-Up Guide" — a legend entry that is a **cross-reference to the other
  workbook**. On `Sept 14-20`: Mon/Wed/Fri flip 50m→25m at 09:00, Tue/Thu at
  15:15, Sat runs 50m 05:45–08:30, Sun 50m 08:30–12:45.
- `LANE ROPE CHANGE` occupies full rows as a first-class entry, and those rows
  coincide with the configuration flips — except Saturday's, which starts
  **before** the flip. There are also rope changes at 18:00 and 21:00 that are
  not 50m/25m flips.
- `Sept 14-20!AV6`: "Vic Masters 7-8:15 (Guards start at 6:45 to open pool
  before they arrive)". `AV56`/`BE56`: "See Logbook / After-Hours Booking Email".
- Lane Set-Up sheets 1–2 are `Cover Sheet` and `Cover Sheet (LGO)`, marked
  "Deep End Copy" and "Lifeguard Office Copy" — two printed physical copies.
- Every Lane Set-Up page ends with the same three-item legend —
  **"Keifer Line" / "Rope Line" / "Designated space but no rope used"** — and a
  footer naming the set-up, e.g. "50M Lengths, Adult Leisure", "25M Lengths,
  Family Swim, Adult Leisure", "Lessons", "After-Hours Booking".
- Sheets `Kayak Polo`, `Kayakers`, `BCMA` carry paragraphs of operating
  procedure that are not about lanes at all — window curtains, changeroom gates,
  radioing Maintenance first, a wristband table put out at 18:20, removing the
  50m flags, L-blocks for goal anchors.
- The `Lane Set up` and `Lane Set Up All Lanes` sheets align ropes to **physical
  landmarks**: "Focal Pt 1", "Focal Pt 2", "In line with cubbies", "On Black
  Line", "Slide Here", "Ladder Here".
- The Pool Layout Map defines **overlapping** name families over the same water:
  `CP50M 1-8`, `CP25M 1-8`, `CP20M 1-6`, `Shallow 20M 1-4`, lettered squares
  `"A"`–`"H"`, `"Deep A"`–`"Deep D"`, plus `Shallow/Mid/Deep Third`,
  `Deep Quarter 1/2`, `Mid Pool Double`. Depths run 1.07 m to 3.05 m. Confirm
  the adjacency yourself against the PDF — which names physically overlap which
  is the crux of this whole review.
- The source has drift in it: a sheet tabbed `Tues 1300-1515 (fun swim)` is
  titled "Thursday 1300-1515"; `BCMA` lists `25M #3` three times and omits `#2`;
  there is a `Wed 1530-19000` and an orphan `Sheet3`. Record drift as a finding
  about the medium, not as a transcription error to fix.

## Write `docs/LEARNING-crystal-pool.md`

Match the voice of `docs/DISCOVERY-internal-view.md`: direct, specific,
comfortable saying what is not yet known. Open with a line stating it is
**discovery, not authorisation to build**.

**Anonymise people.** The spreadsheet comments carry real staff names. Refer to
roles — "the scheduler", "a colleague at the lake programme" — never names.

Required structure:

### 1. The three-layer spine

Establish up front that these are not three documents but one system at three
levels: the Layout Map is the **vocabulary** (what the spaces are called), the
Lane Set-Up book is the **grammar** (which physical states are legal and how to
build them), At-a-Glance is the **sentences** (who holds what, when). Use this
frame throughout. Say where each layer is physically kept and who reads it.

### 2. Numbered concepts `C1`…`Cn`

Aim for 8–12. One concept per thing a reader can hold in their head and act on.
Each gets: a short name, two or three sentences, **at least one cell or sheet
citation**, and a line on why it matters to a scheduling product. Number them
stably — later prompts will cite `C7` by name.

Derive these from the documents. Do not simply expand the anchor list above; it
is a floor, not a ceiling, and at least some of the most useful concepts are in
the comment layer and the special-event sheets rather than in the grid.

### 3. The seams

The failures live between layers, not inside them. At minimum work through:

- What happens when the vocabulary lets the same water be addressed under two
  names *at once* — and whether Crystal actually does this or merely could.
- What it costs that the grammar (the set-up book) and the sentences
  (At-a-Glance) are separate files with a colour-coded cross-reference and two
  printed copies that can drift apart.
- Where information has no home in the grid and gets pushed into hover-only
  comments, cell text suffixes, or a Logbook the sheet merely points at.

### 4. Crystal vs. Commonwealth

A comparison table. Same job, different scale and different pressures. Be
explicit about what is **general to aquatic operations** and what is
**Crystal-specific**. Building the second as if it were the first is the
expensive mistake this section exists to prevent.

### 5. What this confirms and what it contradicts

A table with a row per finding: `Concept | PLAN decision | Confirms / Challenges
/ Silent | Consequence`. Quote the plan decision precisely. Give particular
attention to two decisions in `PLAN-internal-view.md §3`:

- "**Deliberately not modelled: physical overlap.** … a facility is in exactly
  one configuration at a time, so two overlapping sessions claiming spaces from
  *different* configurations is an advisory warning."
- "**the configuration is declared, not derived, and transitions are not
  modelled.**"

State plainly whether Crystal breaks these, and if so whether the break is
fatal, or a per-customer edge the advisory already handles. Do not soften this;
the point of the exercise is to find out before a sales conversation does.

### 6. Answers to the open questions

Walk `DISCOVERY-internal-view.md §8`, questions 1–7, and mark each
**Answered / Partially answered / Still open**, citing the evidence. Question 7
("is this one centre's workflow or the industry norm?") now has a second data
point — say what two centres do and do not have in common.

### 7. What we still cannot tell from the documents

The questions that need a human at Crystal. Be specific enough that someone
could read this list down a phone call.

### 8. Candidate follow-on prompts

The section that makes this document useful. **6–10** candidate prompts to
improve the deck sheet and the internal views, each with:

- a working title,
- the single question it would answer,
- which concepts (`C3`, `C7`…) it draws on,
- whether it is a **view** change, a **data-model** change, or **discovery**,
- a rough size, and whether it could ship inside simplify-for-launch.

Rank them by value-to-risk. Mark clearly which ones are only worth doing if
Crystal actually buys, and which improve the deck sheet for **every** customer
regardless — that distinction is the deliverable I care most about.

## Rules

- Cite a sheet and cell for every factual claim about the documents.
- When the files contradict this brief, the files win — say so explicitly.
- Flag anything you could not extract rather than inferring it.
- No code under `src/` or `supabase/`. No migrations. No schema drafted "just to
  show what it would look like".
- If you find yourself designing the solution, stop: that is the next prompt's
  job, and this document exists to make that prompt well-aimed.
