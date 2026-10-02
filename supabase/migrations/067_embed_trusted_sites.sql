-- =============================================================================
-- 067: trusted websites for the embedded widget
-- =============================================================================
--
-- Until now /widget/<orgId> was served with `frame-ancestors *`: anyone who
-- copied an organization's embed code could put its schedule, name and
-- branding on any website at all. This column is the organization's list of
-- sites allowed to frame it, edited at Settings › Embedding by the Owner and
-- Managers (the same `org:edit-settings` permission, and the same
-- `orgs_admin_update` policy, as the rest of the organization's profile).
--
-- proxy.ts reads it on every widget request and sends it as the response's
-- `frame-ancestors`, so the browser itself refuses to show the widget on any
-- other site (src/lib/embed/trustedSites.ts).
--
-- Entries are bare hosts — `example.com`, `*.example.com`, `localhost:3000` —
-- lowercase, no scheme or path. The value is copied into an HTTP header, so the
-- format is enforced here as well as in the app: a `;` or a space would add a
-- CSP directive, a newline would make the header unsendable.
--
-- DEFAULT '{}' = no outside site. Existing organizations start there: their
-- widget keeps working inside Dropin (the studio preview) and on the "link"
-- install option (a link opens it in its own tab, which frame-ancestors does
-- not govern), and stops rendering inside other sites until they add theirs.
-- Production had no external embeds when this shipped (one widget_view in
-- analytics_events, with no referrer).
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN embed_allowed_hosts TEXT[] NOT NULL DEFAULT '{}';

-- One regex per element, without a helper function: array_to_string with a
-- separator that the pattern itself forbids, matched as a whole. The empty
-- array yields '' and is allowed by the leading `^$` alternative — which would
-- also let `{""}` through, hence the array_position clause.
ALTER TABLE organizations
  ADD CONSTRAINT organizations_embed_allowed_hosts_format CHECK (
    cardinality(embed_allowed_hosts) <= 25
    AND array_position(embed_allowed_hosts, '') IS NULL
    AND array_to_string(embed_allowed_hosts, ' ') ~
      '^$|^((\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(:[0-9]{1,5})?( |$))+$'
  );

COMMENT ON COLUMN organizations.embed_allowed_hosts IS
  'Websites allowed to show the embedded widget (CSP frame-ancestors). Bare lowercase hosts, optional *. prefix and :port. Empty = only Dropin itself.';

-- -----------------------------------------------------------------------------
-- Anonymous read of exactly this column
-- -----------------------------------------------------------------------------
-- `organizations` is members-only (migration 026) and the widget is loaded by
-- the public, so the proxy reads the list through this function rather than
-- the table. It returns nothing else about the organization. The list is not
-- a secret in any case: it is sent to every visitor in the widget's own CSP
-- header.
--
-- Status is not checked: whether the widget renders at all is the widget
-- page's decision, and this only says where it may be framed.
--
-- An unknown organization returns an empty list, i.e. 'self'
-- only — never an error the caller might treat as "unrestricted".
CREATE OR REPLACE FUNCTION public.widget_frame_ancestors(p_org_id UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT embed_allowed_hosts FROM organizations WHERE id = p_org_id),
    '{}'::TEXT[]
  );
$$;

REVOKE ALL ON FUNCTION public.widget_frame_ancestors(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.widget_frame_ancestors(UUID) TO anon, authenticated;
