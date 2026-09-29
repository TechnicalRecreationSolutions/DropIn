import * as React from "react"
import { CircleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils/cn"

/*
 * The text around a field (docs/DESIGN.md §6): the label above it, help under
 * it, and an error under it. An error is never colour alone, so FieldError
 * brings its own icon.
 */

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("mb-1.5 block text-caption font-medium text-foreground", className)}
      {...props}
    />
  )
}

function FieldHelp({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-help" className={cn("mt-1.5 text-caption text-muted-foreground", className)} {...props} />
}

function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  if (!children) return null
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("mt-1.5 flex items-start gap-1.5 text-caption text-destructive", className)}
      {...props}
    >
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export { Label, FieldHelp, FieldError }
