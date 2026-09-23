import { Check, Minus } from "lucide-react";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, rolesWith } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";

const ROLES: OrgRole[] = ["owner", "manager", "coordinator", "aux"];

/**
 * The rows, and the wording each one is understood by.
 *
 * Every row names a REAL permission, and the ticks are read out of
 * `ALLOWED` via `rolesWith()` rather than typed here — so this table cannot
 * disagree with what the app actually enforces. The only thing written by hand
 * is the English, which is the part a table is for.
 *
 * Not every permission gets a row. Twenty-nine ticked boxes is a specification,
 * not an answer to "who should I invite"; these are the dozen distinctions that
 * change the decision.
 */
const ROWS: { permission: Permission; label: string; note?: string }[] = [
  { permission: "schedule:view-internal", label: "See every schedule, including drafts" },
  { permission: "reading:write", label: "Record head counts and temperatures" },
  {
    permission: "session:write",
    label: "Add and change sessions",
    note: "A Coordinator only inside the departments assigned to them.",
  },
  {
    permission: "space:write",
    label: "Add and change spaces",
    note: "A Coordinator only inside their own departments.",
  },
  { permission: "week-review:write", label: "Sign off on a week" },
  { permission: "operations:view", label: "See utilization and attendance" },
  { permission: "analytics:view", label: "See visitor analytics" },
  { permission: "import:use", label: "Import a spreadsheet" },
  { permission: "facility:create", label: "Add and edit facilities" },
  { permission: "widget:edit", label: "Change the public widget and branding" },
  {
    permission: "staff:invite-aux",
    label: "Invite a Staff account",
    note: "A Coordinator only for the facilities assigned to them.",
  },
  { permission: "staff:manage", label: "Invite and remove anyone else" },
  { permission: "org:edit-settings", label: "Change organization settings" },
  { permission: "billing:manage", label: "Manage billing" },
  { permission: "org:transfer-ownership", label: "Transfer ownership or close the organization" },
];

/**
 * What each role may do, rendered from the permission model itself.
 *
 * Read-only on purpose. Roles are fixed (migration 055) and not configurable
 * per organization — a custom-role builder is a product, not a settings page,
 * and the four that exist were chosen to match how a recreation centre is
 * actually staffed. What this table is for is the question a manager asks
 * before sending an invitation, which until now could only be answered by
 * reading `roles.ts`.
 *
 * Two renderings again: a real `<table>` from `sm` up, and a stacked list of
 * per-role cards below it. A 5-column table at 390px is a horizontal scroll
 * with the row labels scrolled off, which is the one layout that makes a
 * comparison table useless.
 */
export default function RoleMatrix() {
  return (
    <>
      {/* ── Phone: one block per role ─────────────────────────────────────── */}
      <div className="space-y-5 sm:hidden">
        {ROLES.map((role) => (
          <div key={role}>
            <p className="text-sm font-semibold text-foreground">{ROLE_LABELS[role]}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
            <ul className="mt-2 space-y-1">
              {ROWS.filter((row) => rolesWith(row.permission).includes(role)).map((row) => (
                <li key={row.permission} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
                  <span>
                    {row.label}
                    {row.note && role === "coordinator" && (
                      <span className="block text-xs text-muted-foreground">{row.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ── Tablet and up: the grid ───────────────────────────────────────── */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            What each role is allowed to do. A tick means allowed; a dash means not allowed.
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 text-left font-medium text-muted-foreground">
                Can do
              </th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className="px-2 py-2 text-center font-medium text-foreground">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const allowed = rolesWith(row.permission);
              return (
                <tr key={row.permission} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal text-foreground">
                    {row.label}
                    {row.note && (
                      <span className="block text-xs text-muted-foreground">{row.note}</span>
                    )}
                  </th>
                  {ROLES.map((role) => (
                    <td key={role} className="px-2 py-2.5 text-center">
                      {allowed.includes(role) ? (
                        <>
                          <Check
                            className="mx-auto size-4 text-green-600 dark:text-green-400"
                            aria-hidden
                          />
                          <span className="sr-only">Yes</span>
                        </>
                      ) : (
                        <>
                          <Minus className="mx-auto size-4 text-muted-foreground/40" aria-hidden />
                          <span className="sr-only">No</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
