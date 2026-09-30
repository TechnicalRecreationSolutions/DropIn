"use client";

import { useState } from "react";
import ImageUpload from "@/components/media/ImageUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";
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

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-card border border-border bg-card p-5 shadow-card sm:p-6">
      <div>
        <Label htmlFor="name">Facility name *</Label>
        <Input id="name" name="name" type="text" required value={form.name} onChange={handleChange}
          placeholder="Village Square Leisure Centre" />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} value={form.description} onChange={handleChange}
          placeholder="Brief description of the facility and what it offers..." />
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
        <Label htmlFor="address_line1">Street address *</Label>
        <Input id="address_line1" name="address_line1" type="text" required value={form.address_line1} onChange={handleChange}
          placeholder="2623 56 St NE" />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
        <div>
          <Label htmlFor="city">City *</Label>
          <Input id="city" name="city" type="text" required value={form.city} onChange={handleChange}
            placeholder="Calgary" />
        </div>
        <div>
          <Label htmlFor="province">Province *</Label>
          <NativeSelect id="province" name="province" required value={form.province} onChange={handleChange}>
            {CANADIAN_PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="postal_code">Postal code *</Label>
          <Input id="postal_code" name="postal_code" type="text" required value={form.postal_code} onChange={handleChange}
            placeholder="T1Y 6E7" />
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" value={form.phone} onChange={handleChange}
            placeholder="403-555-0100" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" value={form.email} onChange={handleChange}
            placeholder="info@facility.ca" />
        </div>
        <div>
          <Label htmlFor="website_url">Website</Label>
          <Input id="website_url" name="website_url" type="url" value={form.website_url} onChange={handleChange}
            placeholder="https://..." />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <input
          id="is_published" name="is_published" type="checkbox"
          checked={form.is_published} onChange={handleChange}
          className="size-4 accent-primary"
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
          className="mt-0.5 size-4 accent-primary"
        />
        <div>
          <label htmlFor="listed_in_directory" className="text-sm font-medium text-foreground">
            List in the Dropin directory
          </label>
          {!form.is_published && (
            <p className="text-xs text-muted-foreground">Only shown while the facility is published.</p>
          )}
          {form.listed_in_directory && !orgVerified && (
            <p className="mt-1 text-xs text-warning">
              Your organization hasn’t been verified yet. We confirm that each account
              really runs the centres it lists before they appear in the directory — we’ll
              be in touch, and this facility will show up once that’s done.
            </p>
          )}
          {form.listed_in_directory && locationStatus && (
            <p
              className={
                locationStatus === "not_found"
                  ? "mt-1 text-xs text-warning"
                  : "mt-1 text-xs text-muted-foreground"
              }
            >
              {LOCATION_NOTE[locationStatus]}
            </p>
          )}
        </div>
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="flex-1"
        >
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add facility"}
        </Button>
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
