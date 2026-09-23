"use client";

import { useState } from "react";
import SaveBar from "./SaveBar";
import { useOrgPatch } from "./useOrgPatch";
import { SettingsCard } from "@/components/settings/SettingsSection";

/**
 * The organization's one policy switch, and the only thing in the whole
 * settings section that changes what SOMEBODY ELSE is allowed to do.
 *
 * It lives on its own page rather than under Staff because it is a statement
 * about the organization, not about any one person: it applies to every staff
 * account that exists now or is invited later. Putting it on the Staff page
 * would put an org-wide rule inside a list of individuals, where it reads like
 * a property of whoever happens to be at the top.
 *
 * Gated by `org:edit-settings`, the same permission as renaming the
 * organization — the people who can do that are the people who decide how far
 * it trusts its guards. `public.can_write_notice()` (migration 060) is the
 * actual control; this is the switch it reads.
 */
export default function OrgPermissionsForm({
  auxCanPostNotices,
  canEdit,
}: {
  auxCanPostNotices: boolean;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(auxCanPostNotices);
  const { save, saving, saved, error, touch } = useOrgPatch();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ aux_can_post_notices: value });
      }}
      className="space-y-6"
    >
      <SettingsCard
        title="Facility status notices"
        info="A facility status is the “what is true right now” banner above your public schedule — a closure, a contamination, a staffing shortage. It appears on the facility page, in the embedded widget and on your Overview."
      >
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="aux_can_post_notices"
            disabled={!canEdit}
            checked={value}
            onChange={(e) => {
              setValue(e.target.checked);
              touch();
            }}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <span className="font-medium text-foreground">
              Staff accounts can post a facility status
            </span>
            <span className="mt-1 block text-muted-foreground">
              A lifeguard who finds a problem can close the pool to the public themselves, for
              the facilities assigned to them. Leave this off if posting to patrons should go
              through a supervisor — Owners, Managers and Coordinators can always post.
            </span>
          </span>
        </label>
      </SettingsCard>

      <SaveBar saving={saving} saved={saved} error={error} canEdit={canEdit} />
    </form>
  );
}
