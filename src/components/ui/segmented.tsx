"use client"

import * as React from "react"

import { cn } from "@/lib/utils/cn"

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (next: T) => void
  options: SegmentedOption<T>[]
  /** Names the group for screen readers ("Preview size", "Theme"). */
  label: string
  /** Show only the icons (labels stay as the accessible names) — for tight toolbars. */
  iconOnly?: boolean
  className?: string
  disabled?: boolean
}

/**
 * The pill segmented control from docs/DESIGN.md §6: a `muted` track, the
 * chosen option a `raised` pill with the one soft shadow. A radio group, so
 * arrow keys move the choice the way they do in a native one. Segments are
 * 36px tall inside a 44px track; `touch-target` keeps each one 44px to tap.
 */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  iconOnly,
  className,
  disabled,
}: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex h-11 shrink-0 gap-1 rounded-full bg-muted p-1", className)}
    >
      {options.map(({ value: v, label: optionLabel, icon: Icon }, index) => {
        const active = v === value
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? optionLabel : undefined}
            title={iconOnly ? optionLabel : undefined}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(v)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "touch-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              active ? "bg-raised text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon className="size-4" />}
            {!iconOnly && optionLabel}
          </button>
        )
      })}
    </div>
  )
}

export { Segmented }
export type { SegmentedOption }
