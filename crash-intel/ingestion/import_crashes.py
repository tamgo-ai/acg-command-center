#!/usr/bin/env python3
"""
Crash Data Importer — California CCRS 2025
Procesa 3 archivos CSV (crashes, parties, injured) → SQLite
Streaming, batch inserts, column cleaning.
"""
import csv
import sqlite3
import os
import re
import sys
import time
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data" / "ACCIDENTS DATA"
DB_PATH = Path(__file__).parent.parent / "data" / "crash_intel.db"

BATCH_SIZE = 25000  # rows per commit

# ── Column cleaners ───────────────────────────────────────────────────────────

def clean_col(name: str | None) -> str:
    """Remove leading/trailing whitespace and tabs from column names."""
    if name is None:
        return ''
    return name.strip().strip('\t').strip()

def clean_value(val: str) -> any:
    """Clean a single value: strip, convert empty to None."""
    v = val.strip()
    if v == '' or v == ' ' or v == '\t':
        return None
    return v

def safe_int(val) -> int | None:
    try:
        return int(val)
    except (ValueError, TypeError):
        return None

def safe_float(val) -> float | None:
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def safe_bool(val) -> bool | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    v = str(val).strip().lower()
    if v in ('true', 't', 'yes', 'y', '1'):
        return True
    if v in ('false', 'f', 'no', 'n', '0'):
        return False
    return None

def parse_datetime(val: str) -> tuple[str | None, str | None, str | None]:
    """Parse '1/14/2025 7:50:00 AM' → (iso_datetime, date, time)."""
    if not val:
        return None, None, None
    try:
        from datetime import datetime
        dt = datetime.strptime(val.strip(), "%m/%d/%Y %I:%M:%S %p")
        return dt.isoformat(), dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")
    except ValueError:
        return val.strip(), None, None


# ── Import Functions ──────────────────────────────────────────────────────────

def import_crashes(conn: sqlite3.Connection, year: str = "2025") -> int:
    """Import crashes_YYYY.csv → crashes table. Returns row count."""
    filepath = DATA_DIR / f"crashes_{year}.csv"
    if not filepath.exists():
        print(f"❌  {filepath} no encontrado")
        return 0

    print(f"📥 Importando crashes ({filepath.stat().st_size / 1024 / 1024:.0f} MB)...")

    # Map CSV column → DB column
    col_map = {
        "Collision Id": "collision_id",
        "Report Number": "report_number",
        "Crash Date Time": "crash_datetime",
        "Day Of Week": "day_of_week",
        "City Name": "city_name",
        "County Code": "county_code",
        "City Id": "city_id",
        "Latitude": "latitude",
        "Longitude": "longitude",
        "Collision Type Code": "collision_type_code",
        "Collision Type Description": "collision_type_desc",
        "IsHighwayRelated": "is_highway",
        "IsTowAway": "is_tow_away",
        "NumberInjured": "number_injured",
        "NumberKilled": "number_killed",
        "Weather 1": "weather1",
        "Weather 2": "weather2",
        "Road Condition 1": "road_condition1",
        "Road Condition 2": "road_condition2",
        "LightingCode": "lighting_code",
        "PrimaryRoad": "primary_road",
        "SecondaryRoad": "secondary_road",
        "Primary Collision Factor Code": "primary_collision_factor",
        "Primary Collision Factor Violation": "primary_collision_violation",
        "MotorVehicleInvolvedWithCode": "motor_vehicle_involved_code",
        "MotorVehicleInvolvedWithDesc": "motor_vehicle_involved_desc",
        "RoadwaySurfaceCode": "roadway_surface_code",
        "HitRun": "hit_and_run",
        "IsFreeway": "is_freeway",
        "ReportingDistrict": "reporting_district",
        "JudicialDistrict": "judicial_district",
        "CreatedDate": "created_date",
        "ModifiedDate": "modified_date",
    }

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        raw_cols = [clean_col(c) for c in reader.fieldnames]

        rows = []
        count = 0
        for row in reader:
            clean_row = {}
            for raw_k, v in row.items():
                k_clean = clean_col(raw_k)
                if k_clean not in col_map:
                    continue
                db_col = col_map[k_clean]
                v_clean = clean_value(v)

                # Type conversions
                if db_col == 'crash_datetime':
                    iso, date, time_ = parse_datetime(v_clean or "")
                    clean_row['crash_datetime'] = iso
                    clean_row['crash_date'] = date
                    clean_row['crash_time'] = time_
                elif db_col in ('latitude', 'longitude'):
                    clean_row[db_col] = safe_float(v_clean)
                elif db_col in ('number_injured', 'number_killed', 'county_code', 'city_id'):
                    clean_row[db_col] = safe_int(v_clean)
                elif db_col in ('is_highway', 'is_tow_away', 'is_freeway', 'hit_and_run'):
                    clean_row[db_col] = safe_bool(v_clean)
                else:
                    clean_row[db_col] = v_clean

            rows.append(clean_row)

            if len(rows) >= BATCH_SIZE:
                _insert_batch(conn, 'crashes', rows)
                count += len(rows)
                print(f"  crashes: {count:,} rows...")
                rows = []

        if rows:
            _insert_batch(conn, 'crashes', rows)
            count += len(rows)

    print(f"  ✅ crashes: {count:,} rows importados")
    return count


