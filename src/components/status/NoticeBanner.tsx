import {
  AlertOctagon,
  AlertTriangle,
  CloudSun,
  Droplets,
  Info,
  Plug,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_LABEL, SEVERITY_LABEL, describeNoticeWindow } from "@/lib/status/notices";
import type { PublicNotice } from "@/lib/status/public-notices";
import type { NoticeCategory, NoticeSeverity } from "@/types/app.types";

/**
 * What is true at this facility right now, above the schedule.
 *
 * Rendered on the public facility page and inside the embedded widget. Both
 * are server-rendered: a closure has to be in the HTML, not fetched after
 * hydration, because the whole point is that it reaches someone who is about
 * to get in a car.
 *
 * ## The two axes are drawn by different means
 *
 * `severity` drives colour and weight — the "how much should this interrupt
 * you" axis, and colour is the only channel that works before anything is
 * read. `category` drives the icon and the small label: the "what kind of
 * thing is this" axis.
 *
 * **Colour is never the only carrier.** Every notice states its severity in
 * words ("Closed", "Caution", "Notice") beside the icon, because a red border
 * says nothing to a patron who cannot distinguish it from the amber one, and
 * the embed is often placed on a page whose own styling fights ours.
 *
 * ## ⚠️ Why the colours are spelled out instead of using theme tokens
 *
 * This component renders on two surfaces with incompatible theming, and the
 * obvious `text-foreground` / `dark:` approach is silently wrong on one of
 * them. The widget is served in an iframe on somebody else's site, where the
 * `.dark` class the dashboard toggles does not exist — so `dark:` variants
 * never fire there and every neutral token resolves to its LIGHT value, which
 * is dark grey text on the widget's dark background. The widget page carries a
 * long comment about this for exactly the same reason.
 *
 * Hence `variant`: `"tokens"` for the public facility page, which does follow
 * the class, and `"light"`/`"dark"` for the widget, which is told which one it
 * is. Adding a `dark:` utility to this file re-introduces the bug on the
 * surface least likely to be checked.
 */

const CATEGORY_ICON: Record<NoticeCategory, LucideIcon> = {
  water_quality: Droplets,
  mechanical: Wrench,
  staffing: Users,
  weather: CloudSun,
  maintenance: Wrench,
  capacity: Users,
  power: Plug,
  other: Info,
};

type Variant = "tokens" | "light" | "dark";

interface Palette {
  /** Border + fill for the box, per severity. */
  box: Record<NoticeSeverity, string>;
  /** Icon and severity-word colour, per severity. */
  accent: Record<NoticeSeverity, string>;
  /** The headline. */
  strong: string;
  /** Body text and the metadata line. */
  muted: string;
}

const PALETTES: Record<Variant, Palette> = {
  // The public facility page: semantic tokens, and `dark:` works because the
  // class is on <html>.
  tokens: {
    box: {
      closure: "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10",
      caution: "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
      info: "border-border bg-muted/50",
    },
    accent: {
      closure: "text-red-700 dark:text-red-300",
      caution: "text-amber-700 dark:text-amber-300",
      info: "text-muted-foreground",
    },
    strong: "text-foreground",
    muted: "text-muted-foreground",
  },
  // The widget, light. Same hues, resolved rather than tokenised.
  light: {
    box: {
      closure: "border-red-300 bg-red-50",
      caution: "border-amber-300 bg-amber-50",
      info: "border-gray-200 bg-gray-50",
    },
    accent: {
      closure: "text-red-700",
      caution: "text-amber-700",
      info: "text-gray-500",
    },
    strong: "text-gray-900",
    muted: "text-gray-600",
  },
  // The widget, dark. Fills are translucent so they sit on the host's
  // background rather than punching a grey rectangle into it.
  dark: {
    box: {
      closure: "border-red-500/40 bg-red-500/10",
      caution: "border-amber-500/40 bg-amber-500/10",
      info: "border-gray-700 bg-gray-800/60",
    },
    accent: {
      closure: "text-red-300",
      caution: "text-amber-300",
      info: "text-gray-400",
    },
    strong: "text-white",
    muted: "text-gray-300",
  },
};

export interface NoticeBannerProps {
  notices: readonly PublicNotice[];
  /** See the note above — the widget must pass `light` or `dark` explicitly. */
  variant?: Variant;
  /** Tightens the padding for the 320px-wide embed. */
  compact?: boolean;
}

export default function NoticeBanner({
  notices,
  variant = "tokens",
  compact = false,
}: NoticeBannerProps) {
  // No all-clear line here, unlike the dashboard's OverviewAlerts. Staff open
  // the Overview to be told there is nothing to do; a patron opening a
  // schedule has not asked, and "Everything is normal" above every schedule
  // every day is the banner people stop seeing before the day it matters.
  if (notices.length === 0) return null;

  const palette = PALETTES[variant];

  return (
    <div
      className={compact ? "mb-3 space-y-2" : "mb-6 space-y-3"}
      role="region"
      aria-label="Facility status"
    >
      {notices.map((notice) => {
        // The severity icon wins for a closure — an octagon reads as "stop" at
        // a glance, and the category is the subtitle's job. Lower severities
        // take the category icon, which carries more information than a third
        // variation on a triangle.
        const Icon =
          notice.severity === "closure"
            ? AlertOctagon
            : notice.severity === "caution" && notice.category === "other"
              ? AlertTriangle
              : CATEGORY_ICON[notice.category];

        return (
          <div
            key={notice.id}
            className={`flex items-start gap-3 rounded-lg border ${palette.box[notice.severity]} ${
              compact ? "px-3 py-2.5" : "px-4 py-3.5"
            }`}
          >
            <Icon
              className={`mt-0.5 size-5 shrink-0 ${palette.accent[notice.severity]}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${palette.accent[notice.severity]}`}
                >
                  {SEVERITY_LABEL[notice.severity]}
                </span>
                <span className={`font-semibold ${palette.strong}`}>{notice.headline}</span>
              </p>

              {notice.body && <p className={`mt-1 text-sm ${palette.muted}`}>{notice.body}</p>}

              <p
                className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${palette.muted}`}
              >
                {notice.space_name && (
                  <>
                    <span className="font-medium">{notice.space_name}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>{CATEGORY_LABEL[notice.category]}</span>
                <span aria-hidden>·</span>
                {/* Absolute times, never a duration — see describeNoticeWindow.
                    Absolute also survives being rendered into a cached entry,
                    which "2 hours ago" would not. */}
                <span>{describeNoticeWindow(notice)}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
