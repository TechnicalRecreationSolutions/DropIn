"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import OrgImage from "./OrgImage";
import { LabelWithInfo } from "@/components/ui/info-tip";
import { Label, FieldError } from "@/components/ui/field";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  deleteOrgMediaByUrl,
  formatBytes,
  uploadOrgMedia,
  validateImageFile,
  type OrgMediaKind,
} from "@/lib/storage/orgMedia";

interface ImageUploadProps {
  /** Current public URL, or null. */
  value: string | null;
  onChange: (url: string | null) => void;
  orgId: string;
  /** Decides the storage folder, and with it whether members or only managers may write. */
  kind: OrgMediaKind;
  label?: string;
  hint?: string;
  /** Shape of the preview. Logos are boxed; photos are wide. */
  aspect?: "wide" | "square";
}

/**
 * Pick or drop an image, upload it, keep the public URL.
 *
 * The whole control is a thin shell over `uploadOrgMedia` — authorization lives
 * in migration 030's storage policies, and the size/type limits live on the
 * bucket. What this adds is the part a policy cannot: telling someone *why*
 * their file was rejected before it crosses the wire, and cleaning up after
 * itself.
 *
 * SUPERSEDED UPLOADS. Replacing an image before saving the form deletes the one
 * it replaced. That file is unreferenced by construction — it was uploaded
 * seconds earlier by this control and its URL never left the component — so
 * deleting it is safe in a way that deleting an *already saved* image is not.
 * Removing a saved image only clears the field; see the README for why, and for
 * the orphan sweep that is still owed.
 */
export default function ImageUpload({
  value,
  onChange,
  orgId,
  kind,
  label = "Image",
  hint,
  aspect = "wide",
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Only ever holds a URL this component uploaded and has not yet handed to a
  // saved record — never one that arrived in `value` from the server.
  const supersedable = useRef<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }

    setUploading(true);
    try {
      const { url } = await uploadOrgMedia(orgId, kind, file);
      const previous = supersedable.current;
      supersedable.current = url;
      onChange(url);
      // Only after the replacement is committed to the form, so a failed
      // delete can never cost the image that replaced it.
      if (previous) await deleteOrgMediaByUrl(previous);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    // Deliberately does not delete. The URL may already be saved on a record,
    // and may have been copied onto another by "Duplicate".
    supersedable.current = null;
    setError(null);
    onChange(null);
  }

  const accept = ALLOWED_IMAGE_TYPES.join(",");

  return (
    <div>
      {hint ? (
        <LabelWithInfo info={hint} className="block text-caption font-medium text-foreground">{label}</LabelWithInfo>
      ) : (
        <Label>{label}</Label>
      )}

      {value ? (
        <div className={cn("relative", aspect === "wide" ? "w-full max-w-xs" : "w-24")}>
          <div
            className={cn(
              "relative overflow-hidden rounded-control border border-border bg-muted",
              aspect === "wide" ? "w-full aspect-video" : "w-24 h-24"
            )}
          >
            <OrgImage src={value} alt="" sizes="320px" className="object-cover" />
          </div>
          <button
            type="button"
            onClick={handleRemove}
            aria-label={`Remove ${label.toLowerCase()}`}
            className="absolute -top-2 -right-2 p-1 rounded-full bg-card border border-input text-muted-foreground hover:text-destructive hover:border-destructive shadow-card transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          disabled={uploading}
          className={cn(
            "w-full flex flex-col items-center justify-center gap-1.5 py-6 px-4 rounded-card border-2 border-dashed transition-colors duration-150 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dragging ? "border-brand bg-brand-subtle" : "border-input hover:bg-muted"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 text-brand animate-spin" />
              <span className="text-sm text-muted-foreground">Uploading…</span>
            </>
          ) : (
            <>
              <ImagePlus className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                Choose an image<span className="hidden sm:inline"> or drop one here</span>
              </span>
              <span className="text-xs text-muted-foreground">
                JPEG, PNG, WebP or AVIF · up to {formatBytes(MAX_UPLOAD_BYTES)}
              </span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, so a failed upload could not be retried.
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />

      {error && (
        <FieldError>
          {error}
        </FieldError>
      )}
    </div>
  );
}
