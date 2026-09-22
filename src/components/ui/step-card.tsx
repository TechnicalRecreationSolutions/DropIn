import { cn } from "@/lib/utils/cn";
import { InfoTip } from "@/components/ui/info-tip";

interface StepCardProps {
  step: number;
  title: string;
  /** Explanation of the step, shown behind an (i) icon next to the title. */
  description?: React.ReactNode;
  /** Right-aligned status/summary shown in the header row (e.g. "Saved with the widget"). */
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * One numbered step of the widget studio.
 *
 * The page used to be three visually identical cards whose headings were
 * 14px bold text, so there was no first thing to do and no last. Numbering the
 * steps is most of what turns the screen from a settings pile into a task. The
 * explanation sits behind an (i) icon rather than under the title, so the
 * titles carry the page and the explanations are there when someone needs them.
 */
export default function StepCard({ step, title, description, meta, children, className }: StepCardProps) {
  return (
    <section className={cn("bg-card rounded-xl border border-border overflow-hidden", className)}>
      <header className="flex items-start gap-3 p-4 sm:p-5 border-b border-border">
        <span className="shrink-0 inline-flex items-center justify-center size-7 rounded-full bg-blue-600/10 text-blue-700 dark:text-blue-400 text-sm font-semibold">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-h-7">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description && <InfoTip label={`About ${title}`}>{description}</InfoTip>}
          </div>
          {/* On a phone the meta moves under the title instead of being
              dropped. It used to be `hidden sm:block` only, which is backwards
              for a summary: the narrower the screen, the more of the step is
              off-screen and the more a one-line "1 hr 30 min · all spaces ·
              Drop-in" is worth having in the header. */}
          {meta && <div className="mt-1 sm:hidden">{meta}</div>}
        </div>
        {meta && <div className="shrink-0 hidden sm:block">{meta}</div>}
      </header>
      <div className="p-4 sm:p-5 space-y-5">{children}</div>
    </section>
  );
}
