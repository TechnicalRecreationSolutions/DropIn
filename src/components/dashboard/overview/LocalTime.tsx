"use client";

import { format } from "date-fns";

/**
 * A clock time in the viewer's own zone ("2:14 pm"). The Overview is
 * server-rendered and the server's zone is not the pool's, so instants are
 * passed down as ISO strings and formatted here. Rendered on the server too
 * (for the first paint), hence suppressHydrationWarning.
 */
export default function LocalTime({ iso, fallback = "" }: { iso: string | null; fallback?: string }) {
  if (!iso) return <>{fallback}</>;
  const text = format(new Date(iso), "h:mm a").toLowerCase();
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
