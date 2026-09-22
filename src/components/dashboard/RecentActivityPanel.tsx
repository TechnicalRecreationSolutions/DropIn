import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Clock,
  DoorOpen,
  Layers,
  LayoutTemplate,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ActivityEntry, ActivityTable } from "@/components/activity/types";

/** Only what a one-line summary needs. The full `ActivityEntry` carries the
 *  before/after JSON the revert path uses, and the panel's query deliberately
 *  does not ask for it. */
export type RecentActivityEntry = Pick<
  ActivityEntry,
  "id" | "table_name" | "action" | "entity_label" | "actor_email" | "created_at"
>;

/** Same vocabulary as /dashboard/activity, deliberately — the panel is a
 *  preview of that page, and two different words for one change is the kind of
 *  drift that makes a user distrust both screens. */
const TABLE_ICON: Record<ActivityTable, LucideIcon> = {
  facilities: Building2,
  departments: Layers,
  spaces: DoorOpen,
  schedule_groups: CalendarDays,
  sessions: Clock,
  session_templates: LayoutTemplate,
};

const TABLE_NOUN: Record<ActivityTable, string> = {
  facilities: "facility",
  departments: "department",
  spaces: "space",
  schedule_groups: "schedule",
  sessions: "session",
  session_templates: "template",
};

const ACTION_VERB = {
  insert: "created",
  update: "updated",
  delete: "deleted",
} as const;

interface RecentActivityPanelProps {
  entries: RecentActivityEntry[];
  /** So the log can say "you" instead of reading the viewer's own address back at them. */
  viewerEmail: string | null;
}

/**
 * The last few logged changes, as changes.
 *
 * This replaces a panel that listed the most recently *updated* facilities and
 * schedule groups — which meant the Overview showed the same objects twice, in
 * two different status vocabularies ("Published/Draft" here, "Modified/
 * Unfinished" in the table above), so one schedule could read as two different
 * states on one screen.
 *
 * The fix is not better labels, it is different content: `activity_log`
 * (038_activity_log.sql) records who did what, and "someone deleted Lap Swim an
 * hour ago" is information the table above genuinely does not carry.
 *
 * Rows do not link to the objects they mention. A delete has no object left to
 * open, and a row that is a link for four kinds out of six teaches nothing; the
 * section header goes to the full log, which is also where a change can be
 * reverted.
 */
export default function RecentActivityPanel({ entries, viewerEmail }: RecentActivityPanelProps) {
  if (entries.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Latest changes</h2>
        <Link
          href="/dashboard/activity"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          All activity
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {/* gap-0: Card is a flex column with gap-(--card-spacing); py-0 clears the
          padding but not the gap, which would stack whitespace above each
          divider. */}
      <Card className="divide-y divide-border py-0 gap-0">
        {entries.map((entry) => {
          const TableIcon = TABLE_ICON[entry.table_name] ?? CalendarDays;
          const who =
            entry.actor_email === null
              ? "Someone"
              : viewerEmail !== null && entry.actor_email === viewerEmail
                ? "You"
                : entry.actor_email.split("@")[0];

          return (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <TableIcon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
              {/* Wraps rather than truncates: at 390px a clipped line reads "Someone
                  created the s…", which names neither the change nor the thing. */}
              <p className="min-w-0 flex-1 text-sm text-muted-foreground line-clamp-2">
                <span className="font-medium text-foreground">{who}</span>{" "}
                {ACTION_VERB[entry.action]} the {TABLE_NOUN[entry.table_name] ?? "record"}{" "}
                <span className="font-medium text-foreground">{entry.entity_label ?? "(untitled)"}</span>
              </p>
              <span className="shrink-0 text-xs text-muted-foreground/70">
                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
              </span>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
