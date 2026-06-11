-- ============================================================================
-- SEED: 13 Locations de ACG
-- Fuente: CLAUDE.md + verificación con Raúl
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

-- ============================================================================
-- SEED: Canales estándar por location
-- Se documentan los canales esperados. Los números reales se cargan cuando
-- Raúl pase el mapeo o se extraigan vía Twilio API.
-- ============================================================================

-- Canales típicos que esperamos por location:
-- 'website'     → número en el sitio web
-- 'gmb'         → Google My Business / Google Maps
-- 'facebook'    → Facebook/Instagram Ads + orgánico
-- 'google_ads'  → Google Ads (call extensions)
-- 'other'       → flyers, letreros, referrals

-- NOTA: El number_registry se poblará con data REAL cuando Raúl proporcione el
-- mapeo o lo extraigamos vía Twilio API + validación manual.
