-- ============================================================================
-- ACG COMMAND CENTER — Schema Base (v1)
-- Centro de Inteligencia Publicitaria Autónoma
-- ============================================================================

-- Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA public;  -- pgvector, para v2

-- ============================================================================
-- 1. LOCATIONS
-- ============================================================================
CREATE TABLE locations (
    location_id   TEXT PRIMARY KEY,       -- slug: 'whittier', 'ontario', etc.
    name          TEXT NOT NULL,          -- nombre comercial
    address       TEXT,
    city          TEXT,
    phone_main    TEXT,                   -- número principal de la location
    timezone      TEXT DEFAULT 'America/Los_Angeles',
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 2. NUMBER REGISTRY (la piedra rosetta)
-- Traduce número Twilio → location + canal. Determinístico, no probabilístico.
-- ============================================================================
CREATE TABLE number_registry (
    twilio_number   TEXT PRIMARY KEY,      -- formato E.164: +19095551234
    location_id     TEXT NOT NULL REFERENCES locations(location_id),
    channel         TEXT NOT NULL,         -- 'facebook' | 'website' | 'gmb' | 'google_maps' | 'google_ads' | 'other'
    display_name    TEXT,                  -- etiqueta amigable: "Whittier - Facebook"
    active          BOOLEAN DEFAULT true,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_number_registry_location ON number_registry(location_id);
CREATE INDEX idx_number_registry_channel ON number_registry(channel);

-- ============================================================================
-- 3. CALLS (desde Twilio)
-- ============================================================================
CREATE TABLE calls (
    call_sid        TEXT PRIMARY KEY,
    to_number       TEXT,                  -- número de tracking (→ number_registry)
    from_number     TEXT,                  -- caller ID = teléfono cliente
    direction       TEXT,                  -- 'inbound' | 'outbound'
    duration_sec    INTEGER,
    status          TEXT,                  -- completed | missed | busy | no-answer | failed | canceled
    recording_url   TEXT,
    transcript      TEXT,                  -- transcripción de Twilio si disponible
    occurred_at     TIMESTAMPTZ,
    ingested_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calls_to_number ON calls(to_number);
CREATE INDEX idx_calls_from_number ON calls(from_number);
CREATE INDEX idx_calls_occurred_at ON calls(occurred_at);
CREATE INDEX idx_calls_status ON calls(status);

-- ============================================================================
-- 4. MESSAGES (SMS desde Twilio)
-- ============================================================================
CREATE TABLE messages (
    message_sid     TEXT PRIMARY KEY,
    to_number       TEXT,                  -- número de tracking (→ number_registry)
    from_number     TEXT,                  -- teléfono cliente
    direction       TEXT,                  -- 'inbound' | 'outbound'
    body            TEXT,
    num_segments    INTEGER,
    status          TEXT,
    occurred_at     TIMESTAMPTZ,
    ingested_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_to_number ON messages(to_number);
CREATE INDEX idx_messages_from_number ON messages(from_number);
CREATE INDEX idx_messages_occurred_at ON messages(occurred_at);

-- ============================================================================
-- 5. APPOINTMENTS (desde CRM Replit)
-- Aquí es donde hay que validar contra el esquema real del CRM.
-- Campos marcados con (*) son supuestos a confirmar.
-- ============================================================================
CREATE TABLE appointments (
    appointment_id  TEXT PRIMARY KEY,      -- ID del CRM
    customer_phone  TEXT,                  -- teléfono cliente — llave maestra 🔑
    customer_name   TEXT,
    location_id     TEXT,                  -- location según CRM
    source          TEXT,                  -- canal según CRM: 'Facebook', 'Google', 'Website', etc.
    scheduled_at    TIMESTAMPTZ,           -- cuándo está agendada la cita
    arrived         BOOLEAN,               -- ¿llegó a la cita?
    no_show         BOOLEAN,               -- ¿no se presentó?
    drop_off        BOOLEAN,               -- ¿dejó el carro? ← LA MÉTRICA QUE IMPORTA
    drop_off_at     TIMESTAMPTZ,           -- cuándo dejó el carro
    vehicle_make    TEXT,
    vehicle_model   TEXT,
    vehicle_year    INTEGER,
    estimated_value NUMERIC,               -- valor estimado de reparación
    raw_data        JSONB,                 -- data original del CRM (para no perder nada)
    ingested_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_appointments_phone ON appointments(customer_phone);
CREATE INDEX idx_appointments_location ON appointments(location_id);
CREATE INDEX idx_appointments_source ON appointments(source);
CREATE INDEX idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX idx_appointments_drop_off ON appointments(drop_off) WHERE drop_off = true;

-- ============================================================================
-- 6. AD SPEND (Google Ads + Meta + otros)
-- ============================================================================
CREATE TABLE ad_spend (
    id              BIGSERIAL PRIMARY KEY,
    channel         TEXT NOT NULL,         -- 'google_ads' | 'meta' | ...
    location_id     TEXT REFERENCES locations(location_id),
    campaign_id     TEXT,
    campaign_name   TEXT,
    ad_set_name     TEXT,
    date            DATE NOT NULL,
    spend           NUMERIC DEFAULT 0,
    impressions     INTEGER DEFAULT 0,
    clicks          INTEGER DEFAULT 0,
    conversions     INTEGER DEFAULT 0,
    calls_reported  INTEGER DEFAULT 0,    -- llamadas reportadas por la plataforma
    raw_data        JSONB,
    ingested_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE(channel, campaign_id, location_id, date)
);
CREATE INDEX idx_ad_spend_channel ON ad_spend(channel);
CREATE INDEX idx_ad_spend_location ON ad_spend(location_id);
CREATE INDEX idx_ad_spend_date ON ad_spend(date);

-- ============================================================================
-- 7. CUSTOMER JOURNEY (tabla resuelta — el viaje del cliente unificado)
-- Esta es la tabla que los agentes consultan. Es el output del identity resolver.
-- ============================================================================
CREATE TABLE customer_journey (
    journey_id              BIGSERIAL PRIMARY KEY,
    customer_phone          TEXT NOT NULL,
    normalized_phone        TEXT,          -- E.164 normalizado
    attributed_channel      TEXT,          -- canal atribuido
    attributed_location     TEXT,          -- location atribuida
    first_touch_at          TIMESTAMPTZ,   -- primera interacción en ventana
    last_touch_at           TIMESTAMPTZ,   -- última interacción antes del appointment
    appointment_id          TEXT REFERENCES appointments(appointment_id),
    drop_off                BOOLEAN,
    drop_off_at             TIMESTAMPTZ,
    attribution_method      TEXT DEFAULT 'pending',  -- 'phone_match' | 'source_field' | 'time_location_tiebreak' | 'unattributed'
    confidence              NUMERIC DEFAULT 0,       -- 0..1
    touchpoints             JSONB,          -- array de interacciones: [{type, to_number, channel, occurred_at}]
    lookback_days           INTEGER DEFAULT 90,
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_journey_phone ON customer_journey(customer_phone);
CREATE INDEX idx_journey_channel ON customer_journey(attributed_channel);
CREATE INDEX idx_journey_location ON customer_journey(attributed_location);
CREATE INDEX idx_journey_drop_off ON customer_journey(drop_off) WHERE drop_off = true;
CREATE INDEX idx_journey_attribution ON customer_journey(attribution_method);

-- ============================================================================
-- 8. RECOMMENDATIONS (salida de los agentes de IA)
-- ============================================================================
CREATE TABLE recommendations (
    id              BIGSERIAL PRIMARY KEY,
    generated_at    TIMESTAMPTZ DEFAULT now(),
    agent           TEXT NOT NULL,         -- 'attribution' | 'funnel_leak' | 'budget' | 'orchestrator'
    type            TEXT,                  -- 'pause_channel' | 'increase_budget' | 'geo_opportunity' | 'script_review' | ...
    location_id     TEXT,
    channel         TEXT,
    severity        TEXT DEFAULT 'info',   -- 'info' | 'warning' | 'critical'
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,         -- en español, voz de Raúl
    supporting_data JSONB,                -- los números exactos que la sustentan 🔑
    confidence      NUMERIC DEFAULT 0,
    status          TEXT DEFAULT 'new',    -- 'new' | 'reviewed' | 'actioned' | 'dismissed'
    actioned_at     TIMESTAMPTZ,
    actioned_by     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_recommendations_severity ON recommendations(severity);
CREATE INDEX idx_recommendations_agent ON recommendations(agent);
CREATE INDEX idx_recommendations_location ON recommendations(location_id);

-- ============================================================================
-- 9. INGESTION LOG (para trazabilidad y debugging)
-- ============================================================================
CREATE TABLE ingestion_log (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL,         -- 'twilio_calls' | 'twilio_messages' | 'crm_appointments' | 'google_ads' | 'meta'
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
-- 10. METRICAS CANÓNICAS (vista materializada o tabla cache)
-- Capa semántica — definición ÚNICA de cada métrica. Todos los agentes beben de aquí.
-- ============================================================================
CREATE TABLE metric_cache (
    metric_name         TEXT NOT NULL,     -- 'costo_por_drop_off' | 'tasa_conversion' | 'drop_offs_totales'
    location_id         TEXT,
    channel             TEXT,
    period_start        DATE,
    period_end          DATE,
    metric_value        NUMERIC,
    numerator           NUMERIC,           -- para trazabilidad
    denominator         NUMERIC,           -- para trazabilidad
    supporting_data     JSONB,
    computed_at         TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (metric_name, location_id, channel, period_start, period_end)
);

-- ============================================================================
-- VIEW: Resumen diario para briefings
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

-- ============================================================================
-- VIEW: Alertas de números sin atribuir (para monitoreo)
-- ============================================================================
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
