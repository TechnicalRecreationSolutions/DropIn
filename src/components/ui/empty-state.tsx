import * as React from "react"

import { cn } from "@/lib/utils/cn"

/**
 * What a list shows when it has nothing in it (docs/DESIGN.md §6): one line
 * saying what goes here, one line saying how to add it, and one `outline`
 * button. No illustration, no emoji, no icon in a tinted square.
 */
function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** One `<Button variant="outline">`, or a link wearing one. */
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center rounded-card border border-dashed border-border px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      <p className="text-body font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-caption text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export { EmptyState }
