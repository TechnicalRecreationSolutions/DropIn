"use client";

import { useState } from "react";
import ImageUpload from "@/components/media/ImageUpload";
import SaveBar from "./SaveBar";
import { useOrgPatch, orgFieldClass, orgLabelClass } from "./useOrgPatch";
import { SettingsCard } from "@/components/settings/SettingsSection";

export interface OrgProfileValues {
  name: string;
  description: string;
}

/**
 * Name, logo, description — the three fields that ARE the organization to
 * anyone outside it.
 *
 * Everything here is read by the public side of the app: each facility page's
 * header, the embeddable widget, and the `/find` directory card. Editing it is
 * publishing, which is why it is the first page of Settings rather than filed
 * under a back-office heading.
 *
 * `slug` is not here and is not editable anywhere. It is baked into every URL
 * already handed out, and changing it needs a redirect story first — see the
 * PATCH handler in `api/organizations/route.ts`. The General page shows it as
 * a fact instead, next to the public URL it produces.
 */
export default function OrgProfileForm({
  orgId,
  logoUrl,
  defaultValues,
  canEdit,
}: {
  orgId: string;
  logoUrl: string | null;
  defaultValues: OrgProfileValues;
  /** False for members; the form renders disabled rather than absent. */
  canEdit: boolean;
}) {
  const [form, setForm] = useState<OrgProfileValues>(defaultValues);
  const [logo, setLogo] = useState<string | null>(logoUrl);
  const { save, saving, saved, error, touch } = useOrgPatch();

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    touch();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ ...form, logo_url: logo });
      }}
      className="space-y-6"
    >
      <SettingsCard title="Public profile" info="Shown on your public schedule pages, in the widget, and in the resident directory.">
        <div className="space-y-5">
          <div>
            <label htmlFor="name" className={orgLabelClass}>
              Organization name *
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              disabled={!canEdit}
              value={form.name}
              onChange={handleChange}
              className={orgFieldClass}
              placeholder="City of Calgary Recreation"
            />
          </div>

          {/* ImageUpload has no disabled state of its own, and storage RLS
              would reject a member's write to `{orgId}/org/` with a raw error.
              A fieldset disables every control inside it, so the control
              renders with its current logo but nothing in it can be operated. */}
          <fieldset disabled={!canEdit} className="min-w-0">
            <ImageUpload
              value={logo}
              onChange={(url) => {
                setLogo(url);
                touch();
              }}
              orgId={orgId}
              kind="org"
              aspect="square"
              label="Logo"
              hint="Appears on your public schedule pages."
            />
          </fieldset>

          <div>
            <label htmlFor="description" className={orgLabelClass}>
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              disabled={!canEdit}
              value={form.description}
              onChange={handleChange}
              className={orgFieldClass}
              placeholder="What your organization offers, in a sentence or two..."
            />
          </div>
        </div>
      </SettingsCard>

      <SaveBar saving={saving} saved={saved} error={error} canEdit={canEdit} />
    </form>
  );
}
