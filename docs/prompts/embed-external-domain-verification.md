# Prompt: Fix the Widget's Hardcoded Origin, Then Prove It Embeds Live on a Real External Domain

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

The embed widget is already built — `/dashboard/widget` generates a script snippet, `/widget/[orgId]` renders a live, iframe-safe schedule page, and `next.config.ts` deliberately loosens framing headers only for that one route. This is not a "build the feature" task. It is: **find and fix the one thing standing between "works in principle" and "actually embeds on a domain that isn't dropin.app," then prove it end-to-end by embedding a real org's schedule on an external site.**

The concrete goal for this session: get a live Dropin schedule rendering inside an `<iframe>` on a domain the operator owns personally (not `drop-in-ten.vercel.app`, not `dropin.app`), confirm it shows real data, confirm the height auto-adjusts, and confirm the browser console is free of CSP/frame violations when framed cross-origin. `docs/DEPLOYMENT.md` step 5 lists "the embedded widget, framed on a different origin" as a still-outstanding verification item — this session closes it for real, not just against a preview pane on the same origin.

## Why this matters

Every org that adopts Dropin needs its schedule to show up on a website Dropin doesn't control. The architecture for that already exists and is well-reasoned (see `next.config.ts`'s comments on `frame-ancestors` vs. `X-Frame-Options`, and `public/embed/widget.js`'s postMessage resize protocol). What's never been verified is whether it actually works when framed from a truly separate origin, and there's a known inconsistency in how the embed script determines where to point its iframe.

## Current state (read these before touching anything)

**Two embed mechanisms, both already implemented:**
- Raw iframe: point any `<iframe>` at `/widget/[orgId]?facilityId=...&departmentId=...&theme=...`. No script involved. `src/app/widget/[orgId]/page.tsx` verifies the org/facility/department belong together, loads `widget_configs` for allowed layouts + colors, and renders `WidgetScheduleClient`.
- Script loader: `/dashboard/widget` (`src/components/widget/WidgetConfigurator.tsx`) generates a `<script src=".../embed/widget.js" data-org-id="...">` snippet. `public/embed/widget.js` reads the `data-*` attributes, injects an iframe into `#dropin-widget`, and listens for `window.postMessage({type:'dropin:resize', height})` to auto-resize. It also fires a no-PII `widget_view` analytics beacon.

**Headers (`next.config.ts`) are already correct and deliberate:**
- `/widget/:path*` — no `X-Frame-Options`, `frame-ancestors *`. The comment there explains why `X-Frame-Options: ALLOWALL` would be wrong (not a real header value) and `frame-ancestors *` is the actual mechanism.
- `/embed/:path*` — `Access-Control-Allow-Origin: *`, cached, `nosniff`.
- Everything else stays `SAMEORIGIN` / CSP `frame-ancestors 'self'`.
- `frame-src 'self'` in the main CSP has a documented trap: it assumes `NEXT_PUBLIC_APP_URL` matches the origin actually serving the page, or the `/dashboard/widget` preview pane goes silently blank. That's a *different* surface than what this session is testing (the preview pane is same-app; the real embed target is a genuinely external domain), but keep it in mind if you touch that code path.

**The bug to fix first — `public/embed/widget.js` line 4:**
```js
var BASE_URL = "https://dropin.app";
```
This is a static file served as-is from `/public`; it cannot read `NEXT_PUBLIC_APP_URL` at request time the way `WidgetConfigurator.tsx` does (`process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app"`, line 18). Today the two are inconsistent: the dashboard shows a `<script src>` pointed at the correct live domain, but once that script *runs*, it builds the iframe `src` from its own separate hardcoded constant — which is `dropin.app`, a domain `docs/DEPLOYMENT.md` confirms is not the current production URL (`drop-in-ten.vercel.app` is).

