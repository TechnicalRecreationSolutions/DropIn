import type { NoticeSeverity } from "@/types/app.types";

/**
 * The one colour cue for severity on staff screens. Always drawn next to the
 * severity's word (or a headline that carries it), never on its own.
 */
const TONE: Record<NoticeSeverity, string> = {
  closure: "bg-destructive",
  caution: "bg-warning",
  info: "bg-muted-foreground",
};

export function SeverityDot({ severity }: { severity: NoticeSeverity }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${TONE[severity]}`} aria-hidden />;
}
