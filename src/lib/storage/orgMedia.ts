import { createClient } from "@/lib/supabase/client";

/**
 * The one bucket. See migration 030 for why it is single, public, and
 * path-scoped rather than one bucket per org or private with signed URLs.
 */
export const ORG_MEDIA_BUCKET = "org-media";

/**
 * Kept in step with `storage.buckets.file_size_limit` in migration 030.
 *
 * This constant is a courtesy: it produces a good error before a 5 MB upload
 * crosses the wire. It is **not** the control — the publishable key ships in
 * the browser bundle, so anything enforced only here can be skipped by calling
 * Storage directly. The bucket enforces the real limit.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Kept in step with `storage.buckets.allowed_mime_types`. SVG is excluded deliberately — see migration 030, decision 4. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/**
 * The second path segment, which decides whether a write is member- or
 * manager-scoped. Migration 030's policies key off exactly these strings —
 * adding one here without adding it there produces an upload that fails with a
 * bare RLS denial.
 */
export type OrgMediaKind = "events" | "brochure" | "facilities" | "schedules" | "org";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Human-readable size, for error messages. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why a file can't be uploaded, or null when it can.
 *
 * Checked before the request so the user gets "that's 8.2 MB, the limit is 5 MB"
 * instead of a 413 with no number in it.
 */
export function validateImageFile(file: File): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `${file.type || "That file type"} isn't supported. Use a JPEG, PNG, WebP or AVIF image.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
  return null;
}

/**
 * `{orgId}/{kind}/{uuid}.{ext}`.
 *
 * The original filename is deliberately discarded rather than sanitized. It is
 * attacker-influenced text that would end up in a public URL, it leaks whatever
 * staff happened to name the file, and two facilities uploading `cover.jpg`
 * would collide. A UUID also makes the path unguessable, which matters here
 * because the bucket is public-read — see migration 030's stated consequence.
 */
export function orgMediaPath(orgId: string, kind: OrgMediaKind, file: File): string {
  const extension = EXTENSION_BY_TYPE[file.type] ?? "bin";
  return `${orgId}/${kind}/${crypto.randomUUID()}.${extension}`;
}

/** True for a URL this app uploaded, i.e. one `next/image` is configured to optimize. */
export function isOrgMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(`/storage/v1/object/public/${ORG_MEDIA_BUCKET}/`);
}

/** The storage path inside the bucket, for deletion. Null for anything not ours. */
export function orgMediaPathFromUrl(url: string | null | undefined): string | null {
  if (!url || !isOrgMediaUrl(url)) return null;
  const marker = `/storage/v1/object/public/${ORG_MEDIA_BUCKET}/`;
  const path = url.slice(url.indexOf(marker) + marker.length);
  return path.length > 0 ? decodeURIComponent(path) : null;
}

export interface UploadResult {
  /** Public URL, ready to store in image_url / photo_urls / logo_url. */
  url: string;
  /** Path within the bucket, for a later delete. */
  path: string;
}

/**
 * Uploads straight from the browser to Storage.
 *
 * Deliberately not proxied through a route handler. The browser client carries
 * the user's session, so migration 030's policies authorize the write exactly
 * as PostgREST policies authorize a table write — the same model the rest of
 * the app uses. Proxying would put every megabyte through a serverless function
 * for no security gain, since the policy is what decides either way.
 */
export async function uploadOrgMedia(
  orgId: string,
  kind: OrgMediaKind,
  file: File
): Promise<UploadResult> {
  const problem = validateImageFile(file);
  if (problem) throw new Error(problem);

  const supabase = createClient();
  const path = orgMediaPath(orgId, kind, file);

  const { error } = await supabase.storage.from(ORG_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    // Paths carry a fresh UUID, so a collision means something is wrong rather
    // than that the caller wants to replace a file.
    upsert: false,
    // A year: the path is content-addressed by UUID, so the bytes at a given
    // URL never change. Replacing an image produces a new URL.
    cacheControl: "31536000",
  });

  if (error) {
    // Storage's own messages are terse ("new row violates row-level security
    // policy"). Translate the two a user can act on.
    if (/row-level security/i.test(error.message)) {
      throw new Error("You don't have permission to upload images here.");
    }
    if (/exceeded the maximum allowed size|payload too large/i.test(error.message)) {
      throw new Error(`That image is too large. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
    }
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(ORG_MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Removes an object by its public URL. Silent on failure by design.
 *
 * Only ever called for a file this app just uploaded and then superseded, where
 * failing to delete leaves an orphan nobody references — a storage cost, not a
 * correctness problem. Surfacing that as an error on top of a successful upload
 * would report a failure for something that did work.
 */
export async function deleteOrgMediaByUrl(url: string): Promise<void> {
  const path = orgMediaPathFromUrl(url);
  if (!path) return;
  try {
    await createClient().storage.from(ORG_MEDIA_BUCKET).remove([path]);
  } catch {
    // Orphan. See above.
  }
}
