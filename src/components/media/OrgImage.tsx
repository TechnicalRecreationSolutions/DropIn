import Image from "next/image";
import { isOrgMediaUrl } from "@/lib/storage/orgMedia";

interface OrgImageProps {
  src: string;
  alt: string;
  /** Passed to next/image when optimizing. Ignored otherwise. */
  sizes?: string;
  className?: string;
}

/**
 * An org-supplied image, optimized when it is safe to optimize.
 *
 * `next.config.ts` allows exactly one remote pattern: Supabase Storage public
 * objects. Anything else — a URL pasted before uploads existed, an org logo
 * hosted on the org's own site — goes through a plain `<img>`, because handing
 * an unlisted host to `next/image` is not a graceful degradation. The optimizer
 * returns **400** and the image simply does not render.
 *
 * That is the whole reason this component exists rather than each caller
 * choosing: the failure is invisible until a specific org with a specific
 * legacy URL loads a specific page, which is not a thing anyone catches by
 * looking.
 *
 * **Requires a positioned parent** with its own dimensions — both branches fill
 * it, so a static parent collapses the image to nothing.
 */
export default function OrgImage({ src, alt, sizes = "100vw", className }: OrgImageProps) {
  if (isOrgMediaUrl(src)) {
    return <Image src={src} alt={alt} fill sizes={sizes} className={className} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`absolute inset-0 w-full h-full ${className ?? ""}`} />;
}
