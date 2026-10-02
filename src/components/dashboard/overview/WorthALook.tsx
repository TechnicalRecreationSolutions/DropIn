import Link from "next/link";
import { Layers, Mail, TrendingDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface HealthItem {
  id: string;
  icon: "views" | "invites" | "department";
  warn?: boolean;
  title: string;
  detail: string;
  linkLabel: string;
  href: string;
}

const ICONS: Record<HealthItem["icon"], LucideIcon> = {
  views: TrendingDown,
  invites: Mail,
  department: Layers,
};

/**
 * Setup and health, for owners and managers, shown ONLY when something is
 * off. A running total is not health; a drop, a stuck invite or an orphaned
 * space is. Renders nothing at all when there is nothing to say.
 */
export default function WorthALook({
  items,
  headingId = "worth-a-look-heading",
}: {
  items: HealthItem[];
  headingId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="rounded-card border border-border bg-card shadow-card">
      <h2 id={headingId} className="px-4 pt-4 pb-1 text-card-title text-foreground">
        Worth a look
      </h2>
      <ul>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.id} className="flex items-start gap-2.5 border-t border-border px-4 py-3 first:border-t-0">
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", item.warn ? "text-warning" : "text-muted-foreground")} />
              <div className="min-w-0">
                <p className="text-body font-semibold text-foreground">{item.title}</p>
                <p className="text-caption text-muted-foreground">{item.detail}</p>
                <Link href={item.href} className="text-caption font-medium text-brand hover:underline underline-offset-4">
                  {item.linkLabel}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
