import Link from "next/link";
import { CalendarCog, CalendarPlus, Columns3, Megaphone, Plus, Thermometer, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface QuickAction {
  label: string;
  href: string;
  icon: "notice" | "change" | "reading" | "deck" | "session" | "schedule";
}

const ICONS: Record<QuickAction["icon"], LucideIcon> = {
  notice: Megaphone,
  change: CalendarCog,
  reading: Thermometer,
  deck: Columns3,
  session: CalendarPlus,
  schedule: Plus,
};

/**
 * The few things people do from the Overview. Two shapes of the same list:
 * big 2-up tiles on a phone (they are tapped on a pool deck, so ≥ 72px), and
 * a quiet list in the right rail on a laptop. The page renders one of each and
 * hides the other with a breakpoint, so the order of sections can differ by
 * device without duplicating any logic.
 */
export default function QuickActions({ actions, layout }: { actions: QuickAction[]; layout: "tiles" | "list" }) {
  if (actions.length === 0) return null;

  if (layout === "tiles") {
    return (
      <section aria-labelledby="quick-actions-tiles">
        <h2 id="quick-actions-tiles" className="mb-3 text-heading text-foreground">
          Quick actions
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {actions.slice(0, 4).map((a, i) => {
            const Icon = ICONS[a.icon];
            return (
              <Link
                key={a.href + a.label}
                href={a.href}
                className={cn(
                  "flex min-h-[72px] flex-col items-start justify-center gap-1.5 rounded-card border px-3.5 py-3 text-body font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  i === 0
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/85"
                    : "border-input bg-card text-foreground hover:bg-muted"
                )}
              >
                <Icon aria-hidden className="size-5" />
                {a.label}
              </Link>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="quick-actions-list" className="rounded-card border border-border bg-card shadow-card">
      <h2 id="quick-actions-list" className="px-4 pt-4 pb-2 text-card-title text-foreground">
        Quick actions
      </h2>
      <ul className="px-2 pb-2">
        {actions.map((a) => {
          const Icon = ICONS[a.icon];
          return (
            <li key={a.href + a.label} className="border-t border-border first:border-t-0">
              <Link
                href={a.href}
                className="flex h-11 items-center gap-2.5 rounded-control px-3 text-body font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {a.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
