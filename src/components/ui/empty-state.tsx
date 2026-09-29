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
  titleAs: Title = "p",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  /** The element the title renders as. A heading when the empty state is the
   *  only thing on the page or section and should appear in the outline. */
  titleAs?: "p" | "h1" | "h2" | "h3"
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
      <Title className="text-body font-medium text-foreground">{title}</Title>
      {description && <p className="mt-1 max-w-md text-caption text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export { EmptyState }
