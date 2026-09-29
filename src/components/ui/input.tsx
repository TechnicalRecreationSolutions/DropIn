import * as React from "react"

import { cn } from "@/lib/utils/cn"

/**
 * The look of every text field, select and textarea (docs/DESIGN.md §6):
 * 40 px tall, 10 px corners, the `input` border (3:1 against the page), and a
 * 2 px ring on keyboard focus. Exported so a field that cannot be an
 * `<Input>` wears the same thing; see native-select.tsx and textarea.tsx
 * before reaching for it directly.
 *
 * 16 px text below `md`, because iOS zooms the page on focus for anything
 * smaller.
 */
const fieldClass =
  "h-10 w-full min-w-0 rounded-control border border-input bg-card px-3 py-2 text-base text-foreground transition-colors duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive md:text-sm"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldClass }
