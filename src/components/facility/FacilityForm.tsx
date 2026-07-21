"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CANADIAN_PROVINCES = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"],
  ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

interface FacilityFormProps {
  orgId?: string;
  facilityId?: string;
  defaultValues?: {
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
  };
}

export default function FacilityForm({ orgId, facilityId, defaultValues }: FacilityFormProps) {
  const router = useRouter();
  const isEditing = !!facilityId;

  const [form, setForm] = useState({
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
  });

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      body: JSON.stringify({ ...form, facilityId }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    router.push("/dashboard/facilities");
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
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
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <div>
          <label htmlFor="is_published" className="text-sm font-medium text-gray-700">
            Publish this facility
          </label>
          <p className="text-xs text-gray-500">
            Visible on the public Dropin discovery map and search.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
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
