-- Crash Intelligence Schema — SQLite
-- Datos: California CCRS 2025 (crashes, parties, injured)
-- Unidad de análisis: CollisionId

-- Tabla principal: accidentes
CREATE TABLE IF NOT EXISTS crashes (
    collision_id INTEGER PRIMARY KEY,
    report_number TEXT,
    crash_datetime TEXT,          -- ISO 8601
    crash_date TEXT,              -- YYYY-MM-DD
    crash_time TEXT,              -- HH:MM
    day_of_week TEXT,
    city_name TEXT,
    county_code INTEGER,
    city_id INTEGER,
    latitude REAL,
    longitude REAL,
    collision_type_code TEXT,
    collision_type_desc TEXT,     -- REAR END, HEAD-ON, SIDESWIPE, BROADSIDE, etc.
    is_highway BOOLEAN,
    is_tow_away BOOLEAN,
    number_injured INTEGER,
    number_killed INTEGER,
    weather1 TEXT,
    weather2 TEXT,
    road_condition1 TEXT,
    road_condition2 TEXT,
    lighting_code TEXT,
    primary_road TEXT,
    secondary_road TEXT,
    primary_collision_factor TEXT,
    primary_collision_violation TEXT,
    motor_vehicle_involved_code TEXT,
    motor_vehicle_involved_desc TEXT,
    roadway_surface_code TEXT,
    hit_and_run BOOLEAN,
    is_freeway BOOLEAN,
    reporting_district TEXT,
    judicial_district TEXT,
    created_date TEXT,
    modified_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_crashes_date ON crashes(crash_date);
CREATE INDEX IF NOT EXISTS idx_crashes_city ON crashes(city_name);
CREATE INDEX IF NOT EXISTS idx_crashes_county ON crashes(county_code);
CREATE INDEX IF NOT EXISTS idx_crashes_latlon ON crashes(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_crashes_type ON crashes(collision_type_desc);
CREATE INDEX IF NOT EXISTS idx_crashes_injured ON crashes(number_injured);
CREATE INDEX IF NOT EXISTS idx_crashes_killed ON crashes(number_killed);

-- Vehículos involucrados
CREATE TABLE IF NOT EXISTS parties (
    party_id INTEGER PRIMARY KEY,
    collision_id INTEGER NOT NULL REFERENCES crashes(collision_id),
    party_number INTEGER,
    party_type TEXT,
    is_at_fault BOOLEAN,
    is_hit_and_run BOOLEAN,
    airbag_code TEXT,
    airbag_desc TEXT,
    safety_equipment_code TEXT,
    safety_equipment_desc TEXT,
    sobriety_code1 TEXT,
    sobriety_desc1 TEXT,
    gender_code TEXT,
    gender_desc TEXT,
    stated_age INTEGER,
    driver_license_class TEXT,
    driver_license_state TEXT,
    race_code TEXT,
    race_desc TEXT,
    -- Vehicle 1
    vehicle_type_id INTEGER,
    vehicle_type_desc TEXT,
    vehicle_year INTEGER,
    vehicle_make_code TEXT,
    vehicle_make TEXT,            -- decoded
    vehicle_model TEXT,
    vehicle_color TEXT,
    is_vehicle_towed BOOLEAN,
    -- Vehicle 2 (if applicable)
    vehicle2_type_id INTEGER,
    vehicle2_type_desc TEXT,
    vehicle2_year INTEGER,
    vehicle2_make_code TEXT,
    vehicle2_make TEXT,           -- decoded
    vehicle2_model TEXT,
    vehicle2_color TEXT,
    is_vehicle2_towed BOOLEAN,
    -- Road
    direction_of_travel TEXT,
    street_or_highway TEXT,
    speed_limit INTEGER,
    lane INTEGER,
    thru_lanes INTEGER,
    total_lanes INTEGER,
    movement_pre_collision_code TEXT,
    movement_pre_collision_desc TEXT,
    special_information TEXT,
    inattention TEXT,
    is_dre_conducted BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_parties_collision ON parties(collision_id);
CREATE INDEX IF NOT EXISTS idx_parties_make ON parties(vehicle_make);
CREATE INDEX IF NOT EXISTS idx_parties_year ON parties(vehicle_year);
CREATE INDEX IF NOT EXISTS idx_parties_fault ON parties(is_at_fault);
CREATE INDEX IF NOT EXISTS idx_parties_age ON parties(stated_age);

-- Personas lesionadas / testigos / pasajeros
CREATE TABLE IF NOT EXISTS injured (
    collision_id INTEGER NOT NULL REFERENCES crashes(collision_id),
    injured_wit_pass_id TEXT PRIMARY KEY,
    stated_age INTEGER,
    gender_code TEXT,
    gender_desc TEXT,
    race_code TEXT,
    race_desc TEXT,
    is_witness_only BOOLEAN,
    is_passenger_only BOOLEAN,
    extent_of_injury_code TEXT,
    extent_of_injury_desc TEXT,
    injured_person_type TEXT,
    seat_position TEXT,
    seat_position_desc TEXT,
    airbag_code TEXT,
    airbag_desc TEXT,
    safety_equipment_code TEXT,
    safety_equipment_desc TEXT,
    is_ejected BOOLEAN,
    is_vovc_notified BOOLEAN,
    party_number INTEGER
);

CREATE INDEX IF NOT EXISTS idx_injured_collision ON injured(collision_id);
CREATE INDEX IF NOT EXISTS idx_injured_severity ON injured(extent_of_injury_code);
CREATE INDEX IF NOT EXISTS idx_injured_age ON injured(stated_age);

-- Tabla de lookup: códigos de marca → nombre completo
CREATE TABLE IF NOT EXISTS vehicle_make_lookup (
    make_code TEXT PRIMARY KEY,
    make_name TEXT NOT NULL,
    vehicle_type TEXT,
    source TEXT DEFAULT 'vpic_api'
);

-- Vistas útiles

-- Accidentes por ciudad (top 20)
CREATE VIEW IF NOT EXISTS v_crashes_by_city AS
SELECT city_name, county_code, COUNT(*) as total_crashes,
       SUM(number_injured) as total_injured,
       SUM(number_killed) as total_killed,
       ROUND(AVG(number_injured), 2) as avg_injured
FROM crashes
WHERE city_name IS NOT NULL AND city_name != ''
GROUP BY city_name, county_code
ORDER BY total_crashes DESC;

-- Marcas más involucradas en accidentes
CREATE VIEW IF NOT EXISTS v_top_makes AS
SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
       COUNT(*) as crash_count,
       ROUND(AVG(p.stated_age), 1) as avg_driver_age,
       SUM(CASE WHEN p.is_at_fault = 'True' THEN 1 ELSE 0 END) as at_fault_count
FROM parties p
LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
WHERE p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code != ''
GROUP BY UPPER(COALESCE(l.make_name, p.vehicle_make_code))
ORDER BY crash_count DESC;

-- Tipos de colisión más comunes
CREATE VIEW IF NOT EXISTS v_collision_types AS
SELECT collision_type_desc,
       COUNT(*) as total,
       SUM(number_injured) as total_injured,
       SUM(number_killed) as total_killed,
       ROUND(AVG(CASE WHEN number_injured > 0 THEN 1.0 ELSE 0.0 END) * 100, 1) as pct_with_injury
FROM crashes
WHERE collision_type_desc IS NOT NULL AND collision_type_desc != ''
GROUP BY collision_type_desc
ORDER BY total DESC;
