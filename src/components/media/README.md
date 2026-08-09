# `components/media` — image upload and rendering

Two components over one bucket. Everything about *who may write what* lives in
migration `030`, not here.

| | |
|---|---|
| `ImageUpload` | Pick or drop an image, upload it, hand back a public URL. |
| `OrgImage` | Render an org-supplied image, optimized when that's safe. |
| `lib/storage/orgMedia.ts` | Paths, limits, upload/delete, and the "is this ours?" test. |

## The bucket in one paragraph

One public bucket, `org-media`, with every object under `{orgId}/{kind}/{uuid}.{ext}`.
The first path segment scopes ownership; the second decides whether a write is
member- or manager-scoped, applying migration `024`'s structural-vs-content
line to images. Size (5 MB) and MIME type are enforced by Storage itself, not by
this component. Full reasoning, including what was rejected, is in the header of
`supabase/migrations/030_storage_org_media.sql` — read that before changing
anything here.

```
{orgId}/events/…      member-writable    session_features.image_url
{orgId}/brochure/…    member-writable    Phase D entries
{orgId}/facilities/…  owner/admin only   facilities.photo_urls[0]
{orgId}/schedules/…   owner/admin only   schedule_groups.photo_urls[0]
{orgId}/org/…         owner/admin only   organizations.logo_url  ← no UI yet
```

## Why uploads go straight from the browser

`uploadOrgMedia` calls Storage with the user's own session. The storage policies
authorize it exactly as PostgREST policies authorize a table write — the same
model as the rest of the app. Proxying through a route handler would push every
megabyte through a serverless function and buy nothing, because the policy is
what decides either way.

The client-side size and type checks are a **courtesy, not a control**. The
publishable key is in the browser bundle, so anything enforced only in this
component can be skipped by calling Storage directly. Their job is to say "that's
8.2 MB, the limit is 5 MB" instead of surfacing a bare 413.

## `OrgImage` exists because of a silent failure

`next.config.ts` allows exactly one remote pattern: Supabase Storage public
objects. Hand `next/image` a URL on any other host and the optimizer returns
**400** — the image doesn't render at all. It is not a graceful degradation.

Legacy pasted URLs are still in the database (`logo_url` and `photo_urls` were
free text before this bucket existed), so every render site needs the
conditional. Centralizing it means the failure can't be reintroduced by a caller
who reasonably assumes `next/image` handles any URL.

Both branches **fill their parent**, so the parent must be positioned and
sized — a static parent collapses the image to nothing.

## Deleting, and the orphans that remain

`ImageUpload` deletes an image it replaced **before the form was saved**. That
file is unreferenced by construction: it was uploaded seconds earlier by this
component and its URL never left it. That covers the common "wrong file, try
again" case, which is where most orphans come from.

Removing an **already-saved** image only clears the field. It does not delete
the object, deliberately: that URL may already be stored on another record —
"Duplicate to…" copies a session wholesale — and breaking a second record's
image is worse than leaving a file nobody pays much for.

**Still owed:** a sweep for genuinely unreferenced objects. It needs to diff the
bucket against four columns (`facilities.photo_urls`,
`schedule_groups.photo_urls`, `organizations.logo_url`,
`session_features.image_url`) plus Phase D's brochure entries, so it is worth
writing once, after the brochure lands rather than before.

## Known gap

`organizations.logo_url` has a storage folder and a policy, and the org public
page and printed event sheet both render it — but **there is no UI anywhere that
sets it**. There is no org settings page in this app at all. Adding one is a
real feature, not part of this deliverable; the folder is in place for whenever
it happens.
