// First 5 slots of the validated categorical palette (references/palette.md),
// in fixed order — never reassigned per render, so a template's color is
// stable across visits even as counts change.
const TEMPLATE_COLORS: Record<string, string> = {
  grid: "#2a78d6",
  list: "#eb6834",
  map: "#1baf7a",
  floorplan: "#eda100",
  board: "#e87ba4",
};

const TEMPLATE_LABELS: Record<string, string> = {
  grid: "Grid",
  list: "List",
  map: "Map",
  floorplan: "Floorplan",
  board: "Board",
};

/** Which template (grid/list/map/floorplan/board) visitors actually looked at. */
export function TemplateBreakdown({ data }: { data: { template: string; count: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground/70 py-6 text-center">No view data yet.</p>;
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const pct = total > 0 ? (d.count / total) * 100 : 0;
        const color = TEMPLATE_COLORS[d.template] ?? "#898781";
        return (
          <div key={d.template} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-muted-foreground">{TEMPLATE_LABELS[d.template] ?? d.template}</span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="w-10 shrink-0 text-right font-medium text-foreground tabular-nums">{d.count}</span>
          </div>
        );
      })}
    </div>
  );
}