def import_parties(conn: sqlite3.Connection, year: str = "2025") -> int:
    """Import parties_YYYY.csv → parties table."""
    filepath = DATA_DIR / f"parties_{year}.csv"
    if not filepath.exists():
        print(f"❌  {filepath} no encontrado")
        return 0

    print(f"📥 Importando parties ({filepath.stat().st_size / 1024 / 1024:.0f} MB)...")

    col_map = {
        "PartyId": "party_id",
        "CollisionId": "collision_id",
        "PartyNumber": "party_number",
        "PartyType": "party_type",
        "IsAtFault": "is_at_fault",
        "IsHitAndRun": "is_hit_and_run",
        "AirbagCode": "airbag_code",
        "AirbagDescription": "airbag_desc",
        "SafetyEquipmentCode": "safety_equipment_code",
        "SafetyEquipmentDescription": "safety_equipment_desc",
        "SobrietyDrugPhysicalCode1": "sobriety_code1",
        "SobrietyDrugPhysicalDescription1": "sobriety_desc1",
        "GenderCode": "gender_code",
        "GenderDescription": "gender_desc",
        "StatedAge": "stated_age",
        "DriverLicenseClass": "driver_license_class",
        "DriverLicenseStateCode": "driver_license_state",
        "RaceCode": "race_code",
        "RaceDesc": "race_desc",
        "Vehicle1TypeId": "vehicle_type_id",
        "Vehicle1TypeDesc": "vehicle_type_desc",
        "Vehicle1Year": "vehicle_year",
        "Vehicle1Make": "vehicle_make_code",
        "Vehicle1Model": "vehicle_model",
        "Vehicle1Color": "vehicle_color",
        "V1IsVehicleTowed": "is_vehicle_towed",
        "Vehicle2TypeId": "vehicle2_type_id",
        "Vehicle2TypeDesc": "vehicle2_type_desc",
        "Vehicle2Year": "vehicle2_year",
        "Vehicle2Make": "vehicle2_make_code",
        "Vehicle2Model": "vehicle2_model",
        "Vehicle2Color": "vehicle2_color",
        "V2IsVehicleTowed": "is_vehicle2_towed",
        "DirectionOfTravel": "direction_of_travel",
        "StreetOrHighwayName": "street_or_highway",
        "SpeedLimit": "speed_limit",
        "Lane": "lane",
        "ThruLanes": "thru_lanes",
        "TotalLanes": "total_lanes",
        "MovementPrecCollCode": "movement_pre_collision_code",
        "MovementPrecCollDescription": "movement_pre_collision_desc",
        "Special Information": "special_information",
        "Inattention": "inattention",
        "IsDREConducted": "is_dre_conducted",
    }

    int_cols = {
        'party_id', 'collision_id', 'party_number', 'stated_age', 'vehicle_year',
        'vehicle2_year', 'speed_limit', 'lane', 'thru_lanes', 'total_lanes',
        'vehicle_type_id', 'vehicle2_type_id',
    }
    bool_cols = {
        'is_at_fault', 'is_hit_and_run', 'is_vehicle_towed', 'is_vehicle2_towed',
        'is_dre_conducted',
    }

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        rows = []
        count = 0
        for row in reader:
            clean_row = {}
            for raw_k, v in row.items():
                k_clean = clean_col(raw_k)
                if k_clean not in col_map:
                    continue
                db_col = col_map[k_clean]
                v_clean = clean_value(v)

                if db_col in int_cols:
                    clean_row[db_col] = safe_int(v_clean)
                elif db_col in bool_cols:
                    clean_row[db_col] = safe_bool(v_clean)
                else:
                    clean_row[db_col] = v_clean

            rows.append(clean_row)

            if len(rows) >= BATCH_SIZE:
                _insert_batch(conn, 'parties', rows)
                count += len(rows)
                print(f"  parties: {count:,} rows...")
                rows = []

        if rows:
            _insert_batch(conn, 'parties', rows)
            count += len(rows)

    print(f"  ✅ parties: {count:,} rows importados")
    return count


