# Design: how Dropin looks, in the app and on the site

**Written 2026-09-29.** The source of truth for Dropin's visual design. The
public landing page (`src/app/(public)/page.tsx`, built 2026-09-28) is the
reference implementation; the dashboard is being brought in line with it in
phases (`docs/prompts/app-redesign.md`). Change a rule here first, then the code.

What the product *says* is governed by `docs/POSITIONING.md`. This file only
covers how it *looks*.

---

## 1. The idea in one paragraph

Plain, confident and calm. White space, near-black type, one blue, soft grey
panels, hairline borders, and nothing that glows. The product's own pictures
(the schedule, the lanes, the map) carry the colour; the chrome around them
stays quiet. It should look like a tool a lifeguard supervisor trusts, not a
template.

## 2. Decisions (settled 2026-09-29)

| Question | Decision |
|---|---|
| Sidebar | **Not navy.** A plain light sidebar that matches the page: white (dark mode: the card colour), a hairline right border, ink text. |
| Main action colour | **Ink** (`#111113`). Blue is for links, focus rings and "you are here" states, never for big filled buttons. |
| Button shape | **Pills** (`rounded-full`) for buttons, everywhere. Inputs and cards keep soft corners (below). |
| Dark mode | **Kept.** Every token has a dark value; nothing is styled with a light-only literal. |
| Font | **Geist** for everything in the app. The handwriting face (Caveat) is marketing-only and never appears in the dashboard. |
| The public widget and facility page (`.org-theme`) | **Untouched.** They wear each centre's own brand colour. Dropin's palette must never leak into them. |

## 3. Colour tokens

Defined as CSS variables in `src/app/globals.css` (`:root` and `.dark`) and
exposed to Tailwind through `@theme inline`. **Components use the token
classes, never raw palette classes** (`bg-blue-600`, `text-gray-500`) and
never hex literals, except inside sample pictures and the `.org-theme` widget.

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#ffffff` | `#0f0f11` | Page |
| `foreground` | `#111113` | `#f4f4f5` | Body text, headings |
| `muted-foreground` | `#5d5d63` | `#a1a1aa` | Secondary text, captions, labels |
| `card` | `#ffffff` | `#18181b` | Cards, dialogs, sidebar (dark) |
| `raised` *(new)* | `#ffffff` | `#3a3a41` | The selected pill of a segmented control, on a `muted` track (a `card` is darker than the track in dark mode) |
| `muted` | `#f4f4f5` | `#1f1f23` | Soft grey panels, table headers, hover rows |
| `border` | `#e4e4e7` | `#27272a` | Hairlines between things |
| `input` | `#86868d` | `#71717a` | Borders of text fields, selects, checkboxes (see 3:1 note) |
| `primary` | `#111113` | `#f4f4f5` | Main buttons, selected pills |
| `primary-foreground` | `#ffffff` | `#111113` | Text on `primary` |
| `brand` *(new)* | `#0066cc` | `#5aa2ee` | Links, focus ring, active nav marker, selected tab underline |
| `brand-foreground` *(new)* | `#ffffff` | `#111113` | Text on a `brand` fill (dark uses ink: white on the dark blue is 2.7:1) |
| `brand-subtle` *(new)* | `#e6f0fa` | `#1e3350` | Selected row / chip background |
| `brand-strong` *(new)* | `#004a94` | `#b8d6f5` | Text on `brand-subtle` |
| `destructive` | `#b91c1c` | `#f87171` | Delete, errors |
| `destructive-foreground` *(new)* | `#ffffff` | `#111113` | Text on a `destructive` fill |
| `destructive-subtle` *(new)* | `#fef2f2` | `#2a1616` | Error banners |
| `warning` *(new)* | `#92400e` | `#fbbf24` | Warnings, conflicts |
| `warning-subtle` *(new)* | `#fffbeb` | `#2a2110` | Warning banners |
| `success` *(new)* | `#166534` | `#4ade80` | Saved, published |
| `success-subtle` *(new)* | `#f0fdf4` | `#12251a` | Success banners |
| `ring` | = `brand` | = `brand` | Focus outlines |
| `accent` | `#f4f4f5` | `#1f1f23` | **shadcn's hover wash only** (menus, list rows). It is no longer blue; see §9. |

Contrast, checked 2026-09-29: ink on white 18.9:1; `muted-foreground` on white
6.5:1 and on `muted` 6.0:1; `brand` on white 5.6:1; `brand-strong` on
`brand-subtle` 7.6:1; `destructive` on white 6.5:1; `warning` on
`warning-subtle` 6.8:1; `success` on `success-subtle` 6.8:1. Dark:
`muted-foreground` on `card` 6.9:1; `brand` on `card` 6.6:1.

**The 3:1 rule for controls.** A text field's border is what shows it is a
field, so it must reach 3:1 against its background: `input` is `#86868d`
(3.6:1 on white) and `#71717a` in dark (3.7:1 on card). The pale `border`
token is only for dividers between content, never the edge of a control.

