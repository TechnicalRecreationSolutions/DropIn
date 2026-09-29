import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils/cn"
import { fieldClass } from "@/components/ui/input"

/**
 * A native `<select>` that looks like the other fields.
 *
 * Most selects in the dashboard are native on purpose: on a phone they open
 * the system picker, and forms read them with `name`/`value` like any input.
 * This keeps that behaviour (it renders a real `<select>` and passes every
 * prop through) and only supplies the look. Use `ui/select.tsx` when the
 * options need more than text.
 *
 * `className` goes on the `<select>`; `wrapperClassName` on the box around it,
 * which is what takes a width.
 */
function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span data-slot="native-select" className={cn("relative block w-full min-w-0", wrapperClassName)}>
      <select className={cn(fieldClass, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
}

export { NativeSelect }
