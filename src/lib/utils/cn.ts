import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design tokens added in globals.css (docs/DESIGN.md §4-§5). tailwind-merge
// only knows Tailwind's own names, and guesses at the rest: it reads
// "text-title" as a colour and silently drops it from
// cn("text-title text-foreground"). Naming them here puts each in its real
// group, so a size only replaces a size and a radius only replaces a radius.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["title", "heading", "card-title", "body", "caption", "label", "stat"],
      radius: ["control", "banner", "card", "dialog", "panel"],
      shadow: ["card"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
