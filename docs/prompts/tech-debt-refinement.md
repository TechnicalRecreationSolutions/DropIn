# Prompt: Tech Debt Refinement

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

Dropin grew well past its original 5-phase plan — a flagship illustrated facility map, a schedule-template builder, a restructured data model, and a fully-built-then-fully-removed scraping pipeline all happened on top of "weekly grid + widget." Your job is not to add anything. It's to make the app's actual shape legible again and remove the debt that accumulated while the idea grew, without slowing down or diluting the parts that are working. Read `docs/PLAN.md` first — it's a current snapshot of the delivery history, the live schema, and known drift, written specifically so you don't have to re-derive it from 21 migration files.

## Why this matters (internalize this before touching anything)

The person building this can look at `supabase/migrations/` — 21 files and counting — and no longer have a confident, fast answer to "what does the database actually look like right now, and does the app's type layer actually match it?" That uncertainty is the real cost of growth here, more than any individual messy file. The fix is not to rewrite history (migrations that already ran are immutable, full stop) — it's to make the *current state* trustworthy and cheap to check, and to stop new debt of the same shape from accumulating.

## Current state (read these before touching anything)

- **The schema map**: `docs/PLAN.md` section 2 groups all 18 live tables by concern. Cross-check it against `supabase/migrations/*.sql` before trusting either — this doc can itself go stale.
- **The type-drift problem, concretely**: `src/types/database.types.ts` claims to be hand-maintained "until the Supabase project is linked," but it's missing the `stripe_events` table (exists since migration `004`) and likely other drift not yet found. Downstream of that: `supabase as any` appears **113 times across 45 files** — nearly every route or page that touches the database has given up on the type system rather than trust a file that's known to lie.
- **Two flagship features carry real, earned complexity** — don't trim these, audit them for internal consistency instead: the facility map engine (`src/components/facility-maps/`, design brief in `docs/prompts/facility-map-flagship.md`) and the schedule-template builder (`src/components/schedule-builder/`, `src/components/session-template/`).
- **One fully-removed feature (scraping)** may still have fingerprints outside the migrations that already handle the schema: docs, env vars, code comments, unused dependencies, dashboard copy. `docs/PLAN.md` section 1 has the removal history.
- **Known duplicate route trees**: because a schedule group can be either directly under a facility or nested under an optional department, most schedule-group/session-template/builder pages exist twice under `src/app/(dashboard)/dashboard/facilities/[facilityId]/...`. This was previously flagged and deprioritized as codebase-health-only — re-evaluate it now that you're measuring the cost in duplicated files, not just user-facing UX.
- **Known stray directories**: `src/app/(public)/program/[programSlug]/` and `src/app/(dashboard)/dashboard/org/onboarding/` are empty leftovers from past restructuring (`docs/PLAN.md` section 3 has the detail on both).

## Principles (the spec for every decision)

1. **Legibility over rewriting.** The goal is "an outside reviewer can trust the docs and the types," not "the codebase looks different." Prefer fixing the thing that's lying over deleting it, unless it's genuinely dead.
2. **Never touch an already-run migration.** Fixes to schema drift are new, additive migrations or corrections to generated/hand-maintained artifacts — never edits to `001`–`021`.
3. **Flagship complexity is not debt.** The facility map and schedule builder earned their size. Look for *inconsistency* between them (naming, data-access patterns, error handling) rather than proposing to simplify either into something smaller.
4. **Verify before deleting.** "Looks unused" is a hypothesis, not a finding — grep for references, check git history for why something exists, and confirm a route/file/table is truly dead before removing it. `docs/PLAN.md` section 3 gives you two already-confirmed examples to start from.
5. **No feature work.** If you notice a genuine product gap while doing this, note it in `docs/PLAN.md` section 4 rather than building it.

## Scope of work

### A. Make the schema trustworthy (do this first — it's the root cause of the rest)

- Diff `src/types/database.types.ts` against every migration, table by table and column by column. Fix every gap found (the missing `stripe_events` table is one confirmed example; there are likely more).
- Decide and document how this file stays correct going forward: either get a Supabase project genuinely linked so `supabase gen types` is real and routine, or establish a clear, enforced process for hand-maintaining it (e.g., a checklist step in the migration-authoring convention, or a script that flags drift). Whichever you pick, write it down in `docs/PLAN.md` and in the file's own header comment — don't leave the next person to rediscover this problem from scratch.
- Once types are trustworthy, work through the 113 `supabase as any` call sites and remove the ones that exist purely because the types couldn't be trusted (not the ones that exist for a legitimate reason — check each). This will be the bulk of the effort; batch it by directory (start with `src/app/api/`, then dashboard pages) and verify with `tsc --noEmit` after each batch, not at the end.

### B. Close out the scraping removal

- Grep the whole repo (code, docs, env files, `package.json`) for scraping-related terms (`scrap`, `Xplor`, `ActiveNet`, `NextRec`, platform adapter references) and confirm nothing outside `docs/PLAN.md`'s historical note and the migration files themselves still references it as live or planned.
- Remove any now-unused dependencies that existed only to support scraping.

### C. Resolve the flagged duplication and stray directories

- Investigate the duplicated department-nested vs. facility-direct schedule-group route trees. Decide (and record the decision in `docs/PLAN.md`) whether to collapse them now or explicitly re-defer with a reason — don't leave it silently unresolved again.
- Delete the confirmed-dead `src/app/(public)/program/[programSlug]/` and `src/app/(dashboard)/dashboard/org/onboarding/` directories after verifying (via grep for links/redirects) that nothing routes to them.

### D. General debt sweep

- Look for other signs of the same pattern: `as any` outside Supabase calls, `@ts-ignore`/`@ts-expect-error`, duplicated logic between early-phase code (auth, core schema) and later-phase code (facility map, schedule builder) that should share a helper, and any other stray/empty files from past restructuring.
- Confirm per-directory READMEs exist and are current for every directory you touch (project convention — this is a real production app held to a professional-audit standard).

### E. Documentation

- Update `docs/PLAN.md` section 3 ("Known drift / debt") to reflect what you fixed vs. what you deliberately deferred and why.
- If the schema map in `docs/PLAN.md` section 2 drifted while you worked (new migration, renamed table), update it in the same commit as the schema change — don't let it go stale again on day one.

## Constraints

- No new migrations that touch already-run schema destructively — additive/corrective only, following the defensive `IF EXISTS`/`IF NOT EXISTS` pattern already established in `021_remove_scraping.sql` where a database's exact migration history can't be assumed.
- No UI/UX changes to the facility map or schedule builder as part of this pass — if you find a genuine bug, fix it narrowly and note it; don't redesign.
- Mobile-first behavior must not regress for anything you touch.
- Keep commits scoped by the section letters above (A–E) rather than one giant commit — this is a cleanup pass, and reviewability matters more than speed here.