def import_injured(conn: sqlite3.Connection, year: str = "2025") -> int:
    """Import injuredwitnesspassengers_YYYY.csv → injured table."""
    filepath = DATA_DIR / f"injuredwitnesspassengers_{year}.csv"
    if not filepath.exists():
        print(f"❌  {filepath} no encontrado")
        return 0

    print(f"📥 Importando injured ({filepath.stat().st_size / 1024 / 1024:.0f} MB)...")

    col_map = {
        "CollisionId": "collision_id",
        "InjuredWitPassId": "injured_wit_pass_id",
        "StatedAge": "stated_age",
        "Gender": "gender_code",
        "Gender Desc": "gender_desc",
        "Race": "race_code",
        "Race Desc": "race_desc",
        "IsWitnessOnly": "is_witness_only",
        "IsPassengerOnly": "is_passenger_only",
        "ExtentOfInjuryCode": "extent_of_injury_code",
        "InjuredPersonType": "injured_person_type",
        "SeatPosition": "seat_position",
        "SeatPositionOther": "seat_position_desc",
        "AirBagCode": "airbag_code",
        "AirBagDescription": "airbag_desc",
        "SafetyEquipmentCode": "safety_equipment_code",
        "SafetyEquipmentDescription": "safety_equipment_desc",
        "Ejected": "is_ejected",
        "IsVOVCNotified": "is_vovc_notified",
        "PartyNumber": "party_number",
    }

    int_cols = {'collision_id', 'stated_age', 'party_number'}
    bool_cols = {'is_witness_only', 'is_passenger_only', 'is_ejected', 'is_vovc_notified'}

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        rows = []
        count = 0
        for row in reader:
            clean_row = {}
            for raw_k, v in row.items():
                k_clean = clean_col(raw_k)
                if k_clean not in col_map:
                    continue
                db_col = col_map[k_clean]
                v_clean = clean_value(v)

                if db_col in int_cols:
                    clean_row[db_col] = safe_int(v_clean)
                elif db_col in bool_cols:
                    clean_row[db_col] = safe_bool(v_clean)
                else:
                    clean_row[db_col] = v_clean

            rows.append(clean_row)

            if len(rows) >= BATCH_SIZE:
                _insert_batch(conn, 'injured', rows)
                count += len(rows)
                print(f"  injured: {count:,} rows...")
                rows = []

        if rows:
            _insert_batch(conn, 'injured', rows)
            count += len(rows)

    print(f"  ✅ injured: {count:,} rows importados")
    return count


def _insert_batch(conn, table, rows):
    """Insert a batch of dict rows into table."""
    if not rows:
        return
    columns = rows[0].keys()
    placeholders = ', '.join(['?' for _ in columns])
    col_names = ', '.join(columns)
    sql = f"INSERT OR IGNORE INTO {table} ({col_names}) VALUES ({placeholders})"
    values = [tuple(row.get(c) for c in columns) for row in rows]
    conn.executemany(sql, values)
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("🚗  ACG Crash Intelligence — Importador de datos CCRS")
    print("=" * 60)

    # Create DB directory
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Connect
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-64000")  # 64MB cache
    conn.execute("PRAGMA temp_store=MEMORY")

    # Run schema
    schema_path = Path(__file__).parent.parent / "db" / "schema.sql"
    if schema_path.exists():
        print(f"📋 Ejecutando schema: {schema_path}")
        conn.executescript(schema_path.read_text())
        conn.commit()

    start = time.time()

    # Import all years (2025 ya fue importado en primera pasada)
    years = ["2023", "2024"]
    total = 0
    for year in years:
        print(f"\n{'─'*60}")
        print(f"📅  AÑO {year}")
        print(f"{'─'*60}")
        total += import_crashes(conn, year)
        total += import_parties(conn, year)
        total += import_injured(conn, year)

    elapsed = time.time() - start
    db_size_mb = DB_PATH.stat().st_size / 1024 / 1024

    print(f"\n{'=' * 60}")
    print(f"✅ Importación completa: {total:,} registros totales")
    print(f"⏱️  Tiempo: {elapsed:.1f}s")
    print(f"💾 DB size: {db_size_mb:.0f} MB")
    print(f"📂 {DB_PATH}")
    print(f"{'=' * 60}")

    conn.close()


if __name__ == "__main__":
    main()
