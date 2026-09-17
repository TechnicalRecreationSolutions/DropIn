import type { CSSProperties } from "react";
import { relativeLuminance } from "@/lib/utils/color";
import { cn } from "@/lib/utils/cn";
import type { SessionTag } from "@/types/schedule.types";

/**
 * How many tags a session *card* shows. The rest are reachable in the detail
 * modal, which renders the full set.
 *
 * Two, because the card is the constrained surface: a board-view box is a table
 * cell a few characters wide, and a card that wraps to three lines of chips
 * stops being a schedule. Staff order the tags on the template, so the two that
 * survive here are the two they chose — see session_template_tags.display_order.
 */
export const TAGS_ON_CARD = 2;

/**
 * Text colour for a label sitting on `background`.
 *
 * Tag colours are staff-picked from a full picker, so both ends of the range
 * arrive in practice — a dark navy and a pale yellow both need to be legible
 * with the same markup. Threshold is the one `isLightColor` uses, kept in the
 * same place for the same reason.
 */
function labelColorOn(background: string): string {
  return relativeLuminance(background) > 0.4 ? "#1f2937" : "#ffffff";
}

/** Chip styling shared by the card and modal renderings. */
function chipStyle(tag: SessionTag): CSSProperties {
  return {
    backgroundColor: tag.color,
    color: labelColorOn(tag.color),
    // Browsers drop background fills when printing unless asked not to, and
    // this feature exists to replace the asterisks and colour keys on a paper
    // schedule — a chip that prints as white-on-white replaces them with
    // nothing. On a monochrome printer the fill still renders as grey, which is
    // why the label colour is chosen by luminance above rather than fixed:
    // whatever grey it becomes, the text was already the readable one.
    printColorAdjust: "exact",
    WebkitPrintColorAdjust: "exact",
  } as CSSProperties;
}

interface SessionTagsProps {
  tags: SessionTag[];
  /**
   * `card` truncates to TAGS_ON_CARD and adds a "+N" affordance; `full` renders
   * every tag and is what the detail modal uses.
   */
  variant?: "card" | "full";
  /** Tighter type for the board view, whose boxes are the smallest on screen. */
  size?: "sm" | "xs";
  className?: string;
}

/**
 * The tag chips on a session, in every schedule view and the detail modal.
 *
 * Renders nothing at all for an untagged session — including no wrapper — so
 * dropping it into a card costs nothing until a facility defines a vocabulary.
 * That is what keeps every existing schedule rendering exactly as it did before
 * migration 050.
 *
 * A `reserved` session seen by an outsider arrives here with `tags: []`, from
 * both RLS and `applyDisclosure()`. Nothing in this component needs to know
 * that — same arrangement as `sessionDisplayLabel`, where the audience is
 * decided by the data rather than by the component.
 */
export default function SessionTags({
  tags,
  variant = "card",
  size = "sm",
  className,
}: SessionTagsProps) {
  if (tags.length === 0) return null;

  const shown = variant === "card" ? tags.slice(0, TAGS_ON_CARD) : tags;
  const hidden = tags.length - shown.length;

  const chipClass = cn(
    "inline-flex items-center rounded-full font-semibold leading-none whitespace-nowrap",
    size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5"
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((tag) => (
        <span key={tag.id} className={chipClass} style={chipStyle(tag)}>
          {tag.label}
        </span>
      ))}
      {hidden > 0 && (
        <span
          className={cn(chipClass, "border border-current opacity-70")}
          // Not a tag, so it deliberately carries no tag colour — a "+2" tinted
          // like a vocabulary entry would read as one more tag whose label got
          // cut off.
          title={tags
            .slice(TAGS_ON_CARD)
            .map((t) => t.label)
            .join(", ")}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
