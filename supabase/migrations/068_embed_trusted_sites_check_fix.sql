-- =============================================================================
-- 068: close a gap in 067's trusted-host CHECK
-- =============================================================================
--
-- 067 validated the list by joining it with spaces and matching the whole
-- string. A single element containing a space — {"a.com b.com"} — joins to
-- exactly the same string as the valid pair {"a.com","b.com"}, so it passed.
-- verify-bj caught it with a direct service-role write.
--
-- It never reached a header (proxy.ts re-validates every element and drops
-- that one), but the CHECK is meant to hold on its own. Joining with the empty
-- string instead exposes any space inside an element, since the pattern
-- forbids spaces everywhere else.
-- =============================================================================

ALTER TABLE organizations
  DROP CONSTRAINT organizations_embed_allowed_hosts_format;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_embed_allowed_hosts_format CHECK (
    cardinality(embed_allowed_hosts) <= 25
    AND array_position(embed_allowed_hosts, '') IS NULL
    AND position(' ' IN array_to_string(embed_allowed_hosts, '')) = 0
    AND array_to_string(embed_allowed_hosts, ' ') ~
      '^$|^((\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(:[0-9]{1,5})?( |$))+$'
  );
