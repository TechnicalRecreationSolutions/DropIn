"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin } from "lucide-react";
import TreeNavContent, { bottomLinks } from "./TreeNavContent";
import TreeNavNode from "./TreeNavNode";

interface TreeNavProps {
  orgId: string;
  orgName: string;
}

/** Desktop sidebar shell (logo, org name, bottom links) wrapping the shared tree. */
export default function TreeNav({ orgId, orgName }: TreeNavProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col w-72 min-h-screen bg-sidebar text-sidebar-foreground shrink-0 border-r border-sidebar-border">
      <div className="px-4 py-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 text-sidebar-primary font-bold text-lg mb-1">
          <MapPin className="size-4" />
          Dropin
        </Link>
        <p className="text-xs text-sidebar-foreground/50 truncate">{orgName}</p>
      </div>

      <TreeNavContent orgId={orgId} />

      <div className="px-2 py-3 border-t border-sidebar-border space-y-0.5">
        {bottomLinks.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <TreeNavNode
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              depth={0}
              isActive={isActive}
            />
          );
        })}
      </div>
    </aside>
  );
}
