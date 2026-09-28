/**
 * Only same-origin relative paths may be redirected to.
 *
 * A post-auth destination is attacker-controllable — anyone can send someone a
 * `/login?redirectTo=…` or `/callback?next=…` link — so it must not be able to
 * bounce a freshly-authenticated user off-site. A leading "//" or "/\" is
 * rejected because browsers read those as protocol-relative URLs pointing at
 * another host.
 *
 * Shared by the auth callback route and LoginForm. Before this existed only the
 * callback checked, and LoginForm handed `redirectTo` straight to
 * `router.push()`, which navigates to an absolute URL without complaint.
 */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
