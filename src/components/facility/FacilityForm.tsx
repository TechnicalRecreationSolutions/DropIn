"use client";

import { useState } from "react";
import ImageUpload from "@/components/media/ImageUpload";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

const CANADIAN_PROVINCES = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"],
  ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

interface FacilityFormProps {
  facilityId?: string;
  /** Owning org — decides the storage folder uploads land in. */
  orgId: string;
  /**
   * Whether the platform has verified this org (migration 057). An unverified
   * org can tick the directory box, but nothing is listed until verification,
   * and the form says so rather than let the facility silently not appear.
   */
  orgVerified: boolean;
  defaultValues?: {
    photo_urls?: string[];
    name?: string;
    address_line1?: string;
    city?: string;
    province?: string;
    postal_code?: string;
    phone?: string;
    email?: string;
    website_url?: string;
    description?: string;
    is_published?: boolean;
    listed_in_directory?: boolean;
  };
  /**
   * Whether the saved address was found on the map (edit only). Drives the
   * note under the directory toggle — "near me" can only sort a facility it
   * can place.
   */
  locationStatus?: "found" | "not_found" | "pending";
}

const LOCATION_NOTE: Record<NonNullable<FacilityFormProps["locationStatus"]>, string> = {
  found: "Address found on the map — shown in “near me” results.",
  not_found:
    "We couldn’t find this address on the map, so it won’t appear in “near me” results. Check the street address and postal code.",
  pending: "The address will be looked up on the map when you save.",
};

