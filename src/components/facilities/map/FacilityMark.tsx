import { cn } from "@/lib/utils/cn";
import OrgImage from "@/components/media/OrgImage";

interface FacilityMarkProps {
  name: string;
  photoUrl: string | null;
  selected?: boolean;
  /** No coordinates: a dashed, muted ring instead of a solid mark. */
  unplaced?: boolean;
  className?: string;
}

/**
 * The 28 px round mark beside a facility's name: its photo or logo cropped
 * round, else its initial on ink (on `brand` when selected).
 */
export default function FacilityMark({ name, photoUrl, selected, unplaced, className }: FacilityMarkProps) {
  if (unplaced) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-input text-xs font-semibold text-muted-foreground",
          className
        )}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-semibold",
        selected ? "bg-brand text-brand-foreground ring-2 ring-brand" : "bg-primary text-primary-foreground",
        className
      )}
    >
      {photoUrl ? (
        <OrgImage src={photoUrl} alt="" sizes="28px" className="object-cover" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
