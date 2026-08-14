"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageUpload from "@/components/media/ImageUpload";

const CANADIAN_PROVINCES = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"],
  ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

export interface OrgSettingsValues {
  name: string;
  description: string;
  website_url: string;
  phone: string;
  email: string;
  address_line1: string;
  city: string;
  province: string;
  postal_code: string;
}

interface OrgSettingsFormProps {
  orgId: string;
  /** Immutable, and shown read-only — it is the public URL. */
  orgSlug: string;
  logoUrl: string | null;
  defaultValues: OrgSettingsValues;
  /** False for members; the form renders disabled rather than absent. */
  canEdit: boolean;
}

/**
 * The org profile form.
 *
 * Everything here is read by the *public* side of the app — the org page
 * header, the widget, the printed brochure cover — which is why it isn't
 * filed under an admin/back-office heading. Editing it is publishing.
 *
 * Members see the form filled in but disabled rather than being bounced to a
 * 403 page: knowing what your organization has published is reasonable, and a
 * disabled field says "you can't change this" more clearly than a missing page.
 * The API enforces the same rule independently.
 */
export default function OrgSettingsForm({
  orgId,
  orgSlug,
  logoUrl,
  defaultValues,
  canEdit,
}: OrgSettingsFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<OrgSettingsValues>(defaultValues);
  const [logo, setLogo] = useState<string | null>(logoUrl);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    const res = await fetch("/api/organizations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, logo_url: logo }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save your settings.");
      return;
    }

    setSaved(true);
    // The org name and logo render in the dashboard chrome and on every public
    // page; without this they stay stale until the next hard load.
    router.refresh();
  }

  const fieldClass =
    "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Public profile</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Shown on your public schedule pages, your widget and your brochures.
          </p>
        </div>

        <div>
          <label htmlFor="name" className={labelClass}>Organization name *</label>
          <input
            id="name" name="name" type="text" required disabled={!canEdit}
            value={form.name} onChange={handleChange}
            className={fieldClass} placeholder="City of Calgary Recreation"
          />
        </div>

        <div>
          <span className={labelClass}>Public address</span>
          <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono break-all">
            {`/org/${orgSlug}`}
          </p>
          {/* Not editable: this path is pasted into customers' own websites as
              a widget embed, so changing it would break links already in the
              wild. Saying so is better than a field that looks editable. */}
          <p className="text-xs text-gray-500 mt-1">
            Fixed — changing it would break links and embeds already published.
          </p>
        </div>

        {/* ImageUpload has no disabled state of its own, and storage RLS would
            reject a member's write to `{orgId}/org/` with a raw error. A
            fieldset disables every control inside it, so the control renders
            with its current logo but nothing in it can be operated. */}
        <fieldset disabled={!canEdit} className="min-w-0">
          <ImageUpload
            value={logo}
            onChange={(url) => { setLogo(url); setSaved(false); }}
            orgId={orgId}
            kind="org"
            aspect="square"
            label="Logo"
            hint="Appears on your public schedule pages and printed brochures."
          />
        </fieldset>

        <div>
          <label htmlFor="description" className={labelClass}>Description</label>
          <textarea
            id="description" name="description" rows={3} disabled={!canEdit}
            value={form.description} onChange={handleChange}
            className={fieldClass}
            placeholder="What your organization offers, in a sentence or two..."
          />
        </div>
      </section>

      <section className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Contact</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            How the public can reach your organization.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="email" className={labelClass}>Email</label>
            <input
              id="email" name="email" type="email" disabled={!canEdit}
              value={form.email} onChange={handleChange}
              className={fieldClass} placeholder="info@example.ca"
            />
          </div>
          <div>
            <label htmlFor="phone" className={labelClass}>Phone</label>
            <input
              id="phone" name="phone" type="tel" disabled={!canEdit}
              value={form.phone} onChange={handleChange}
              className={fieldClass} placeholder="403-555-0100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="website_url" className={labelClass}>Website</label>
          <input
            id="website_url" name="website_url" type="url" disabled={!canEdit}
            value={form.website_url} onChange={handleChange}
            className={fieldClass} placeholder="https://..."
          />
        </div>

        <div>
          <label htmlFor="address_line1" className={labelClass}>Street address</label>
          <input
            id="address_line1" name="address_line1" type="text" disabled={!canEdit}
            value={form.address_line1} onChange={handleChange}
            className={fieldClass} placeholder="800 Macleod Trail SE"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="city" className={labelClass}>City</label>
            <input
              id="city" name="city" type="text" disabled={!canEdit}
              value={form.city} onChange={handleChange}
              className={fieldClass} placeholder="Calgary"
            />
          </div>
          <div>
            <label htmlFor="province" className={labelClass}>Province</label>
            <select
              id="province" name="province" disabled={!canEdit}
              value={form.province} onChange={handleChange} className={fieldClass}
            >
              <option value="">—</option>
              {CANADIAN_PROVINCES.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="postal_code" className={labelClass}>Postal code</label>
            <input
              id="postal_code" name="postal_code" type="text" disabled={!canEdit}
              value={form.postal_code} onChange={handleChange}
              className={fieldClass} placeholder="T2G 2M3"
            />
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && (
            <span role="status" className="text-sm text-green-700">Saved.</span>
          )}
        </div>
      )}
    </form>
  );
}
