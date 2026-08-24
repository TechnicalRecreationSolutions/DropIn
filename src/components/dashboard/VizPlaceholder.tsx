import type { LucideIcon } from "lucide-react";

interface VizPlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * A 2x2 grid slot for a future chart. None of these are backed by real
 * aggregation queries yet — no charting library is installed in the app,
 * and building the real thing needs both a library decision and per-chart
 * data work. See docs/RESUME-layout-rework.md.
 */
export function VizPlaceholder({ icon: Icon, title, description }: VizPlaceholderProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      <div className="h-48 rounded-lg border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Icon className="size-6" />
        <p className="text-xs">{description}</p>
      </div>
    </div>
  );
}