**Status is never colour alone.** Every error, warning or success carries a
word or an icon as well.

**Left as they are:** the `--viz-*` chart ramps (validated, see the comment in
`globals.css`), session template colours staff choose, and `.org-theme`.

## 4. Type

One family, Geist, at a small set of sizes. Tight tracking on headings, normal
on body text. No uppercase eyebrow labels, no letter-spaced small caps.

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Page title (dashboard) | 28 / 32 px | 600 | -0.03em |
| Section heading | 18 / 24 px | 600 | -0.01em |
| Card title | 15 / 20 px | 600 | normal |
| Body | 14 / 20 px | 400 | normal |
| Secondary / caption | 13 / 18 px, `muted-foreground` | 400 | normal |
| Small label | 12 / 16 px, `muted-foreground` | 500 | normal |
| Numbers in stats | 26 / 30 px, `tabular-nums` | 600 | -0.03em |

Each role is one class, carrying its size, line height, weight and tracking:
`text-title`, `text-heading`, `text-card-title`, `text-body`, `text-caption`,
`text-label`, `text-stat` (add `tabular-nums` to the last). They are defined in
`globals.css` and registered with tailwind-merge in `src/lib/utils/cn.ts`.

Marketing sizes (hero 72 px, section 48 px) live only on the public page.

## 5. Shape, space and depth

- **Spacing:** a 4 px grid. Page gutters 24 px (mobile 16 px). Gaps inside a
  card 12–16 px, between cards 16–24 px, between page sections 40–48 px.
- **Radius:** buttons and chips `rounded-full`; inputs and selects 10 px;
  cards 16 px; large grey panels 24 px (marketing uses 32–36 px); dialogs 20 px.
  By role, as classes: `rounded-control` (10 px), `rounded-banner` (12 px),
  `rounded-card` (16 px), `rounded-dialog` (20 px), `rounded-panel` (24 px).
  These are separate from Tailwind's `rounded-lg/xl/…` scale on purpose: the
  landing page is drawn with that scale, so `--radius` stays where it was.
- **Borders:** 1 px hairlines in `border`. Separate things with a hairline or
  a grey panel, not with a shadow.
- **Shadows:** only `0 1px 2px rgb(17 17 19 / 0.05)` (`shadow-card`) on floating white cards,
  and the default on menus and dialogs. **Never** coloured, blurred or glowing
  shadows, `blur-3xl` blobs, or gradients on fills.
- **Motion:** 150–200 ms colour/opacity transitions. No bounces, pulses or
  parallax.

## 6. Components

Built on the shadcn primitives in `src/components/ui/`. Restyle them there;
don't re-create them by hand in pages.

| Need | Use |
|---|---|
| A button, or a link that looks like one | `Button` (`asChild` around a `Link`) |
| A text field | `Input`; `Textarea` for several lines |
| A native `<select>` | `NativeSelect` (still a real `<select>`, same props) |
| A select whose options are more than text | `Select` |
| A field's label, help and error | `Label`, `FieldHelp`, `FieldError` (`ui/field.tsx`) |
| A card | `Card`, `CardHeader`, `CardTitle`, … |
| A message across a page or form | `Banner` (`info`, `success`, `warning`, `error`, `neutral`) |
| A list with nothing in it | `EmptyState` |
| A status or a count in a chip | `Badge` (`default`, `brand`, `success`, `warning`, `destructive`, `outline`, `solid`) |
| A page's title row | `PageHeader` (`ui/info-tip.tsx`) |

**Button** (`ui/button.tsx`), all `rounded-full`, 14 px, weight 600:

| Variant | Look | Use |
|---|---|---|
| `default` | ink fill, white text | The one main action on a screen |
| `outline` | white, `input`-colour 1 px border, ink text | Secondary actions |
| `ghost` | no border, ink text, `muted` on hover | Toolbar and row actions |
| `destructive` | `destructive` fill, white text | Confirming a delete |
| `link` | `brand` text, underline on hover | Inline actions |

Sizes: `sm` 32 px, `default` 40 px, `lg` 48 px. Icon-only buttons are round
and always have an `aria-label`. One `default` button per view; everything
else is `outline` or `ghost`.

**Inputs, selects, textareas:** 40 px tall, 10 px radius, `input` border,
white (`card` in dark) fill, focus shows a 2 px `ring`. Labels sit above the
field in 13 px weight 500 ink, help text below in 13 px `muted-foreground`,
errors below in 13 px `destructive` with an icon.

**Card:** `card` fill, 1 px `border`, 16 px radius, 20–24 px padding, the one
soft shadow. Title 15 px/600. No coloured left borders, no icon in a tinted
square at the top.

**Grey panel:** `muted` fill, no border, 24 px radius. Use it to group a set
of cards, or behind a picture of the product.

