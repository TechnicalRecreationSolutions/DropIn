"use client";

import { Printer } from "lucide-react";

/**
 * The one interactive thing on a published brochure.
 *
 * Its own client island so `BrochureDocument` stays a server component — the
 * document is otherwise entirely static content, and making the whole thing a
 * client component to get one `window.print()` would ship the markup twice.
 */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <Printer className="w-4 h-4" />
      Print or save as PDF
    </button>
  );
}
