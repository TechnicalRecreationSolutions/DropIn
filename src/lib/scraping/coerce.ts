/**
 * Coerces a scraping_conflicts stored TEXT value back into the shape the
 * target programs/sessions column expects. Conflict values are always
 * stored as TEXT (or JSON-stringified arrays), never typed, per migration 006.
 */
export function coerceFieldValue(fieldName: string, rawValue: string | null): unknown {
  if (rawValue === null) return null;

  switch (fieldName) {
    case "max_participants":
    case "cost_cents": {
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
    case "tags":
    case "photo_urls": {
      try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    default:
      return rawValue;
  }
}
