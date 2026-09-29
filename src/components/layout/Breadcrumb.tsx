import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb trail for nested dashboard pages (e.g. Facilities > Downtown Pool > Aquatics).
 * The last item has no href and renders as the current page.
 */
export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="flex items-center flex-wrap gap-1 text-caption text-muted-foreground mb-4" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />}
            {item.href && !isLast ? (
              <Link href={item.href} className="rounded-sm outline-none hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-foreground font-medium" : ""}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