**Fix it by having the script determine its own origin at runtime, not by hardcoding a second constant.** Classic pattern: capture `document.currentScript` (or fall back to the last matching `<script data-org-id>` tag, which the file already locates) *synchronously at the top of the IIFE, before any async work* — this is safe even with the `async` attribute, because `document.currentScript` is valid for the duration of a script's own synchronous execution regardless of how it was fetched; it only becomes unreliable inside later callbacks. Derive `BASE_URL` from `new URL(scriptEl.src).origin`. This makes the file correct on every environment it's ever served from — prod, a future custom domain, even a local test server — with zero hardcoded domain and nothing to keep in sync with `NEXT_PUBLIC_APP_URL` ever again. Don't introduce an API-route-generated JS file or a build step for this; the runtime-origin fix is strictly simpler and removes the duplication entirely rather than relocating it.

**Live-data behavior — verify, don't assume:** `src/app/widget/[orgId]/page.tsx` has no `revalidate`, `"use cache"`, or ISR config, so it should already be dynamically rendered per request. The app runs `cacheComponents: true` (PPR) globally (see `next.config.ts`'s CSP comment), so confirm nothing upstream (a shared layout, `OrgThemeProvider`, etc.) opts a cached boundary in that would make the widget serve stale data after a session edit. Test this for real: edit a session's time in the dashboard, reload the embedded iframe, confirm the change appears immediately — don't trust a 200 response or an absence of visible caching config as proof (see `feedback_verify_dont_assume_dropin` — this codebase has a documented history of confident claims being wrong until measured).

**Known non-goal:** `frame-ancestors *` is a deliberate, already-made decision — any site can currently embed any org's widget, with no per-org allowlist. That's intentional (published data only, no auth) per the code comments. Do not add an origin allowlist as part of this session unless the operator asks for it explicitly; it's a scope decision, not a bug.

## Plan

**Phase 1 — Fix the hardcoded origin.** Edit `public/embed/widget.js` to derive `BASE_URL` from the loading script's own `src` at runtime instead of the hardcoded string. Keep the rest of the file's behavior (resize listener, analytics beacon, container lookup) unchanged. Manually re-verify the `WidgetConfigurator.tsx`-generated snippet still matches what the script now does with it — they should now agree by construction rather than by coincidence.

**Phase 2 — Confirm live-data behavior**, per the verification step above. This is a quick check, not a redesign; only act if you actually find caching, not because caching is plausible.

**Phase 3 — Embed on a real external domain.** This is the "for fun" proof:
1. Pick (or create) a real test org/facility in the current deployment and get its `orgId` from `/dashboard/widget`.
2. Generate the snippet from the dashboard (now correct after Phase 1).
3. Publish a minimal page containing that snippet on the operator's own personal domain — whatever that domain's hosting actually is (static host, existing site builder, etc.). This step is the operator's own action outside this repo; describe exactly what to paste and where, don't guess at infrastructure you can't see.
4. Load that page and confirm: the schedule renders with real data, the iframe height adjusts to content (resize test: pick a scope with enough sessions to need more than the default height), and the browser console shows no CSP or frame-related errors — this is the specific check `docs/DEPLOYMENT.md` step 5 has been waiting on.
5. Re-run the Phase 2 live-update check *through the embed*, not just by hitting `/widget/[orgId]` directly, to prove the whole chain (script → iframe → live Supabase data) works cross-origin.

**Phase 4 — write up what changed.** Update `docs/DEPLOYMENT.md` step 5's checklist to reflect that the cross-origin frame test is now actually done (not just header-verified), and note the Phase 1 fix in whatever changelog/RESUME doc is current. If a real auto-refresh gap (long-lived open tab never seeing new sessions) turns out to matter in practice, note it as a follow-up decision for the operator rather than building it unasked.

## Conventions that apply here

- Mobile-first still applies to anything you touch — the widget already renders inside a real customer page at whatever width their site gives it.
- No `as any`; keep `src/types/database.types.ts` in sync if you touch anything schema-adjacent (you shouldn't need to for this task).
- Don't resume or reference the removed scraping/events-brochure/cross-org-search tracks — they're closed chapters (`project_scope_not_a_marketplace`, `project_events_brochure_track`).
- SMTP is still not configured — irrelevant here, just don't add an email dependency incidentally.
- This is a small, verification-plus-one-bugfix task. Do not expand it into a redesign of the embed system, an origin allowlist, or a refresh-polling feature unless the operator asks after seeing Phase 3 work.
