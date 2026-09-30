import { cn } from "@/lib/utils/cn";

/**
 * "Now" on a session that's running, as on the landing page's widget: a soft
 * tint of the centre's colour, sentence case. Quiet on purpose, because the
 * session name is what the reader came for.
 */
export default function NowPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold leading-4",
        className
      )}
      style={{
        backgroundColor: "color-mix(in srgb, var(--org-primary, #0066cc) 14%, white)",
        color: "var(--org-text-on-tint, #0b3d73)",
      }}
    >
      Now
    </span>
  );
}
