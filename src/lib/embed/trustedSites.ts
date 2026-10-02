/**
 * Trusted websites — the sites an organization allows to embed its widget
 * (migration 067, `organizations.embed_allowed_hosts`).
 *
 * ## What actually enforces this
 *
 * The browser. `proxy.ts` answers every `/widget/<orgId>` request with a
 * `Content-Security-Policy: frame-ancestors 'self' <these hosts>` header, and a
 * browser refuses to render the page inside a frame on any other site. The
 * embedding page cannot switch that off: the header comes from Dropin's server
 * on the framed response, not from anything in the snippet. Copying the
 * `<script>` or `<iframe>` onto another site gets that site a blank, refused
 * frame.
 *
 * What it does NOT stop: the schedule is public data. Anyone can still open
 * the widget link in its own tab, visit the facility page, or read the same
 * sessions from the public API and draw their own copy. This control decides
 * where *Dropin's widget* may appear, which is the thing that carries the
 * organization's name and branding onto a third-party page.
 *
 * ## The format, and why it is checked twice
 *
 * An entry is a bare host — `example.com`, `www.example.com`,
 * `*.example.com`, or `localhost:3000` — never a URL. The value ends up inside
 * an HTTP header, so a stray `;`, space or newline would either inject a CSP
 * directive or make the header unsendable. `normalizeHost` is applied when the
 * list is saved, and `frameAncestorSources` filters through `HOST_PATTERN`
 * again when the header is built, so a row written some other way still
 * cannot reach the header unchecked.
 *
 * Hosts are written without a scheme. In CSP a scheme-less source matches the
 * protected page's own scheme (https in production), plus the http→https
 * upgrade, so `example.com` covers the customer's https site and nothing on
 * plain http in production — which is the right default.
 */

/** A host, an optional `*.` wildcard prefix, an optional port. Lowercase. */
export const HOST_PATTERN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(:\d{1,5})?$/;

/** Mirrors the CHECK in migration 067. */
export const MAX_TRUSTED_HOSTS = 25;

/**
 * Turns whatever someone pasted — `https://www.Example.com/schedule?x=1`,
 * `example.com.`, ` example.com ` — into the stored form, or null when it is
 * not something a browser could be framing us from.
 */
export function normalizeHost(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  // Strip a scheme and anything after the host. Done by hand rather than with
  // `new URL()` because `*.example.com` is not a parseable URL.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/, 1)[0];
  // userinfo (`user@host`) has no place here and would hide the real host.
  if (value.includes("@")) return null;
  value = value.replace(/\.(?=:|$)/, "");

  if (!HOST_PATTERN.test(value)) return null;
  // `*.com` would trust every site on a TLD. A wildcard needs a real domain
  // under it.
  if (value.startsWith("*.") && !value.slice(2).includes(".")) return null;
  return value;
}

/**
 * The `frame-ancestors` source list for one organization.
 *
 * `'self'` is always first: the dashboard's widget preview frames the widget
 * from Dropin's own origin, and that must keep working with an empty list.
 *
 * A plain `example.com` also admits `www.example.com`. Organizations type the
 * name of their site, not the exact host their CMS serves it from, and `www.`
 * under a domain belongs to whoever owns the domain — trusting it adds nobody
 * new. The reverse is not done: `www.example.com` does not imply the apex.
 */
export function frameAncestorSources(hosts: readonly string[] | null | undefined): string {
  const sources = new Set<string>(["'self'"]);
  for (const raw of hosts ?? []) {
    if (typeof raw !== "string" || !HOST_PATTERN.test(raw)) continue;
    sources.add(raw);
    if (!raw.startsWith("*.") && !raw.startsWith("www.") && raw.includes(".") && !IPV4.test(raw)) {
      sources.add(`www.${raw}`);
    }
  }
  return [...sources].join(" ");
}

/** An IPv4 address, optionally with a port — there is no `www.` under one. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long one server instance reuses an organization's list. Every widget
 * load (and every client-side navigation inside it) passes through the proxy,
 * so a database round trip each time would be the most expensive thing the
 * widget does. The cost is that a newly added site can take this long to start
 * working, which the settings page says.
 */
const CACHE_TTL_MS = 60_000;
/** Bounds memory against a flood of made-up org ids. */
const CACHE_MAX_ENTRIES = 2_000;

type CacheEntry = { hosts: string[] | "unrestricted"; at: number };
const cache = new Map<string, CacheEntry>();

/**
 * The organization's trusted hosts, via the `widget_frame_ancestors` RPC
 * (migration 067) — a SECURITY DEFINER function, because `organizations` is
 * members-only (migration 026) and the widget is loaded anonymously.
 *
 * Returns `"unrestricted"` in exactly one case: the function does not exist
 * yet (PostgREST PGRST202), i.e. this code was deployed before migration 067
 * was applied. Migrations here are applied by hand, and failing closed in that
 * window would blank every embed on every customer site at once. Any other
 * failure — database down, a timeout — fails closed to `'self'` only: a
 * security control that opens whenever the database hiccups is not one.
 */
export async function getTrustedHosts(orgId: string): Promise<string[] | "unrestricted"> {
  if (!UUID_PATTERN.test(orgId)) return [];

  const now = Date.now();
  const hit = cache.get(orgId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.hosts;

  let hosts: string[] | "unrestricted" = [];
  let cacheable = true;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/widget_frame_ancestors`, {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_org_id: orgId }),
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      hosts = Array.isArray(body) ? body.filter((h): h is string => typeof h === "string") : [];
    } else {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === "PGRST202") {
        console.warn("[embed] widget_frame_ancestors() missing — apply migration 067. Widget framing is unrestricted until then.");
        hosts = "unrestricted";
      } else {
        cacheable = false;
      }
    }
  } catch {
    // Network failure: closed, and not cached, so the next request retries.
    cacheable = false;
  }

  if (cacheable) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(orgId, { hosts, at: now });
  }
  return hosts;
}

/** `/widget/<orgId>` → orgId, else null. */
export function widgetOrgIdFromPath(pathname: string): string | null {
  const match = /^\/widget\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
