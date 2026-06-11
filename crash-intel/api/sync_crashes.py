#!/usr/bin/env python3
"""
Crash Intel — Daily Sync via CKAN Datastore API
Polls data.ca.gov CKAN Datastore for new CCRS records and incrementally imports into SQLite.

Usage:
  python3 api/sync_crashes.py                 # Incremental sync (daily)
  python3 api/sync_crashes.py --year 2026     # Full sync of a year
  python3 api/sync_crashes.py --cache-only    # Only refresh agc_location_cache
  python3 api/sync_crashes.py --all-years     # Full historical sync

Strategy:
  - Uses CKAN Datastore SQL API (clean column names, queryable)
  - Paginates through results (100 per call, ~5/sec rate limit)
  - INSERT OR IGNORE to skip existing records
  - Tracks last_synced Collision ID per year for incremental syncs

Schedule: daily cron at 4:00 AM PT
"""

import sqlite3
import json
import math
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone, timedelta

# ── Config ──────────────────────────────────────────────────────────

CKAN_DATASTORE_BASE = "https://data.ca.gov/api/3/action/datastore_search"
CKAN_SQL_BASE = "https://data.ca.gov/api/3/action/datastore_search_sql"
CKAN_PACKAGE_API = "https://data.ca.gov/api/3/action/package_show"
DATASET_ID = "80c6a49d-c6b3-40ba-86d8-379c9741b4be"

DB_PATH = Path(__file__).parent.parent / "data" / "crash_intel.db"
DATA_DIR = Path(__file__).parent.parent / "data"
SYNC_STATE_FILE = DATA_DIR / "sync_state.json"
PACIFIC_TZ = timezone(timedelta(hours=-7))

BATCH_SIZE = 100  # Datastore page size
INSERT_BATCH = 3000  # SQLite insert batch
RATE_LIMIT = 0.15  # Seconds between API calls (~6/sec)

# ── Logging ──────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now(PACIFIC_TZ).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

# ── DB ───────────────────────────────────────────────────────────────

def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-384000")
    return conn

# ── Sync state ───────────────────────────────────────────────────────

def load_sync_state() -> dict:
    if SYNC_STATE_FILE.exists():
        with open(SYNC_STATE_FILE) as f:
            state = json.load(f)
            # Ensure required keys exist
            if "last_ids" not in state:
                state["last_ids"] = {}
            if "last_sync" not in state:
                state["last_sync"] = None
            return state
    return {"last_ids": {}, "last_sync": None}

