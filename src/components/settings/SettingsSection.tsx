import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils/cn";

/**
 * The heading at the top of each settings page, and the card its fields sit in.
 *
 * Extracted because nine pages hand-rolling the same `<h2>` + card produced
 * nine slightly different paddings the last time this app grew a section, and
 * because the settings rail already names the page — the heading here exists
 * to confirm where you landed and to hold the (i), not to repeat the rail.
 *
 * The page's explanation goes behind the (i) rather than under the title, the
 * convention established in `ui/info-tip.tsx` and applied across the dashboard
 * in the 2026-09-18 copy pass: a subtitle under every heading is read once and
 * then costs vertical space forever, which on a phone is the whole fold.
 */
export function SettingsHeading({
  title,
  info,
  actions,
}: {
  title: string;
  info?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {info && <InfoTip label="About this page">{info}</InfoTip>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * A titled card. `tone="destructive"` is used only by the Danger zone, where
 * the border is doing real work — it is the one visual cue separating "change
 * a phone number" from "delete everything".
 */
export function SettingsCard({
  title,
  info,
  description,
  tone = "default",
  children,
  className,
}: {
  title?: string;
  info?: React.ReactNode;
  /** A line that must stay visible — a consequence, not an explanation. */
  description?: React.ReactNode;
  tone?: "default" | "destructive";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5 sm:p-6",
        tone === "destructive" ? "border-destructive/40" : "border-border",
        className
      )}
    >
      {title && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5">
            <h3
              className={cn(
                "text-base font-semibold",
                tone === "destructive" ? "text-destructive" : "text-foreground"
              )}
            >
              {title}
            </h3>
            {info && <InfoTip>{info}</InfoTip>}
          </div>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A label/value row, for the facts a settings page reports rather than edits —
 * the public URL, the plan, the date an organization was created.
 *
 * `<dl>` semantics: these are definitions, and a screen reader reading "Public
 * URL, dropin.app/facility/crystal-pool" is the whole point. Two columns from
 * `sm` up, stacked below it.
 */
export function SettingsFacts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

export function SettingsFact({
  label,
  info,
  children,
}: {
  label: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </div>
      <dd className="mt-1 text-sm text-foreground break-words">{children}</dd>
    </div>
  );
}

/**
 * The banner a read-only viewer gets instead of a 403.
 *
 * Members see settings filled in but disabled rather than being bounced —
 * knowing what your organization has published is reasonable, and a disabled
 * field says "you can't change this" more clearly than a missing page. The API
 * enforces the same rule independently, which is what makes showing it safe.
 */
export function ReadOnlyNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
      {children}
    </p>
  );
}