export default function FacilityForm({ facilityId, orgId, orgVerified, defaultValues, locationStatus }: FacilityFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!facilityId;

  const [form, setForm] = useState(() => initialForm(defaultValues));

  // Kept out of `form` because it isn't an input event — the upload control
  // sets a URL directly, and folding it in would mean widening handleChange's
  // event type for a field no <input> ever emits.
  const [photoUrls, setPhotoUrls] = useState<string[]>(defaultValues?.photo_urls ?? []);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-seed when the server hands down different defaults — see the note in
  // components/space/SpaceForm.tsx. Compared by value, because the props are
  // rebuilt on every server render.
  const defaultsKey = JSON.stringify([initialForm(defaultValues), defaultValues?.photo_urls ?? []]);
  const [seededFrom, setSeededFrom] = useState(defaultsKey);
  if (seededFrom !== defaultsKey && !loading) {
    setSeededFrom(defaultsKey);
    setForm(initialForm(defaultValues));
    setPhotoUrls(defaultValues?.photo_urls ?? []);
    setError(null);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        email: form.email || null,
        website_url: form.website_url || null,
        photo_urls: photoUrls,
        facilityId,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    // `cacheComponents` hides this route segment on navigation instead of
    // unmounting it, and reuses the same instance next time — so without this
    // the next "Add facility" opens holding the building just saved, photos
    // and all, disabled on "Saving…" forever. See components/space/SpaceForm.tsx
    // for the full note.
    setLoading(false);
    setError(null);
    if (!isEditing) {
      setForm(initialForm(defaultValues));
      setPhotoUrls(defaultValues?.photo_urls ?? []);
    }

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    router.push("/dashboard/facilities");
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-card rounded-xl border border-border p-6">
      <div>
        <label htmlFor="name" className={labelClass}>Facility name *</label>
        <input id="name" name="name" type="text" required value={form.name} onChange={handleChange}
          className={fieldClass} placeholder="Village Square Leisure Centre" />
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>Description</label>
        <textarea id="description" name="description" rows={3} value={form.description} onChange={handleChange}
          className={fieldClass} placeholder="Brief description of the facility and what it offers..." />
      </div>

      {/* Element 0 of photo_urls is the cover — the one FacilityGridCard and
          the public facility page render. Only that one is editable here;
          a gallery is not a thing this app shows anywhere yet, and a field
          that stores images nothing displays is worse than no field. */}
      <ImageUpload
        value={photoUrls[0] ?? null}
        onChange={(url) => setPhotoUrls(url ? [url, ...photoUrls.slice(1)] : photoUrls.slice(1))}
        orgId={orgId}
        kind="facilities"
        label="Cover photo"
        hint="Shown on the facilities list and the public facility page."
      />

      <div>
        <label htmlFor="address_line1" className={labelClass}>Street address *</label>
        <input id="address_line1" name="address_line1" type="text" required value={form.address_line1} onChange={handleChange}
          className={fieldClass} placeholder="2623 56 St NE" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" className={labelClass}>City *</label>
          <input id="city" name="city" type="text" required value={form.city} onChange={handleChange}
            className={fieldClass} placeholder="Calgary" />
        </div>
        <div>
          <label htmlFor="province" className={labelClass}>Province *</label>
          <select id="province" name="province" required value={form.province} onChange={handleChange} className={fieldClass}>
            {CANADIAN_PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="postal_code" className={labelClass}>Postal code *</label>
          <input id="postal_code" name="postal_code" type="text" required value={form.postal_code} onChange={handleChange}
            className={fieldClass} placeholder="T1Y 6E7" />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone</label>
          <input id="phone" name="phone" type="tel" value={form.phone} onChange={handleChange}
            className={fieldClass} placeholder="403-555-0100" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" name="email" type="email" value={form.email} onChange={handleChange}
            className={fieldClass} placeholder="info@facility.ca" />
        </div>
        <div>
          <label htmlFor="website_url" className={labelClass}>Website</label>
          <input id="website_url" name="website_url" type="url" value={form.website_url} onChange={handleChange}
            className={fieldClass} placeholder="https://..." />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <input
          id="is_published" name="is_published" type="checkbox"
          checked={form.is_published} onChange={handleChange}
          className="w-4 h-4 rounded border-border text-blue-600 dark:text-blue-400 focus:ring-blue-500"
        />
        <div>
          <label htmlFor="is_published" className="text-sm font-medium text-foreground">
            Publish this facility
          </label>
          <p className="text-xs text-muted-foreground">Shows it on your public pages and widget.</p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="listed_in_directory" name="listed_in_directory" type="checkbox"
          checked={form.listed_in_directory} onChange={handleChange}
          className="mt-0.5 w-4 h-4 rounded border-border text-blue-600 dark:text-blue-400 focus:ring-blue-500"
        />
        <div>
          <label htmlFor="listed_in_directory" className="text-sm font-medium text-foreground">
            List in the Dropin directory
          </label>
          {!form.is_published && (
            <p className="text-xs text-muted-foreground">Only shown while the facility is published.</p>
          )}
          {form.listed_in_directory && !orgVerified && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Your organization hasn’t been verified yet. We confirm that each account
              really runs the centres it lists before they appear in the directory — we’ll
              be in touch, and this facility will show up once that’s done.
            </p>
          )}
          {form.listed_in_directory && locationStatus && (
            <p
              className={
                locationStatus === "not_found"
                  ? "mt-1 text-xs text-amber-700 dark:text-amber-400"
                  : "mt-1 text-xs text-muted-foreground"
              }
            >
              {LOCATION_NOTE[locationStatus]}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add facility"}
        </button>
      </div>
    </form>
  );
}

/**
 * The state this form opens in — shared by the initial `useState`, the
 * re-seed, and the reset after a successful create, so the three can never
 * drift apart. `photo_urls` sits outside it, for the reason given above.
 */
function initialForm(defaultValues: FacilityFormProps["defaultValues"]) {
  return {
    name: defaultValues?.name ?? "",
    address_line1: defaultValues?.address_line1 ?? "",
    city: defaultValues?.city ?? "",
    province: defaultValues?.province ?? "AB",
    postal_code: defaultValues?.postal_code ?? "",
    phone: defaultValues?.phone ?? "",
    email: defaultValues?.email ?? "",
    website_url: defaultValues?.website_url ?? "",
    description: defaultValues?.description ?? "",
    is_published: defaultValues?.is_published ?? false,
    listed_in_directory: defaultValues?.listed_in_directory ?? false,
  };
}
