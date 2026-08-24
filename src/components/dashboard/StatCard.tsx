import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface RealStatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

/** One tile in the Overview's top stat row. */
export function StatCard({ icon: Icon, label, value }: RealStatCardProps) {
  return (
    <Card className="px-5 py-4 gap-2">
      <Icon className="size-6 text-muted-foreground" />
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
    </Card>
  );
}
