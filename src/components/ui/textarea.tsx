import * as React from "react"

import { cn } from "@/lib/utils/cn"
import { fieldClass } from "@/components/ui/input"

/** A multi-line text field. Same edge, corners and focus ring as `<Input>`. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, "h-auto min-h-20 py-2.5 leading-5", className)}
      {...props}
    />
  )
}

export { Textarea }
