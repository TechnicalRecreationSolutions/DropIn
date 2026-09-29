"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { InfoIcon } from "lucide-react"

import { cn } from "@/lib/utils/cn"

interface InfoTipProps {
  children: React.ReactNode
  /** Screen-reader name for the icon button. */
  label?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * An (i) icon that shows explanatory text on click or tap.
 *
 * This holds the "what is this page for" text that used to sit as a subtitle
 * under every heading. It's a popover and not a hover tooltip because this app
 * is mobile-first, and a hover-only tooltip can't be opened on a phone.
 */
export function InfoTip({ children, label = "More info", side = "bottom", align = "start", className }: InfoTipProps) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          // Invisible padding gives the icon a touch target bigger than itself.
          "size-5 -m-0.5 p-0.5",
          className
        )}
      >
        <InfoIcon className="size-4" aria-hidden />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={16}
          className="z-50 max-w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover px-3.5 py-2.5 text-sm font-normal leading-snug tracking-normal text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

interface PageHeaderProps {
  title: React.ReactNode
  /** Page explanation, shown behind the (i) icon instead of as a subtitle. */
  info?: React.ReactNode
  /** A short line kept visible under the title, for context (e.g. which schedule) rather than explanation. */
  subtitle?: React.ReactNode
  /** Right-aligned actions such as an "Add" button. */
  actions?: React.ReactNode
  className?: string
}

/**
 * The title row every dashboard page opens with (docs/DESIGN.md §7): the page
 * title, an optional one-line description, and the page's main action on the
 * right. On a phone the actions drop under the title rather than squeezing it.
 */
export function PageHeader({ title, info, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-title text-foreground">{title}</h1>
          {info && <InfoTip label="About this page">{info}</InfoTip>}
        </div>
        {subtitle && <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

interface LabelWithInfoProps {
  htmlFor?: string
  /** Hint text, shown behind the (i) icon instead of under the field. */
  info: React.ReactNode
  /** Classes for the <label> itself — pass the form's usual label class. */
  className?: string
  children: React.ReactNode
}

/**
 * A form label with an (i) icon beside it. The icon sits outside the <label>
 * so tapping it opens the hint instead of focusing the field.
 */
export function LabelWithInfo({ htmlFor, info, className, children }: LabelWithInfoProps) {
  return (
    <div className="flex items-center gap-1.5 [&>label]:mb-0 mb-1">
      <label htmlFor={htmlFor} className={className}>{children}</label>
      <InfoTip label="Field help">{info}</InfoTip>
    </div>
  )
}
