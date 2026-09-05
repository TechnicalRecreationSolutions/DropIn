import { cn } from "@/lib/utils/cn";

interface StepCardProps {
  step: number;
  title: string;
  description: string;
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
 * steps and giving each one a plain-language subtitle is most of what turns the
 * screen from a settings pile into a task.
 */
export default function StepCard({ step, title, description, meta, children, className }: StepCardProps) {
  return (
    <section className={cn("bg-card rounded-xl border border-border overflow-hidden", className)}>
      <header className="flex items-start gap-3 p-4 sm:p-5 border-b border-border">
        <span className="shrink-0 mt-0.5 inline-flex items-center justify-center size-7 rounded-full bg-blue-600/10 text-blue-700 dark:text-blue-400 text-sm font-semibold">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        {meta && <div className="shrink-0 hidden sm:block">{meta}</div>}
      </header>
      <div className="p-4 sm:p-5 space-y-5">{children}</div>
    </section>
  );
}
