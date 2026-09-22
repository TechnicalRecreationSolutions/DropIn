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
          "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring align-middle",
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
          className="z-50 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg bg-popover px-3 py-2 text-sm font-normal leading-snug text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
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

export function PageHeader({ title, info, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {info && <InfoTip label="About this page">{info}</InfoTip>}
        </div>
        {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
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
