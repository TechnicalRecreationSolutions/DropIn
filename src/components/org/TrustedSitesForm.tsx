"use client";

import { useState } from "react";
import { Globe, Plus, X } from "lucide-react";
import SaveBar from "./SaveBar";
import { useOrgPatch } from "./useOrgPatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, FieldHelp, FieldError } from "@/components/ui/field";
import { SettingsCard } from "@/components/settings/SettingsSection";
import { MAX_TRUSTED_HOSTS, normalizeHost } from "@/lib/embed/trustedSites";

/**
 * The websites allowed to show this organization's embedded widget.
 *
 * The list is edited locally and saved as a whole with the shared SaveBar,
 * like every other organization form — adding a site is not live until Save,
 * so a typo can be removed before it ever reaches a header.
 *
 * Entries are normalised as they are added (the same `normalizeHost` the API
 * applies), so what the list shows is exactly what will be stored: someone who
 * pastes `https://www.example.ca/schedule` sees `www.example.ca` appear, not a
 * URL that silently became something else on save.
 */
export default function TrustedSitesForm({
  defaultHosts,
  canEdit,
}: {
  defaultHosts: string[];
  canEdit: boolean;
}) {
  const [hosts, setHosts] = useState<string[]>(defaultHosts);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const { save, saving, saved, error, touch } = useOrgPatch();

  function add() {
    if (!draft.trim()) return;
    const host = normalizeHost(draft);
    if (!host) {
      setDraftError("That isn't a website address. Try something like example.ca.");
      return;
    }
    if (hosts.length >= MAX_TRUSTED_HOSTS) {
      setDraftError(`You can trust up to ${MAX_TRUSTED_HOSTS} websites.`);
      return;
    }
    if (!hosts.includes(host)) setHosts((prev) => [...prev, host]);
    setDraft("");
    setDraftError(null);
    touch();
  }

  function remove(host: string) {
    setHosts((prev) => prev.filter((h) => h !== host));
    touch();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // A site typed but not yet added is almost always meant to be saved.
        // Adding it here keeps "type, press Save" from quietly dropping it.
        const pending = draft.trim() ? normalizeHost(draft) : null;
        if (draft.trim() && !pending) {
          setDraftError("That isn't a website address. Try something like example.ca.");
          return;
        }
        const next = pending && !hosts.includes(pending) ? [...hosts, pending] : hosts;
        if (pending) {
          setHosts(next);
          setDraft("");
        }
        void save({ embed_allowed_hosts: next });
      }}
      className="space-y-6"
    >
      <SettingsCard
        title="Trusted websites"
        description="Your widget only appears on the websites listed here. Anywhere else, the browser shows an empty frame."
      >
        <div className="space-y-5">
          {hosts.length === 0 ? (
            <p className="text-body text-muted-foreground">
              No websites yet. Your widget only shows inside Dropin. Copying the code onto a site
              won&apos;t work until you add the site here.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-control border border-border">
              {hosts.map((host) => (
                <li key={host} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
                    <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{host}</span>
                  </span>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(host)}
                      aria-label={`Remove ${host}`}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div>
              <Label htmlFor="trusted-site">Add a website</Label>
              <div className="flex gap-2">
                <Input
                  id="trusted-site"
                  value={draft}
                  placeholder="example.ca"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDraftError(null);
                    touch();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                  aria-invalid={draftError ? true : undefined}
                  aria-describedby="trusted-site-help"
                />
                <Button type="button" variant="outline" onClick={add}>
                  <Plus /> Add
                </Button>
              </div>
              {draftError ? (
                <FieldError>{draftError}</FieldError>
              ) : (
                <FieldHelp id="trusted-site-help">
                  Paste the address of the website where you put the widget.{" "}
                  <code>example.ca</code> also covers <code>www.example.ca</code>. Use{" "}
                  <code>*.example.ca</code> to trust every subdomain. After you save, a change
                  can take up to a minute to reach your website.
                </FieldHelp>
              )}
            </div>
          )}
        </div>
      </SettingsCard>

      <SaveBar saving={saving} saved={saved} error={error} canEdit={canEdit} />
    </form>
  );
}