def save_sync_state(state: dict):
    state["last_sync"] = datetime.now(PACIFIC_TZ).isoformat()
    with open(SYNC_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# ── CKAN Datastore API ───────────────────────────────────────────────

def datastore_sql(sql: str) -> dict:
    """Run SQL against CKAN datastore with retry."""
    url = f"{CKAN_SQL_BASE}?sql={urllib.parse.quote(sql)}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ACG-CrashIntel/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if attempt < 2:
                time.sleep((attempt + 1) * 5)
            else:
                log(f"  Datastore SQL error: {e}")
                return {"success": False, "error": str(e)}

def datastore_search(resource_id: str, offset: int = 0, limit: int = 100,
                     filters: dict = None, sort: str = None) -> dict:
    """Search datastore with pagination and retry logic."""
    params = {
        "resource_id": resource_id,
        "offset": offset,
        "limit": limit,
    }
    if sort:
        params["sort"] = sort
    if filters:
        for k, v in filters.items():
            params[k] = v

    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    url = f"{CKAN_DATASTORE_BASE}?{qs}"

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ACG-CrashIntel/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if attempt < 2:
                wait = (attempt + 1) * 5
                log(f"  Retry {attempt+1}/3 in {wait}s: {e}")
                time.sleep(wait)
            else:
                log(f"  Datastore search error after 3 retries: {e}")
                return {"success": False, "error": str(e)}

def get_resource_metadata() -> dict:
    """Get dataset metadata from CKAN to find resource IDs."""
    url = f"{CKAN_PACKAGE_API}?id={DATASET_ID}"
    req = urllib.request.Request(url, headers={"User-Agent": "ACG-CrashIntel/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            d = json.loads(resp.read())
            if d.get("success"):
                return d["result"]
    except Exception as e:
        log(f"  Package API error: {e}")
    return {}

def clean_val(val):
    if val is None:
        return None
    if isinstance(val, str):
        v = val.strip()
        return v if v else None
    return val

def safe_int(val):
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None

def safe_float(val):
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

# ── Datastore → SQLite mapping (using clean DS column names) ─────────

def map_crash_ds(ds_row: dict) -> dict:
    """Map a CKAN datastore row to crashes table."""
    return {
        "collision_id": safe_int(ds_row.get("Collision Id")),
        "report_number": clean_val(ds_row.get("Report Number")),
        "crash_datetime": clean_val(ds_row.get("Crash Date Time")),
        "crash_date": (clean_val(ds_row.get("Crash Date Time")) or "")[:10] or None,
        "crash_time": clean_val(ds_row.get("Crash Time Description")),
        "day_of_week": clean_val(ds_row.get("Day Of Week")),
        "city_name": clean_val(ds_row.get("City Name")),
        "county_code": safe_int(ds_row.get("County Code")),
        "city_id": safe_int(ds_row.get("City Id")),
        "latitude": safe_float(ds_row.get("Latitude")),
        "longitude": safe_float(ds_row.get("Longitude")),
        "collision_type_code": clean_val(ds_row.get("Collision Type Code")),
        "collision_type_desc": clean_val(ds_row.get("Collision Type Description")),
        "is_highway": clean_val(ds_row.get("IsHighwayRelated")) == "True",
        "is_tow_away": clean_val(ds_row.get("IsTowAway")) == "True",
        "number_injured": safe_int(ds_row.get("NumberInjured")) or 0,
        "number_killed": safe_int(ds_row.get("NumberKilled")) or 0,
        "weather1": clean_val(ds_row.get("Weather 1")),
        "weather2": clean_val(ds_row.get("Weather 2")),
        "road_condition1": clean_val(ds_row.get("Road Condition 1")),
        "road_condition2": clean_val(ds_row.get("Road Condition 2")),
        "lighting_code": clean_val(ds_row.get("LightingCode")),
        "primary_road": clean_val(ds_row.get("PrimaryRoad")),
        "secondary_road": clean_val(ds_row.get("SecondaryRoad")),
        "primary_collision_factor": clean_val(ds_row.get("Primary Collision Factor Code")),
        "primary_collision_violation": clean_val(ds_row.get("Primary Collision Factor Violation")),
        "motor_vehicle_involved_code": clean_val(ds_row.get("MotorVehicleInvolvedWithCode")),
        "motor_vehicle_involved_desc": clean_val(ds_row.get("MotorVehicleInvolvedWithDesc")),
        "roadway_surface_code": clean_val(ds_row.get("RoadwaySurfaceCode")),
        "hit_and_run": clean_val(ds_row.get("HitRun")) == "True",
        "is_freeway": clean_val(ds_row.get("IsFreeway")) == "True",
        "reporting_district": clean_val(ds_row.get("ReportingDistrict")),
    }

def map_party_ds(ds_row: dict) -> dict:
    return {
        "collision_id": safe_int(ds_row.get("Collision Id")),
        "party_number": safe_int(ds_row.get("Party Number")),
        "vehicle_make_code": clean_val(ds_row.get("Vehicle Make Code")),
        "vehicle_make_desc": clean_val(ds_row.get("Vehicle Make Description")),
        "vehicle_year": safe_int(ds_row.get("Vehicle Year")),
        "stated_age": clean_val(ds_row.get("Stated Age")),
        "gender_desc": clean_val(ds_row.get("Gender Desc")),
        "is_at_fault": clean_val(ds_row.get("Is At Fault")),
        "vehicle2_make_code": clean_val(ds_row.get("Vehicle2 Make Code")),
        "party_type": clean_val(ds_row.get("Party Type")),
        "mov_code": clean_val(ds_row.get("Mov Code")),
        "mov_desc": clean_val(ds_row.get("Mov Desc")),
    }

# ── Import ───────────────────────────────────────────────────────────

def insert_batch(conn: sqlite3.Connection, table: str, rows: list) -> int:
    """Insert rows with INSERT OR IGNORE. Returns count of inserted rows."""
    valid = [r for r in rows if r.get("collision_id")]
    if not valid:
        return 0

    columns = list(valid[0].keys())
    placeholders = ",".join(["?" for _ in columns])
    cols_str = ",".join(columns)

    before = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    try:
        sql = f"INSERT OR IGNORE INTO {table} ({cols_str}) VALUES ({placeholders})"
        conn.executemany(sql, [tuple(r.get(c) for c in columns) for r in valid])
        conn.commit()
    except Exception as e:
        log(f"    DB error: {e}")
        return 0

    after = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    return after - before


def sync_resource(conn: sqlite3.Connection, resource_id: str, year: str,
                  table: str, mapper, state: dict, full_sync: bool = False) -> int:
    """Sync one resource (crashes or parties) using Datastore SQL API."""
    last_id = state["last_ids"].get(f"{table}_{year}", 0) if not full_sync else 0
    log(f"  {table}_{year}: starting from Collision ID > {last_id}")

    # Get total count of new records via SQL
    count_result = datastore_sql(
        f'SELECT COUNT(*) as n FROM "{resource_id}" WHERE "Collision Id" > {last_id}'
    )
    total_to_sync = 0
    if count_result.get("success"):
        total_to_sync = int(count_result["result"]["records"][0]["n"])
    else:
        log(f"    Count query failed: {count_result.get('error','')}")

    log(f"  {table}_{year}: {total_to_sync} new records to sync")

    if total_to_sync == 0:
        log(f"  {table}_{year}: up to date ✓")
        return 0

    # Use SQL API to fetch only new records (much faster than offset pagination)
    total_new = 0
    batch = []
    max_id = last_id

    for offset in range(0, total_to_sync, BATCH_SIZE):
        sql = f'SELECT * FROM "{resource_id}" WHERE "Collision Id" > {last_id} ORDER BY "Collision Id" ASC LIMIT {BATCH_SIZE} OFFSET {offset}'
        result = datastore_sql(sql)

        if not result.get("success"):
            log(f"    SQL error at offset {offset}: {result.get('error','')}")
            break

        records = result["result"]["records"]
        if not records:
            break

        for rec in records:
            mapped = mapper(rec)
            cid = mapped.get("collision_id")
            if not cid:
                continue
            batch.append(mapped)
            max_id = max(max_id, cid)

        if len(batch) >= INSERT_BATCH:
            inserted = insert_batch(conn, table, batch)
            total_new += inserted
            log(f"    {offset+len(records):,}/{total_to_sync:,} | {inserted} new (total {total_new:,}) | max ID: {max_id}")
            batch = []

        time.sleep(RATE_LIMIT)

    # Remaining
    if batch:
        inserted = insert_batch(conn, table, batch)
        total_new += inserted

    # Insert remaining
    if batch:
        inserted = insert_batch(conn, table, batch)
        total_new += inserted

    # Update sync state
    if max_id > last_id:
        state["last_ids"][f"{table}_{year}"] = max_id

    log(f"  {table}_{year}: {total_new:,} new records imported (max ID: {max_id})")
    return total_new


# ── Location cache ───────────────────────────────────────────────────

def refresh_location_cache(conn: sqlite3.Connection):
    log("Refreshing location cache...")

    try:
        conn.execute("ALTER TABLE acg_location_cache ADD COLUMN updated_at TEXT")
    except sqlite3.OperationalError:
        pass

    locations = [
        {"name": "Whittier HQ",          "lat": 33.9792,  "lon": -118.0327, "radius_miles": 10},
        {"name": "Los Angeles",          "lat": 34.0522,  "lon": -118.2437, "radius_miles": 15},
        {"name": "Gardena — Rosecrans",  "lat": 33.8969,  "lon": -118.3092, "radius_miles": 10},
        {"name": "Gardena — Vermont",    "lat": 33.8883,  "lon": -118.3089, "radius_miles": 10},
        {"name": "Santa Ana",            "lat": 33.7455,  "lon": -117.8677, "radius_miles": 10},
        {"name": "Covina",               "lat": 34.0900,  "lon": -117.8903, "radius_miles": 10},
        {"name": "Ontario",              "lat": 34.0633,  "lon": -117.6509, "radius_miles": 10},
        {"name": "Rancho Cucamonga",     "lat": 34.1064,  "lon": -117.5931, "radius_miles": 10},
        {"name": "Victorville",          "lat": 34.5362,  "lon": -117.2928, "radius_miles": 10},
        {"name": "Fresno",               "lat": 36.7378,  "lon": -119.7871, "radius_miles": 12},
        {"name": "Bakersfield — Ming",   "lat": 35.3733,  "lon": -119.0187, "radius_miles": 12},
        {"name": "Bakersfield — McCutchen","lat": 35.3345, "lon": -119.0778, "radius_miles": 12},
        {"name": "El Cajon",             "lat": 32.7948,  "lon": -116.9625, "radius_miles": 10},
    ]

    years = conn.execute(
        "SELECT DISTINCT SUBSTR(crash_date,1,4) as year FROM crashes WHERE crash_date IS NOT NULL ORDER BY year"
    ).fetchall()

    for year_row in years:
        year = year_row["year"]
        for loc in locations:
            name, lat, lon, radius = loc["name"], loc["lat"], loc["lon"], loc["radius_miles"]
            lat_range = radius / 69.0
            lon_range = radius / (69.0 * abs(math.cos(math.radians(lat))))

            row = conn.execute("""
                SELECT COUNT(*) as total_crashes,
                       COALESCE(SUM(number_injured),0) as total_injured,
                       COALESCE(SUM(number_killed),0) as total_killed,
                       ROUND(AVG(number_injured),2) as avg_injured
                FROM crashes
                WHERE crash_date >= ? AND crash_date < ?
                  AND latitude BETWEEN ? AND ?
                  AND longitude BETWEEN ? AND ?
                  AND latitude IS NOT NULL
            """, [f"{year}-01-01", f"{int(year)+1}-01-01",
                  lat - lat_range, lat + lat_range, lon - lon_range, lon + lon_range]).fetchone()

            brands = [dict(r) for r in conn.execute("""
                SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
                       COUNT(*) as crashes
                FROM parties p JOIN crashes c ON p.collision_id = c.collision_id
                LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
                WHERE c.crash_date >= ? AND c.crash_date < ?
                  AND c.latitude BETWEEN ? AND ?
                  AND c.longitude BETWEEN ? AND ?
                  AND p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code != ''
                GROUP BY 1 ORDER BY crashes DESC LIMIT 8
            """, [f"{year}-01-01", f"{int(year)+1}-01-01",
                  lat - lat_range, lat + lat_range, lon - lon_range, lon + lon_range]).fetchall()]

            roads = [dict(r) for r in conn.execute("""
                SELECT primary_road, COUNT(*) as n
                FROM crashes
                WHERE crash_date >= ? AND crash_date < ?
                  AND latitude BETWEEN ? AND ?
                  AND longitude BETWEEN ? AND ?
                  AND primary_road IS NOT NULL AND primary_road != ''
                GROUP BY primary_road ORDER BY n DESC LIMIT 5
            """, [f"{year}-01-01", f"{int(year)+1}-01-01",
                  lat - lat_range, lat + lat_range, lon - lon_range, lon + lon_range]).fetchall()]

            hours = [dict(r) for r in conn.execute("""
                SELECT CAST(SUBSTR(crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n
                FROM crashes
                WHERE crash_date >= ? AND crash_date < ?
                  AND latitude BETWEEN ? AND ?
                  AND longitude BETWEEN ? AND ?
                  AND crash_time IS NOT NULL AND crash_time != ''
                GROUP BY hour ORDER BY n DESC LIMIT 3
            """, [f"{year}-01-01", f"{int(year)+1}-01-01",
                  lat - lat_range, lat + lat_range, lon - lon_range, lon + lon_range]).fetchall()]

            data = {
                "total_crashes": row["total_crashes"],
                "total_injured": row["total_injured"],
                "total_killed": row["total_killed"],
                "avg_injured": row["avg_injured"],
                "luxury_brands": brands,
                "top_roads": roads,
                "peak_hours": hours,
            }

            conn.execute("""
                INSERT OR REPLACE INTO acg_location_cache (year, name, data, updated_at)
                VALUES (?, ?, ?, ?)
            """, [year, name, json.dumps(data), datetime.now(PACIFIC_TZ).isoformat()])

        conn.commit()
        log(f"  Cache: {year} ✓")

    log("Location cache done.")


# ── Main ─────────────────────────────────────────────────────────────


def refresh_dashboard_cache(conn: sqlite3.Connection):
    """Refresh the analytics_cache with precomputed dashboard data for all years."""
    log("Refreshing dashboard cache...")
    years = [r[0] for r in conn.execute(
        "SELECT DISTINCT SUBSTR(crash_date,1,4) FROM crashes WHERE crash_date IS NOT NULL ORDER BY 1"
    ).fetchall()]
    
    for year in years:
        y1, y2 = f'{year}-01-01', f'{int(year)+1}-01-01'
        
        r = conn.execute("SELECT COUNT(*) as n, COALESCE(SUM(number_injured),0) as inj, COALESCE(SUM(number_killed),0) as kld, ROUND(AVG(number_injured),2) as avg_inj FROM crashes WHERE crash_date>=? AND crash_date<?", [y1,y2]).fetchone()
        tt = conn.execute("SELECT collision_type_desc, COUNT(*) as n FROM crashes WHERE crash_date>=? AND crash_date<? AND collision_type_desc IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 1", [y1,y2]).fetchone()
        stats = {'total_crashes':r['n'],'total_injured':r['inj'],'total_killed':r['kld'],'avg_injured_per_crash':r['avg_inj'],'top_collision_type':tt['collision_type_desc'] if tt else None}
        
        # Minimal refresh: just stats + luxury (fast queries)
        luxury_list = ['TESLA','BMW','MERCEDES-BENZ','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']
        ph = ','.join(['?' for _ in luxury_list])
        luxury = [dict(r) for r in conn.execute(f"SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crashes, ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END) as at_fault FROM parties p JOIN crashes c ON p.collision_id=c.collision_id LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code WHERE c.crash_date>=? AND c.crash_date<? AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) IN ({ph}) GROUP BY 1 ORDER BY crashes DESC", [y1,y2] + luxury_list).fetchall()]
        
        conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES(?,?,datetime('now'))", [f'stats_{year}', json.dumps(stats)])
        conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES(?,?,datetime('now'))", [f'luxury_brands_{year}', json.dumps(luxury)])
        
        # Full dashboard cache - run all queries
        makes = [dict(r) for r in conn.execute("SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crash_count, ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END)*100.0/COUNT(*) as at_fault_pct FROM parties p JOIN crashes c ON p.collision_id=c.collision_id LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code WHERE c.crash_date>=? AND c.crash_date<? AND p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code!='' GROUP BY 1 ORDER BY crash_count DESC LIMIT 14", [y1,y2]).fetchall()]
        months = [dict(r) for r in conn.execute("SELECT SUBSTR(crash_date,1,7) as month, COUNT(*) as crashes, COALESCE(SUM(number_injured),0) as injured FROM crashes WHERE crash_date>=? AND crash_date<? AND crash_date IS NOT NULL GROUP BY month ORDER BY month", [y1,y2]).fetchall()]
        types = [dict(r) for r in conn.execute("SELECT collision_type_desc, COUNT(*) as total, COALESCE(SUM(number_injured),0) as total_injured FROM crashes WHERE crash_date>=? AND crash_date<? AND collision_type_desc IS NOT NULL AND collision_type_desc!='' GROUP BY 1 ORDER BY total DESC", [y1,y2]).fetchall()]
        cities = [dict(r) for r in conn.execute("SELECT city_name, COUNT(*) as total_crashes, COALESCE(SUM(number_injured),0) as total_injured FROM crashes WHERE crash_date>=? AND crash_date<? AND city_name IS NOT NULL AND city_name!='' GROUP BY city_name ORDER BY total_crashes DESC LIMIT 12", [y1,y2]).fetchall()]
        day_order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
        dow = {r['day_of_week']:r['n'] for r in conn.execute("SELECT day_of_week, COUNT(*) as n FROM crashes WHERE crash_date>=? AND crash_date<? AND day_of_week IS NOT NULL GROUP BY 1", [y1,y2]).fetchall()}
        days = [{'day':d,'crashes':dow.get(d,0)} for d in day_order]
        hours = [dict(r) for r in conn.execute("SELECT CAST(SUBSTR(crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n FROM crashes WHERE crash_date>=? AND crash_date<? AND crash_time IS NOT NULL GROUP BY hour ORDER BY hour", [y1,y2]).fetchall()]
        age_groups = [dict(r) for r in conn.execute("SELECT CASE WHEN CAST(p.stated_age AS INTEGER)<18 THEN '<18' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 18 AND 24 THEN '18-24' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 25 AND 34 THEN '25-34' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 35 AND 44 THEN '35-44' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 45 AND 54 THEN '45-54' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 55 AND 64 THEN '55-64' WHEN CAST(p.stated_age AS INTEGER)>=65 THEN '65+' ELSE 'Unknown' END as age_group, COUNT(*) as n, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END) as at_fault FROM parties p JOIN crashes c ON p.collision_id=c.collision_id WHERE c.crash_date>=? AND c.crash_date<? AND p.stated_age IS NOT NULL GROUP BY age_group ORDER BY MIN(CAST(p.stated_age AS INTEGER))", [y1,y2]).fetchall()]
        
        dashboard = {'stats':stats,'makes':makes,'months':months,'types':types,'cities':cities,'days':days,'hours':hours,'luxury':luxury,'age_groups':age_groups,'_cached':True}
        conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES(?,?,datetime('now'))", [f'dashboard_{year}', json.dumps(dashboard)])
        
    conn.commit()
    log("Dashboard cache refreshed.")

def refresh_filters_cache(conn: sqlite3.Connection):
    """Precompute /api/filters cache so it's always fast."""
    log("Refreshing filters cache...")
    import json as _json
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    PACIFIC = _tz(_td(hours=-7))

    years = [r[0] for r in conn.execute(
        "SELECT DISTINCT SUBSTR(crash_date,1,4) FROM crashes WHERE crash_date IS NOT NULL ORDER BY 1"
    ).fetchall()]
    cities = [r[0] for r in conn.execute(
        "SELECT city_name FROM crashes WHERE city_name IS NOT NULL AND city_name != '' GROUP BY city_name HAVING COUNT(*) > 100 ORDER BY COUNT(*) DESC LIMIT 100"
    ).fetchall()]
    col_types = [r[0] for r in conn.execute(
        "SELECT DISTINCT collision_type_desc FROM crashes WHERE collision_type_desc IS NOT NULL AND collision_type_desc != '' ORDER BY collision_type_desc"
    ).fetchall()]

    PREMIUM = ['ACURA','ALFA ROMEO','ASTON MARTIN','AUDI','BENTLEY','BMW','CADILLAC',
               'FERRARI','GENESIS','INFINITI','JAGUAR','LAMBORGHINI','LAND ROVER',
               'LEXUS','LOTUS','LUCID','MASERATI','MCLAREN','MERCEDES-BENZ',
               'POLESTAR','PORSCHE','RIVIAN','ROLLS ROYCE','TESLA','VOLVO']

    all_makes = conn.execute("""
        SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as n
        FROM parties p LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
        WHERE p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code != ''
        GROUP BY 1 ORDER BY n DESC
    """).fetchall()

    makes = []
    seen = set()
    for row in all_makes:
        if len(makes) >= 60 and row['make'] not in PREMIUM:
            continue
        if row['make'] not in seen:
            makes.append(row['make'])
            seen.add(row['make'])
    for pm in PREMIUM:
        if pm not in seen:
            for row in all_makes:
                if row['make'] == pm:
                    makes.append(pm)
                    break
    makes.sort()

    counties = [dict(r) for r in conn.execute(
        "SELECT county_code, city_name as sample_city FROM crashes WHERE county_code IS NOT NULL GROUP BY county_code ORDER BY COUNT(*) DESC LIMIT 58"
    ).fetchall()]

    result = {'years': years, 'cities': cities, 'collision_types': col_types, 'makes': makes, 'counties': counties}
    conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES (?, ?, datetime('now'))",
                 ['filters', _json.dumps(result)])
    conn.commit()
    log("Filters cache refreshed.")

def refresh_make_caches(conn: sqlite3.Connection):
    """Pre-warm filtered dashboard caches for top makes (< 1s after sync)."""
    log("Pre-warming make-specific caches...")
    import json as _json

    TOP_MAKES = ['TOYOTA','HONDA','FORD','CHEVROLET','NISSAN','BMW','MERCEDES-BENZ',
                 'TESLA','LEXUS','KIA','HYUNDAI','AUDI','JEEP','DODGE','GMC','RAM',
                 'SUBARU','VOLKSWAGEN','MAZDA','CADILLAC','ACURA','INFINITI','VOLVO',
                 'LUCID','RIVIAN','GENESIS','MASERATI','PORSCHE','LAND ROVER']

    years = [r[0] for r in conn.execute(
        "SELECT DISTINCT SUBSTR(crash_date,1,4) FROM crashes WHERE crash_date IS NOT NULL ORDER BY 1"
    ).fetchall()]

    for year in years:
        for make in TOP_MAKES:
            cache_key = f'dashboard_{year}_make_{make}'
            # Check if already cached
            exists = conn.execute("SELECT 1 FROM analytics_cache WHERE cache_key=?", [cache_key]).fetchone()
            if exists:
                continue

            # Build dashboard with make filter for this year
            try:
                result = _build_dashboard_live_static(conn, [year], [], [make], [])
                conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES (?, ?, datetime('now'))",
                             [cache_key, _json.dumps(result)])
            except Exception as e:
                log(f"  {make} {year}: skipped — {e}")

    conn.commit()
    log(f"Make caches warmed for {len(years)} years × {len(TOP_MAKES)} brands.")


def _build_dashboard_live_static(conn, years, city, make, collision_type):
    """Static version of the dashboard live query for cache warming."""
    clauses = []
    params_c = []
    if years:
        yi = sorted(int(y) for y in years)
        if yi == list(range(yi[0], yi[-1]+1)):
            clauses.append(f"c.crash_date >= '{yi[0]}-01-01' AND c.crash_date < '{yi[-1]+1}-01-01'")
        else:
            ph = ','.join(['?' for _ in years])
            clauses.append(f"SUBSTR(c.crash_date,1,4) IN ({ph})")
            params_c.extend(years)
    if city:
        ph = ','.join(['?' for _ in city])
        clauses.append(f"c.city_name IN ({ph})")
        params_c.extend(city)
    if collision_type:
        ph = ','.join(['?' for _ in collision_type])
        clauses.append(f"c.collision_type_desc IN ({ph})")
        params_c.extend(collision_type)
    if make:
        ph = ','.join(['?' for _ in make])
        clauses.append(f"EXISTS (SELECT 1 FROM parties p2 LEFT JOIN vehicle_make_lookup l2 ON p2.vehicle_make_code = l2.make_code WHERE p2.collision_id=c.collision_id AND UPPER(COALESCE(l2.make_name, p2.vehicle_make_code)) IN ({ph}))")
        params_c.extend(make)

    where_c = "WHERE " + " AND ".join(clauses) if clauses else "WHERE 1=1"
    result = {}

    r = conn.execute(f"SELECT COUNT(*) as n, COALESCE(SUM(c.number_injured),0) as inj, COALESCE(SUM(c.number_killed),0) as kld, ROUND(AVG(c.number_injured),2) as avg_inj FROM crashes c {where_c}", params_c).fetchone()
    tt = conn.execute(f"SELECT c.collision_type_desc, COUNT(*) as n FROM crashes c {where_c} AND c.collision_type_desc IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 1", params_c).fetchone()
    result['stats'] = {'total_crashes':r['n'],'total_injured':r['inj'],'total_killed':r['kld'],'avg_injured_per_crash':r['avg_inj'],'top_collision_type':tt['collision_type_desc'] if tt else None}

    result['makes'] = [dict(r) for r in conn.execute(f"SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crash_count, ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END)*100.0/COUNT(*) as at_fault_pct FROM parties p JOIN crashes c ON p.collision_id=c.collision_id LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code {where_c} AND p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code!='' GROUP BY 1 ORDER BY crash_count DESC LIMIT 14", params_c).fetchall()]

    result['months'] = [dict(r) for r in conn.execute(f"SELECT SUBSTR(c.crash_date,1,7) as month, COUNT(*) as crashes, COALESCE(SUM(c.number_injured),0) as injured, COALESCE(SUM(c.number_killed),0) as killed FROM crashes c {where_c} AND c.crash_date IS NOT NULL GROUP BY month ORDER BY month", params_c).fetchall()]

    result['types'] = [dict(r) for r in conn.execute(f"SELECT c.collision_type_desc, COUNT(*) as total, COALESCE(SUM(c.number_injured),0) as total_injured FROM crashes c {where_c} AND c.collision_type_desc IS NOT NULL AND c.collision_type_desc!='' GROUP BY 1 ORDER BY total DESC", params_c).fetchall()]

    result['cities'] = [dict(r) for r in conn.execute(f"SELECT c.city_name, c.county_code, COUNT(*) as total_crashes, COALESCE(SUM(c.number_injured),0) as total_injured, COALESCE(SUM(c.number_killed),0) as total_killed FROM crashes c {where_c} AND c.city_name IS NOT NULL AND c.city_name!='' GROUP BY c.city_name, c.county_code ORDER BY total_crashes DESC LIMIT 12", params_c).fetchall()]

    day_order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    dow = {r['day_of_week']:r['n'] for r in conn.execute(f"SELECT c.day_of_week, COUNT(*) as n FROM crashes c {where_c} AND c.day_of_week IS NOT NULL GROUP BY 1", params_c).fetchall()}
    result['days'] = [{'day':d,'crashes':dow.get(d,0)} for d in day_order]

    result['hours'] = [dict(r) for r in conn.execute(f"SELECT CAST(SUBSTR(c.crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n FROM crashes c {where_c} AND c.crash_time IS NOT NULL GROUP BY hour ORDER BY hour", params_c).fetchall()]

    luxury = ['TESLA','BMW','MERCEDES-BENZ','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']
    ph = ','.join(['?' for _ in luxury])
    result['luxury'] = [dict(r) for r in conn.execute(f"SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crashes, ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END) as at_fault FROM parties p JOIN crashes c ON p.collision_id=c.collision_id LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code {where_c} AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) IN ({ph}) GROUP BY 1 ORDER BY crashes DESC", params_c + luxury).fetchall()]

    result['age_groups'] = [dict(r) for r in conn.execute(f"SELECT CASE WHEN CAST(p.stated_age AS INTEGER)<18 THEN '<18' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 18 AND 24 THEN '18-24' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 25 AND 34 THEN '25-34' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 35 AND 44 THEN '35-44' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 45 AND 54 THEN '45-54' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 55 AND 64 THEN '55-64' WHEN CAST(p.stated_age AS INTEGER)>=65 THEN '65+' ELSE 'Unknown' END as age_group, COUNT(*) as n, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END) as at_fault FROM parties p JOIN crashes c ON p.collision_id=c.collision_id {where_c} AND p.stated_age IS NOT NULL GROUP BY age_group ORDER BY MIN(CAST(p.stated_age AS INTEGER))", params_c).fetchall()]

    return result
def sync(full: bool = False, specific_year: str = None):
    log("=" * 60)
    log("ACG Crash Intel — CKAN Datastore Sync")
    log("=" * 60)

    state = load_sync_state()
    metadata = get_resource_metadata()
    if not metadata:
        log("ERROR: Could not fetch dataset metadata")
        return

    # Find resource IDs for crashes and parties by year
    resources = {}
    for r in metadata.get("resources", []):
        name = r.get("name", "")
        rid = r.get("id", "")
        if not rid:
            continue
        # Extract year and type from name: e.g. "Crashes_2026", "Parties_2026"
        parts = name.split("_")
        if len(parts) >= 2:
            rtype = parts[0].lower()  # "crashes" or "parties"
            year = parts[1]
            if year.isdigit() and rtype in ("crashes", "parties"):
                resources.setdefault(year, {})[rtype] = rid

    years = sorted(resources.keys())
    log(f"Available years: {', '.join(years)}")

    if specific_year:
        years = [y for y in years if y == specific_year]
        if not years:
            log(f"Year {specific_year} not found. Available: {', '.join(sorted(resources.keys()))}")
            return
        log(f"Filtered to year {specific_year}")

    conn = get_conn()
    total_new = 0

    try:
        for year in years:
            res_ids = resources[year]
            log(f"\n── Year {year} ──")

            # Sync crashes
            if "crashes" in res_ids:
                new = sync_resource(
                    conn, res_ids["crashes"], year, "crashes",
                    map_crash_ds, state, full_sync=full
                )
                total_new += new

            # Sync parties
            if "parties" in res_ids:
                sync_resource(
                    conn, res_ids["parties"], year, "parties",
                    map_party_ds, state, full_sync=full
                )

    finally:
        conn.close()

    # Save sync state
    save_sync_state(state)

    # Refresh cache if new data
    if total_new > 0 or full:
        conn = get_conn()
        try:
            refresh_location_cache(conn)
            refresh_dashboard_cache(conn)
            refresh_filters_cache(conn)
            refresh_make_caches(conn)
        finally:
            conn.close()

    # Summary
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM crashes").fetchone()[0]
    parties_total = conn.execute("SELECT COUNT(*) FROM parties").fetchone()[0]
    latest = conn.execute("SELECT MAX(crash_date) FROM crashes").fetchone()[0]
    db_size = DB_PATH.stat().st_size / (1024 * 1024 * 1024)
    conn.close()

    log(f"\n{'='*60}")
    log(f"Sync complete: {total_new:,} new crashes")
    log(f"DB: {total:,} crashes | {parties_total:,} parties | {db_size:.1f} GB")
    log(f"Latest crash: {latest}")
    log(f"{'='*60}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="ACG Crash Intel — CKAN Datastore Sync")
    parser.add_argument("--year", type=str, help="Sync specific year only (full sync)")
    parser.add_argument("--all-years", action="store_true", help="Full sync of all years")
    parser.add_argument("--cache-only", action="store_true", help="Only refresh cache")
    args = parser.parse_args()

    if args.cache_only:
        conn = get_conn()
        try:
            refresh_location_cache(conn)
        finally:
            conn.close()
        log("Cache refresh done.")
    else:
        sync(full=bool(args.year or args.all_years), specific_year=args.year)
