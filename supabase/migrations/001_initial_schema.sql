-- =============================================================================
-- Migration 001: Initial Schema
-- =============================================================================
-- Creates the core tables for Dropin: organizations, facilities, programs,
-- sessions, and session exceptions.
--
-- Design notes:
--   - RLS is enabled on every table immediately (no policy = deny all by default)
--   - Sessions store recurrence rules (RRULE strings) rather than individual
--     occurrences. Expansion to concrete dates happens at query time.
--   - Every Program and Session tracks its data source (manual/scraped/imported)
--     to support conflict detection and staleness warnings.
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable PostGIS for geo queries (facility radius search)
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- ORGANIZATIONS
-- =============================================================================
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  logo_url      TEXT,
  website_url   TEXT,
  phone         TEXT,
  email         TEXT,
  address_line1 TEXT,
  city          TEXT,
  province      TEXT,
  postal_code   TEXT,
  country       TEXT NOT NULL DEFAULT 'CA',
  -- pending: newly registered, awaiting admin approval
  -- active: approved and visible on the platform
  -- suspended: access revoked
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'suspended')),
  approved_at   TIMESTAMPTZ,
  approved_by   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ORG MEMBERSHIPS (staff access)
-- =============================================================================
CREATE TABLE org_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- owner: full control, set only at org creation (never via UI)
  -- admin: can manage facilities, programs, staff
  -- member: read + schedule editing only
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  invited_by  UUID REFERENCES auth.users(id),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- STAFF INVITATIONS
-- =============================================================================
CREATE TABLE staff_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('admin', 'member')),
  -- 32-byte random hex token — generated in DB, never in application code
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by  UUID NOT NULL REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- FACILITIES (physical locations)
-- =============================================================================
CREATE TABLE facilities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  address_line1 TEXT NOT NULL,
  city          TEXT NOT NULL,
  province      TEXT NOT NULL,
  postal_code   TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'CA',
  -- Geocoded coordinates (populated on save via Mapbox geocoding API)
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  -- PostGIS point for radius search queries
  location      GEOGRAPHY(POINT, 4326),
  phone         TEXT,
  email         TEXT,
  website_url   TEXT,
  photo_urls    TEXT[] DEFAULT '{}',
  amenities     TEXT[] DEFAULT '{}',
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, slug)
);

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PROGRAMS (recurring activity types at a facility)
-- =============================================================================
CREATE TABLE programs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  -- Must match a value in SPORT_CATEGORIES (lib/utils/sport-categories.ts)
  sport_category  TEXT NOT NULL,
  activity_type   TEXT NOT NULL DEFAULT 'drop_in'
                  CHECK (activity_type IN ('drop_in', 'registered', 'open_gym')),
  age_group       TEXT,
  skill_level     TEXT,
  max_participants INTEGER,
  -- Stored in cents to avoid floating-point issues. 0 = free admission.
  cost_cents      INTEGER NOT NULL DEFAULT 0,
  cost_notes      TEXT,
  photo_urls      TEXT[] DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Ingestion tracking — how this program's data entered Dropin
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'scraped', 'imported')),
  source_url      TEXT,       -- Original URL for scraped programs
  external_id     TEXT,       -- ID in the source system (e.g. ActiveNet program ID)
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, slug)
);

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SESSIONS (recurring schedule rules for a program)
-- =============================================================================
-- Sessions store an iCal RRULE rather than individual event rows.
-- Example: "Lap Swim runs Mon/Wed/Fri 6:00-8:00 AM from Sept 1 to June 30"
-- is ONE session row, not 120 individual event rows.
--
-- Expansion to concrete dates for a given week range is done at query time
-- by lib/rrule/expand.ts using the 'rrule' npm package.
-- =============================================================================
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- iCal RRULE string (RFC 5545). Examples:
  --   "FREQ=WEEKLY;BYDAY=MO,WE,FR"           Mon/Wed/Fri weekly
  --   "FREQ=DAILY"                            Every day
  --   "FREQ=WEEKLY;BYDAY=SA,SU"              Weekends only
  rrule           TEXT NOT NULL,
  -- First occurrence as a full timestamp. The time component encodes the
  -- start time of each occurrence. Must include timezone offset.
  dtstart         TIMESTAMPTZ NOT NULL,
  -- End time of each occurrence (same calendar day — drop-in never spans midnight)
  dtend_time      TIME NOT NULL,
  -- IANA timezone identifier (e.g. "America/Edmonton")
  timezone        TEXT NOT NULL DEFAULT 'America/Edmonton',
  -- Season bounds — clamp the RRULE expansion range
  valid_from      DATE NOT NULL,
  valid_until     DATE,       -- NULL = runs indefinitely
  -- Optional sub-location within the facility
  location_detail TEXT,       -- e.g. "Lane 3", "Rink B", "Studio 2"
  -- Ingestion tracking (same pattern as programs)
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'scraped', 'imported')),
  source_url      TEXT,
  external_id     TEXT,
  last_synced_at  TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SESSION EXCEPTIONS (closures, cancellations, modifications)
-- =============================================================================
-- Overrides specific occurrences of a recurring session without changing the
-- underlying RRULE. Used for holiday closures, special event substitutions, etc.
-- =============================================================================
CREATE TABLE session_exceptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The specific occurrence date being overridden
  exception_date  DATE NOT NULL,
  -- cancelled: this occurrence does not happen (hidden from schedule)
  -- modified: this occurrence has different start/end times
  -- added: a one-time extra occurrence (not part of the RRULE)
  exception_type  TEXT NOT NULL
                  CHECK (exception_type IN ('cancelled', 'modified', 'added')),
  -- Populated only for 'modified' type
  modified_start  TIMESTAMPTZ,
  modified_end    TIMESTAMPTZ,
  -- Internal reason (visible to org staff)
  reason          TEXT,
  -- Public-facing note shown in the schedule widget
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, exception_date)
);

ALTER TABLE session_exceptions ENABLE ROW LEVEL SECURITY;
