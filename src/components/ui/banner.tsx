import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils/cn"

// docs/DESIGN.md §6: the subtle fill, text in the matching strong colour, an
// icon on the left, 12 px corners, no border. The icon is part of the
// component because status is never colour alone.
const bannerVariants = cva("flex items-start gap-3 rounded-banner px-4 py-3 text-body", {
  variants: {
    variant: {
      info: "bg-brand-subtle text-brand-strong",
      success: "bg-success-subtle text-success",
      warning: "bg-warning-subtle text-warning",
      error: "bg-destructive-subtle text-destructive",
      neutral: "bg-muted text-foreground",
    },
  },
  defaultVariants: { variant: "info" },
})

const ICONS = {
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
  neutral: InfoIcon,
} as const

/**
 * A message across the top of a page or a form.
 *
 * `error` and `warning` announce themselves to a screen reader (`role="alert"`);
 * the others are `role="status"`. Pass `role` to override either.
 */
function Banner({
  className,
  variant = "info",
  title,
  actions,
  icon,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof bannerVariants> & {
    /** A bold first line. Optional: a one-sentence banner needs no title. */
    title?: React.ReactNode
    /** Buttons or links, right-aligned (under the text on a phone). */
    actions?: React.ReactNode
    /** Replaces the variant's icon; pass `null` for none. */
    icon?: React.ReactNode
  }) {
  const v = variant ?? "info"
  const Icon = ICONS[v]
  return (
    <div
      data-slot="banner"
      data-variant={v}
      role={v === "error" || v === "warning" ? "alert" : "status"}
      className={cn(bannerVariants({ variant: v }), className)}
      {...props}
    >
      {icon === undefined ? <Icon aria-hidden className="mt-0.5 size-4 shrink-0" /> : icon}
      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export { Banner, bannerVariants }
