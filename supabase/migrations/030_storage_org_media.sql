-- =============================================================================
-- Migration 030: Supabase Storage — the org-media bucket
-- =============================================================================
-- Nothing in this codebase has ever uploaded a file. `photo_urls` columns exist
-- on facilities and schedule_groups, `logo_url` on organizations, and
-- `image_url` on session_features — all of them free text a staff member has to
-- paste a URL into from somewhere else. This migration stands up the storage
-- half so those become real uploads, and unblocks the brochure (Phase D), which
-- is image-heavy by nature.
--
-- DESIGN DECISIONS (and the alternatives rejected)
--
-- 1. One public bucket, not one per org and not private-with-signed-URLs.
--
--    Per-org buckets would mean creating a bucket in the signup path, an
--    operation that needs elevated rights and has no transactional relationship
--    with the org row that justifies it. Path prefixes give the same isolation
--    with none of that: every object lives under `{org_id}/…` and RLS keys off
--    the first path segment.
--
--    Private + signed URLs was the closer call. Signed URLs expire, which means
--    a widget embedded on a third-party page would serve images that rot, and
--    every render would need a server round trip to re-sign. These assets are
--    facility photos, event pictures and brochure covers — things whose entire
--    purpose is to be shown to the public. `next.config.ts` already anticipated
--    this: its `remotePatterns` entry is scoped to
--    `/storage/v1/object/public/**`, and the CSP already allows
--    `https://*.supabase.co` in `img-src`.
--
--    CONSEQUENCE, STATED PLAINLY: an object in this bucket is readable by
--    anyone who has its URL, including before the owning facility or schedule
--    group is published. Paths carry a random UUID filename so they are not
--    enumerable, and no listing is exposed, but this is unguessability rather
--    than authorization. Nothing sensitive belongs here. See docs/SECURITY.md.
--
-- 2. Writes are role-scoped by folder, matching migration 024's line.
--
--    024 drew the boundary at structural (owner/admin) vs schedule content
--    (any member). Images straddle it: a facility's cover photo is structural,
--    an event's picture is schedule content. Rather than pick one role for the
--    whole bucket and be wrong half the time, the second path segment names the
--    kind, and the policies apply 024's own rule to it:
--
--      {org_id}/events/…      member-writable   (session_features.image_url)
--      {org_id}/brochure/…    member-writable   (Phase D entries)
--      {org_id}/facilities/…  owner/admin only  (facilities.photo_urls)
--      {org_id}/schedules/…   owner/admin only  (schedule_groups.photo_urls)
--      {org_id}/org/…         owner/admin only  (organizations.logo_url)
--
--    A member who could write to `facilities/` could not change the facilities
--    row itself, so the mismatch would be visible but not exploitable — this is
--    tightening for consistency, not to close a hole.
--
-- 3. Size and MIME limits live on the bucket, not only in the client.
--
--    The publishable key is in the browser bundle (024's header makes this
--    point about PostgREST; it is equally true of Storage). A client-side check
--    is a courtesy to the user, not a control. `file_size_limit` and
--    `allowed_mime_types` are enforced by Storage itself and cannot be skipped
--    by calling the API directly.
--
-- 4. SVG is deliberately excluded from allowed_mime_types.
--
--    SVG is a script-bearing document format. An uploaded SVG served from the
--    Storage origin and opened directly executes its script against that
--    origin — and Storage is on `*.supabase.co`, which the app's own CSP trusts
--    for images. Raster only. An org that wants a vector logo can export a PNG.
--
-- Rollback: supabase/rollbacks/030_storage_org_media.sql
-- =============================================================================

-- =============================================================================
-- The bucket
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-media',
  'org-media',
  TRUE,
  5242880,  -- 5 MB. A facility cover photo off a phone is 2–4 MB; a brochure
            -- cover is smaller. Large enough not to reject real photographs,
            -- small enough that a mistaken video upload fails fast.
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Helpers: the org and the kind that own an object, from its path
-- =============================================================================
-- Defined in `public`, like every other helper in this schema (002, 024). The
-- storage schema is Supabase-managed; adding our own functions to it invites a
-- collision on an upgrade and needs rights we otherwise never use.
--
-- `storage.foldername(name)` returns the path segments as text[]: segment 1 is
-- the org id, segment 2 is the kind.
--
-- The UUID cast is wrapped rather than written inline. A policy is evaluated
-- against whatever path the caller supplies, and `'not-a-uuid'::UUID` raises
-- 22P02 — inside a USING clause that surfaces as a 500 rather than a denial,
-- which is both a worse error and a way to distinguish "rejected" from
-- "malformed" that a caller should not get. AND does not reliably short-circuit
-- in SQL, so guarding the cast with a regex test in the same expression would
-- not be safe either.
CREATE OR REPLACE FUNCTION public.org_media_org_id(object_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE
SET search_path = public, storage AS $$
BEGIN
  RETURN ((storage.foldername(object_name))[1])::UUID;
EXCEPTION
  WHEN others THEN RETURN NULL;  -- malformed path: owns nothing, denies cleanly
END;
$$;

CREATE OR REPLACE FUNCTION public.org_media_kind(object_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
SET search_path = public, storage AS $$
  SELECT (storage.foldername(object_name))[2];
$$;

-- =============================================================================
-- Policies on storage.objects, scoped to this bucket
-- =============================================================================
-- Public read. The bucket is already public, so this documents rather than
-- grants — but an explicit policy means flipping `public` to FALSE later
-- narrows the surface in one place instead of silently changing behaviour.
CREATE POLICY "org_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-media');

-- Schedule-content folders: any member of the owning org, matching the
-- member-writable line 024 drew for sessions and session_features.
CREATE POLICY "org_media_member_write"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'org-media'
    AND public.org_media_kind(name) IN ('events', 'brochure')
    AND public.org_media_org_id(name) = ANY(public.user_org_ids())
  )
  WITH CHECK (
    bucket_id = 'org-media'
    AND public.org_media_kind(name) IN ('events', 'brochure')
    AND public.org_media_org_id(name) = ANY(public.user_org_ids())
  );

-- Structural folders: owner/admin only, via 024's own helper.
CREATE POLICY "org_media_manager_write"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'org-media'
    AND public.org_media_kind(name) IN ('facilities', 'schedules', 'org')
    AND public.org_can_manage(public.org_media_org_id(name))
  )
  WITH CHECK (
    bucket_id = 'org-media'
    AND public.org_media_kind(name) IN ('facilities', 'schedules', 'org')
    AND public.org_can_manage(public.org_media_org_id(name))
  );

-- Superadmin, matching every other table's escape hatch.
CREATE POLICY "org_media_superadmin_all"
  ON storage.objects FOR ALL
  USING (bucket_id = 'org-media' AND public.is_superadmin())
  WITH CHECK (bucket_id = 'org-media' AND public.is_superadmin());

COMMENT ON FUNCTION public.org_media_org_id(TEXT) IS
  'First path segment of an org-media object as a UUID, or NULL when the path '
  'is malformed. Never raises: a policy must deny a bad path, not 500 on it.';

COMMENT ON FUNCTION public.org_media_kind(TEXT) IS
  'Second path segment of an org-media object: events | brochure | facilities '
  '| schedules | org. Determines whether a write is member- or manager-scoped, '
  'per migration 024.';
