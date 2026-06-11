-- ============================================================================
-- ACG COMMAND CENTER — COMBINED SETUP (copy-paste into Supabase SQL Editor)
-- https://supabase.com/dashboard/project/fhabtjhxkicshlrybryi/sql/new
-- ============================================================================

-- Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA public;

-- ============================================================================
-- 1. LOCATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS locations (
    location_id   TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    address       TEXT,
    city          TEXT,
    phone_main    TEXT,
    timezone      TEXT DEFAULT 'America/Los_Angeles',
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 2. NUMBER REGISTRY
-- ============================================================================
CREATE TABLE IF NOT EXISTS number_registry (
    twilio_number   TEXT PRIMARY KEY,
    location_id     TEXT NOT NULL REFERENCES locations(location_id),
    channel         TEXT NOT NULL,
    display_name    TEXT,
    active          BOOLEAN DEFAULT true,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_number_registry_location ON number_registry(location_id);
CREATE INDEX IF NOT EXISTS idx_number_registry_channel ON number_registry(channel);

-- ============================================================================
-- 3. CALLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS calls (
    call_sid        TEXT PRIMARY KEY,
    to_number       TEXT,
    from_number     TEXT,
    direction       TEXT,
    duration_sec    INTEGER,
    status          TEXT,
    recording_url   TEXT,
    transcript      TEXT,
    occurred_at     TIMESTAMPTZ,
    ingested_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_to_number ON calls(to_number);
CREATE INDEX IF NOT EXISTS idx_calls_from_number ON calls(from_number);
CREATE INDEX IF NOT EXISTS idx_calls_occurred_at ON calls(occurred_at);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);

-- ============================================================================
-- 4. MESSAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
    message_sid     TEXT PRIMARY KEY,
    to_number       TEXT,
    from_number     TEXT,
    direction       TEXT,
    body            TEXT,
    num_segments    INTEGER,
    status          TEXT,
    occurred_at     TIMESTAMPTZ,
    ingested_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_to_number ON messages(to_number);
CREATE INDEX IF NOT EXISTS idx_messages_from_number ON messages(from_number);
CREATE INDEX IF NOT EXISTS idx_messages_occurred_at ON messages(occurred_at);

-- ============================================================================
-- 5. APPOINTMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id  TEXT PRIMARY KEY,
    customer_phone  TEXT,
    customer_name   TEXT,
    location_id     TEXT,
    source          TEXT,
    scheduled_at    TIMESTAMPTZ,
    arrived         BOOLEAN,
    no_show         BOOLEAN,
    drop_off        BOOLEAN,
    drop_off_at     TIMESTAMPTZ,
    vehicle_make    TEXT,
    vehicle_model   TEXT,
    vehicle_year    INTEGER,
    estimated_value NUMERIC,
    raw_data        JSONB,
    ingested_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(customer_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_location ON appointments(location_id);
CREATE INDEX IF NOT EXISTS idx_appointments_source ON appointments(source);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_drop_off ON appointments(drop_off) WHERE drop_off = true;

-- ============================================================================
-- 6. AD SPEND
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_spend (
    id              BIGSERIAL PRIMARY KEY,
    channel         TEXT NOT NULL,
    location_id     TEXT REFERENCES locations(location_id),
    campaign_id     TEXT,
    campaign_name   TEXT,
    ad_set_name     TEXT,
    date            DATE NOT NULL,
    spend           NUMERIC DEFAULT 0,
    impressions     INTEGER DEFAULT 0,
    clicks          INTEGER DEFAULT 0,
    conversions     INTEGER DEFAULT 0,
    calls_reported  INTEGER DEFAULT 0,
    raw_data        JSONB,
    ingested_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE(channel, campaign_id, location_id, date)
);
CREATE INDEX IF NOT EXISTS idx_ad_spend_channel ON ad_spend(channel);
CREATE INDEX IF NOT EXISTS idx_ad_spend_location ON ad_spend(location_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_date ON ad_spend(date);

-- ============================================================================
-- 7. CUSTOMER JOURNEY
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_journey (
    journey_id              BIGSERIAL PRIMARY KEY,
    customer_phone          TEXT NOT NULL,
    normalized_phone        TEXT,
    attributed_channel      TEXT,
    attributed_location     TEXT,
    first_touch_at          TIMESTAMPTZ,
    last_touch_at           TIMESTAMPTZ,
    appointment_id          TEXT REFERENCES appointments(appointment_id),
    drop_off                BOOLEAN,
    drop_off_at             TIMESTAMPTZ,
    attribution_method      TEXT DEFAULT 'pending',
    confidence              NUMERIC DEFAULT 0,
    touchpoints             JSONB,
    lookback_days           INTEGER DEFAULT 90,
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_phone ON customer_journey(customer_phone);
CREATE INDEX IF NOT EXISTS idx_journey_channel ON customer_journey(attributed_channel);
CREATE INDEX IF NOT EXISTS idx_journey_location ON customer_journey(attributed_location);
CREATE INDEX IF NOT EXISTS idx_journey_drop_off ON customer_journey(drop_off) WHERE drop_off = true;
CREATE INDEX IF NOT EXISTS idx_journey_attribution ON customer_journey(attribution_method);

-- ============================================================================
-- 8. RECOMMENDATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS recommendations (
    id              BIGSERIAL PRIMARY KEY,
    generated_at    TIMESTAMPTZ DEFAULT now(),
    agent           TEXT NOT NULL,
    type            TEXT,
    location_id     TEXT,
    channel         TEXT,
    severity        TEXT DEFAULT 'info',
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    supporting_data JSONB,
    confidence      NUMERIC DEFAULT 0,
    status          TEXT DEFAULT 'new',
    actioned_at     TIMESTAMPTZ,
    actioned_by     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(status);
CREATE INDEX IF NOT EXISTS idx_recommendations_severity ON recommendations(severity);
CREATE INDEX IF NOT EXISTS idx_recommendations_agent ON recommendations(agent);
CREATE INDEX IF NOT EXISTS idx_recommendations_location ON recommendations(location_id);

-- ============================================================================
-- 9. INGESTION LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS ingestion_log (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    records_fetched INTEGER DEFAULT 0,
    records_new     INTEGER DEFAULT 0,
    records_errors  INTEGER DEFAULT 0,
    error_message   TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 10. METRIC CACHE
-- ============================================================================
CREATE TABLE IF NOT EXISTS metric_cache (
    metric_name         TEXT NOT NULL,
    location_id         TEXT,
    channel             TEXT,
    period_start        DATE,
    period_end          DATE,
    metric_value        NUMERIC,
    numerator           NUMERIC,
    denominator         NUMERIC,
    supporting_data     JSONB,
    computed_at         TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (metric_name, location_id, channel, period_start, period_end)
);

-- ============================================================================
-- VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW daily_location_channel_summary AS
SELECT
    cj.attributed_location AS location_id,
    cj.attributed_channel AS channel,
    date_trunc('day', cj.drop_off_at) AS drop_off_date,
    COUNT(*) FILTER (WHERE cj.drop_off = true) AS drop_offs,
    COUNT(DISTINCT cj.appointment_id) AS appointments,
    COUNT(DISTINCT cj.customer_phone) AS unique_customers
FROM customer_journey cj
WHERE cj.drop_off = true
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW unattributed_calls AS
SELECT
    c.call_sid,
    c.to_number,
    c.from_number,
    c.occurred_at,
    c.status
FROM calls c
LEFT JOIN number_registry nr ON c.to_number = nr.twilio_number
WHERE nr.twilio_number IS NULL
  AND c.occurred_at > now() - INTERVAL '7 days';

-- ============================================================================
-- SEED: 13 Locations
-- ============================================================================
INSERT INTO locations (location_id, name, city, phone_main, active) VALUES
('whittier',      'ACG Whittier',          'Whittier',          '833-333-4224', true),
('bakersfield_1', 'ACG Bakersfield #1',    'Bakersfield',       '833-333-4224', true),
('bakersfield_2', 'ACG Bakersfield #2',    'Bakersfield',       '833-333-4224', true),
('covina',        'ACG Covina',            'Covina',            '833-333-4224', true),
('fresno',        'ACG Fresno',            'Fresno',            '833-333-4224', true),
('gardena_1',     'ACG Gardena #1',        'Gardena',           '833-333-4224', true),
('gardena_2',     'ACG Gardena #2',        'Gardena',           '833-333-4224', true),
('ontario',       'ACG Ontario',           'Ontario',           '833-333-4224', true),
('santa_ana',     'ACG Santa Ana',         'Santa Ana',         '833-333-4224', true),
('victorville',   'ACG Victorville',       'Victorville',       '833-333-4224', true),
('los_angeles',   'ACG Los Angeles',       'Los Angeles',       '833-333-4224', true),
('rancho_cucamonga', 'ACG Rancho Cucamonga', 'Rancho Cucamonga', '833-333-4224', true),
('el_cajon',      'ACG El Cajon',          'El Cajon',          '833-333-4224', true)
ON CONFLICT (location_id) DO UPDATE SET
    name = EXCLUDED.name,
    city = EXCLUDED.city,
    active = EXCLUDED.active;