**Tabs:** pill segmented control (`muted` track, the active tab a `raised` pill
with the soft shadow), like the landing page's space tabs and Monthly/Yearly
switch. For page-level tabs with many entries, a text row with a 2 px `brand`
underline on the active tab.

**Badges / chips:** `rounded-full`, 12 px weight 500, `muted` fill with ink
text by default; `brand-subtle`/`brand-strong` for "selected" or "live"; the
status tokens for status, always with a word.

**Tables and lists:** rows separated by hairlines, 12–14 px vertical padding,
header row in 12 px weight 500 `muted-foreground` on `muted`. Hover `muted`.

**Banners (info, warning, error, success):** the `*-subtle` fill, text in the
matching strong colour, an icon on the left, 12 px radius. No border.

**Empty states:** one line of ink text saying what goes here, one line of
`muted-foreground` saying how to add it, and one `outline` button. No
illustrations, no emoji.

**Dialogs and sheets:** `card` fill, 20 px radius, 24 px padding, title 18 px/600,
actions bottom-right: `outline` Cancel, then the `default` (or `destructive`) action.

## 7. The app frame

**Sidebar:** 248 px, `background` fill (dark: `card`), 1 px `border` on the
right. The "Dropin" wordmark at the top in 18 px/700 ink; no icon logo. Nav
items 14 px weight 500 ink, 36 px tall, 10 px radius; hover `muted`; the
current page `muted` fill, weight 600, and a 2 px `brand` bar on the left
edge. Section labels in 12 px weight 500 `muted-foreground`, sentence case.
Icons 16 px stroke, `muted-foreground` (ink when active). The profile block
sits at the bottom above a hairline.

**Top bar:** 56 px, `background`, hairline bottom border, breadcrumb on the
left in 13 px `muted-foreground` with the current page in ink.

**Page:** max content width 1200 px, a page title (28 px) with an optional one-
line description under it, and the page's main action as a `default` button on
the right of the title row.

## 8. Things we don't do

These are what made the old design read as generic. Remove them when you find
them.

- Gradient fills, glowing or coloured shadows, blurred background blobs
- Uppercase, letter-spaced eyebrow labels over every heading
- An icon inside a tinted rounded square as the start of every card
- Cards with a coloured left border
- Fake browser chrome (red/yellow/green dots)
- Emoji in the interface
- Blue filled buttons everywhere (one ink button per view instead)
- `dark:` overrides next to raw palette classes: a token handles dark itself

## 9. Moving existing code onto the tokens

Measured on 2026-09-29: about 1,050 raw palette classes in 103 files outside
the marketing folder, plus about 90 hex literals. Replace them with this table.

| Found | Replace with |
|---|---|
| a hand-built `<button>`/`<Link>` with `bg-blue-600 … text-white` | `<Button>` (`default`), or `<Button asChild>` around a `Link` |
| `text-blue-600/700`, `hover:text-blue-*` on links | `text-brand` |
| `bg-blue-50`, `bg-blue-100` for a selected state | `bg-brand-subtle text-brand-strong` |
| `border-blue-300/600` on a selected item | `border-brand` |
| `ring-blue-*`, `focus:ring-blue-*` | `ring-ring` (focus-visible only) |
| `text-red-600/700` | `text-destructive` |
| `bg-red-50`, `border-red-200` | `bg-destructive-subtle` (drop the border) |
| `text-amber-*`, `bg-amber-50` | `text-warning`, `bg-warning-subtle` |
| `text-green-*`, `bg-green-50` | `text-success`, `bg-success-subtle` |
| `text-gray-900/800` | `text-foreground` |
| `text-gray-500/600/400` | `text-muted-foreground` |
| `bg-gray-50/100` | `bg-muted` |
| `border-gray-200/300` | `border-border` (dividers) or `border-input` (controls) |
| any `dark:` twin of the above | delete it |
| `bg-accent` / `text-accent-foreground` used as a **blue** fill (about 20 uses) | `bg-brand text-brand-foreground`, or `bg-brand-subtle text-brand-strong`, case by case, **before** `--accent` becomes grey |
| `bg-sidebar*`, `text-sidebar-foreground/40…` | the plain tokens in §7; the `--sidebar-*` variables can then be pointed at them |

Leave alone: `.org-theme` and the widget's colours, session template colours,
`--viz-*` chart colours, print-only colours in the deck sheet and printable
schedule (they must print), and colours inside marketing sample pictures.

## 10. Checking a screen

A screen is done when:

1. It uses only token classes (`rg "(bg|text|border)-(blue|gray|red|green|amber)-[0-9]" <files>` finds nothing new).
2. It has at most one ink `default` button.
3. Light and dark both read, and every text pair in it is listed in §3 or checked to 4.5:1.
4. Keyboard focus is visible on every control.
5. It has been screenshotted at 1440 px and 390 px, in light and dark, before and after.
