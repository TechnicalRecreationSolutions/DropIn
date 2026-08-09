-- =============================================================================
-- Rollback for 030_storage_org_media.sql
-- =============================================================================
-- ⚠️  THIS DELETES UPLOADED FILES.
--
-- Dropping the bucket removes every object in it, and the URLs stored in
-- facilities.photo_urls, schedule_groups.photo_urls, organizations.logo_url and
-- session_features.image_url will still point at them — so a rollback leaves
-- broken images across the app rather than empty fields.
--
-- If you are rolling back to fix the *policies*, drop and recreate only the
-- policies and the helper functions; leave the bucket and its objects alone.
-- The bucket DELETE below is separated for exactly that reason.
-- =============================================================================

DROP POLICY IF EXISTS "org_media_superadmin_all" ON storage.objects;
DROP POLICY IF EXISTS "org_media_manager_write"  ON storage.objects;
DROP POLICY IF EXISTS "org_media_member_write"   ON storage.objects;
DROP POLICY IF EXISTS "org_media_public_read"    ON storage.objects;

DROP FUNCTION IF EXISTS public.org_media_kind(TEXT);
DROP FUNCTION IF EXISTS public.org_media_org_id(TEXT);

-- -----------------------------------------------------------------------------
-- Destructive from here. Only run these if you mean to discard the files.
-- -----------------------------------------------------------------------------
-- DELETE FROM storage.objects WHERE bucket_id = 'org-media';
-- DELETE FROM storage.buckets WHERE id = 'org-media';
