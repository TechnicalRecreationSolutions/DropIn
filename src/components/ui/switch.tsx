"use client"

import * as React from "react"

import { cn } from "@/lib/utils/cn"

interface SwitchProps
  extends Omit<React.ComponentProps<"button">, "onChange" | "value" | "role"> {
  checked: boolean
  onCheckedChange: (next: boolean) => void
}

/**
 * An on/off switch: ink track when on (`primary`), the `input` grey when off,
 * per docs/DESIGN.md §3. A real `<button role="switch">`, so it needs an
 * accessible name — `aria-label` or `aria-labelledby` pointing at the row's
 * own label. Drawn 24px tall; `touch-target` gives it 44px to tap.
 */
function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      data-slot="switch"
      className={cn(
        "touch-target inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-background shadow-card transition-transform duration-150",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

export { Switch }
