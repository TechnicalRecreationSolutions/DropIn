import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signs a raw request body for outbound calls to the scraping webhook
 * (used by the trigger route's mock-mode caller and, in production, by the
 * external scraper service itself using the same shared secret).
 */
export function signPayload(rawBody: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

/**
 * Verifies an inbound X-Scraper-Signature header against the raw request body.
 * Must run on the raw (unparsed) body before any JSON parsing.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;

  const expected = signPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
