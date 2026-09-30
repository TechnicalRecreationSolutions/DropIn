"use client";

import dynamic from "next/dynamic";

/**
 * Client-only mount for the hero's live widget.
 *
 * Not prerendered: the sample is "this week" and the views mark what has
 * already happened, both read from the visitor's clock. Rendered on the server
 * too, the week and the greyed-out sessions would come from the server's
 * clock and zone and disagree with the browser's at hydration.
 *
 * The placeholder is the widget's exact footprint (card + tour controls), so
 * the page does not move when the widget arrives.
 */

/**
 * The card's height follows the screen: scrolled to, the whole widget and its
 * tour controls fit in one screenful below the nav (72 px) at any size, so
 * nobody has to scroll the page to see the bottom of a view. Clamped so a
 * short landscape phone still gets a usable schedule and a tall monitor does
 * not get a card taller than a week of sessions needs. svh, not vh, so a
 * phone's collapsing address bar does not resize it mid-tour.
 */
const CARD_HEIGHT =
  "h-[clamp(540px,calc(100svh-182px),760px)] sm:h-[clamp(560px,calc(100svh-216px),980px)]";
const LiveWidgetDemo = dynamic<{ heightClass: string }>(
  () => import("./LiveWidgetDemo"),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden>
        <div
          className={`${CARD_HEIGHT} rounded-[20px] border border-[#e4e4e7] bg-white`}
        />
        <div className="mt-4 h-8" />
      </div>
    ),
  },
);

export default function HeroWidget() {
  return <LiveWidgetDemo heightClass={CARD_HEIGHT} />;
}
