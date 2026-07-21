-- =============================================================================
-- Migration 003: Indexes
-- =============================================================================
-- Performance indexes for the most common query patterns in Dropin.
-- =============================================================================

-- Geo radius search: "find facilities near me"
CREATE INDEX idx_facilities_location ON facilities USING GIST (location);

-- Org-scoped dashboard queries (all dashboard pages filter by org_id)
CREATE INDEX idx_facilities_org_id ON facilities (org_id);
CREATE INDEX idx_programs_org_id ON programs (org_id);
CREATE INDEX idx_programs_facility_id ON programs (facility_id);
CREATE INDEX idx_sessions_program_id ON sessions (program_id);
CREATE INDEX idx_sessions_org_id ON sessions (org_id);
CREATE INDEX idx_session_exceptions_session_id ON session_exceptions (session_id);
CREATE INDEX idx_org_memberships_user_id ON org_memberships (user_id);
CREATE INDEX idx_org_memberships_org_id ON org_memberships (org_id);

-- Public discovery: sport category filter on published programs
CREATE INDEX idx_programs_sport_published ON programs (sport_category, is_published);

-- Session expansion: filter by season date range
CREATE INDEX idx_sessions_valid_range ON sessions (valid_from, valid_until);

-- Scraping staleness detection
CREATE INDEX idx_sessions_last_synced ON sessions (last_synced_at)
  WHERE source = 'scraped';
CREATE INDEX idx_programs_last_synced ON programs (last_synced_at)
  WHERE source = 'scraped';

-- Slug lookups (used in public URL routing)
CREATE INDEX idx_organizations_slug ON organizations (slug);
CREATE INDEX idx_facilities_slug ON facilities (slug);

-- Invitation token lookup (accept invite flow)
CREATE INDEX idx_invitations_token ON staff_invitations (token);
