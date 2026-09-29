"use client";

import { useState } from "react";
import SaveBar from "./SaveBar";
import { useOrgPatch } from "./useOrgPatch";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label, FieldHelp } from "@/components/ui/field";
import { SettingsCard } from "@/components/settings/SettingsSection";

/**
 * Canada only, deliberately. Every customer and prospect is a municipal or
 * regional recreation department, `province` is `CHAR(2)` with a Canadian code
 * in it across the whole schema, and a free-text region field would produce
 * "BC", "B.C." and "British Columbia" in three rows of the same table. Adding
 * a country is a schema change plus a directory change, not a dropdown.
 */
const CANADIAN_PROVINCES = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"],
  ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

export interface OrgContactValues {
  website_url: string;
  phone: string;
  email: string;
  address_line1: string;
  city: string;
  province: string;
  postal_code: string;
}

/**
 * How the public reaches the organization, and where it is.
 *
 * Its own page rather than a second card under the profile, because it is
 * answering a different question and is changed at a different rate: a name
 * and logo are set once, a phone number changes when the front desk moves.
 *
 * **This address is the organization's, not any facility's.** Each facility
 * carries its own street address, and the facility's is what the public page,
 * the map and the `/find` directory use — this one is the head office on the
 * contact card. Two addresses that look alike is a real trap, so the page says
 * so where it can be read rather than only here.
 */
export default function OrgContactForm({
  defaultValues,
  canEdit,
}: {
  defaultValues: OrgContactValues;
  canEdit: boolean;
}) {
  const [form, setForm] = useState<OrgContactValues>(defaultValues);
  const { save, saving, saved, error, touch } = useOrgPatch();

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    touch();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(form);
      }}
      className="space-y-6"
    >
      <SettingsCard title="Contact" info="Shown to the public on your facility pages. Leave a field blank to hide it.">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email" name="email" type="email" disabled={!canEdit}
                value={form.email} onChange={handleChange} placeholder="info@example.ca"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone" name="phone" type="tel" disabled={!canEdit}
                value={form.phone} onChange={handleChange} placeholder="403-555-0100"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="website_url">Website</Label>
            <Input
              id="website_url" name="website_url" type="url" disabled={!canEdit}
              value={form.website_url} onChange={handleChange} placeholder="https://..."
            />
            {/* A visible hint rather than an (i): an invalid URL here is
                rejected by the API with a validation error, and "include
                https://" is the fix. Hiding the fix behind a tap makes the
                error unactionable. */}
            <FieldHelp>
              Include <code>https://</code> — a bare domain is rejected.
            </FieldHelp>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Head office"
        description="Your facilities each carry their own address. This one is the organization's, and it is what a patron sees on your contact card."
      >
        <div className="space-y-5">
          <div>
            <Label htmlFor="address_line1">Street address</Label>
            <Input
              id="address_line1" name="address_line1" type="text" disabled={!canEdit}
              value={form.address_line1} onChange={handleChange} placeholder="800 Macleod Trail SE"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city" name="city" type="text" disabled={!canEdit}
                value={form.city} onChange={handleChange} placeholder="Calgary"
              />
            </div>
            <div>
              <Label htmlFor="province">Province</Label>
              <NativeSelect
                id="province" name="province" disabled={!canEdit}
                value={form.province} onChange={handleChange}
              >
                <option value="">—</option>
                {CANADIAN_PROVINCES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="postal_code">Postal code</Label>
              <Input
                id="postal_code" name="postal_code" type="text" disabled={!canEdit}
                value={form.postal_code} onChange={handleChange} placeholder="T2G 2M3"
              />
            </div>
          </div>
        </div>
      </SettingsCard>

      <SaveBar saving={saving} saved={saved} error={error} canEdit={canEdit} />
    </form>
  );
}
