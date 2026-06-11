#!/usr/bin/env python3
"""
Crash Intelligence API — Flask
Endpoints analíticos sobre datos CCRS 2023-2025
"""
from search_api import search_bp
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone, timedelta
sys.path.insert(0, str(Path(__file__).parent))
import weather as weather_engine

app = Flask(__name__, static_folder='../dashboard', static_url_path='')
app.register_blueprint(search_bp)
CORS(app)

DB_PATH = Path(__file__).parent.parent / "data" / "crash_intel.db"

def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA cache_size=-128000")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn

# ── Helpers ────────────────────────────────────────────────────────────────

def build_where(filters: dict) -> tuple[str, list]:
    """Build WHERE clause and params from filter dict."""
    clauses = []
    params = []

    # Year — usa IN para selección exacta de años, no rango
    if filters.get('year'):
        years = filters['year'] if isinstance(filters['year'], list) else [filters['year']]
        years_int = sorted(int(y) for y in years)
        # Si son años consecutivos sin huecos, usa rango (más rápido)
        if years_int == list(range(years_int[0], years_int[-1]+1)):
            clauses.append(f"c.crash_date >= '{years_int[0]}-01-01' AND c.crash_date < '{years_int[-1]+1}-01-01'")
        else:
            # Años específicos (ej: 2023 y 2025, sin 2024) — usa IN con SUBSTR
            placeholders = ','.join(['?' for _ in years])
            clauses.append(f"SUBSTR(c.crash_date,1,4) IN ({placeholders})")
            params.extend(years)

    # Date range
    if filters.get('date_from'):
        clauses.append("c.crash_date >= ?")
        params.append(filters['date_from'])
    if filters.get('date_to'):
        clauses.append("c.crash_date <= ?")
        params.append(filters['date_to'])

    # City
    if filters.get('city'):
        cities = filters['city'] if isinstance(filters['city'], list) else [filters['city']]
        placeholders = ','.join(['?' for _ in cities])
        clauses.append(f"c.city_name IN ({placeholders})")
        params.extend(cities)

    # County
    if filters.get('county_code'):
        codes = filters['county_code'] if isinstance(filters['county_code'], list) else [filters['county_code']]
        placeholders = ','.join(['?' for _ in codes])
        clauses.append(f"c.county_code IN ({placeholders})")
        params.extend([int(c) for c in codes])

    # Collision type
    if filters.get('collision_type'):
        types = filters['collision_type'] if isinstance(filters['collision_type'], list) else [filters['collision_type']]
        placeholders = ','.join(['?' for _ in types])
        clauses.append(f"c.collision_type_desc IN ({placeholders})")
        params.extend(types)

    # Vehicle make — use lookup so LUCI→LUCID, TOYT→TOYOTA, etc.
    if filters.get('make'):
        makes = filters['make'] if isinstance(filters['make'], list) else [filters['make']]
        placeholders = ','.join(['?' for _ in makes])
        clauses.append("EXISTS (SELECT 1 FROM parties p2 LEFT JOIN vehicle_make_lookup l2 ON p2.vehicle_make_code = l2.make_code WHERE p2.collision_id = c.collision_id AND UPPER(COALESCE(l2.make_name, p2.vehicle_make_code)) IN (" + placeholders + "))")
        params.extend(makes)

    # Has injury
    if filters.get('min_injured') is not None:
        clauses.append("c.number_injured >= ?")
        params.append(int(filters['min_injured']))

    # Bounding box (map viewport)
    if filters.get('lat_min'):
        clauses.append("c.latitude BETWEEN ? AND ?")
        params.extend([float(filters['lat_min']), float(filters['lat_max'])])
    if filters.get('lon_min'):
        clauses.append("c.longitude BETWEEN ? AND ?")
        params.extend([float(filters['lon_min']), float(filters['lon_max'])])

    where = "WHERE 1=1" + (" AND " + " AND ".join(clauses)) if clauses else "WHERE 1=1"
    return where, params


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.route('/api/stats')
def api_stats():
    """Estadísticas globales (KPI cards)."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'county_code': request.args.getlist('county_code'),
        'collision_type': request.args.getlist('collision_type'),
        'make': request.args.getlist('make'),
    }
    where, params = build_where(filters)

    total = conn.execute(f"SELECT COUNT(*) FROM crashes c {where}", params).fetchone()[0]
    injured = conn.execute(f"SELECT COALESCE(SUM(c.number_injured),0), COALESCE(SUM(c.number_killed),0) FROM crashes c {where}", params).fetchone()

    # Most common collision type
    top_type = conn.execute(f"""
        SELECT c.collision_type_desc, COUNT(*) as n
        FROM crashes c {where}
        GROUP BY c.collision_type_desc ORDER BY n DESC LIMIT 1
    """, params).fetchone()

    # Top city
    top_city = conn.execute(f"""
        SELECT c.city_name, COUNT(*) as n
        FROM crashes c {where}
        AND c.city_name IS NOT NULL AND c.city_name != ''
        GROUP BY c.city_name ORDER BY n DESC LIMIT 1
    """, params).fetchone()

    # Avg injured per crash
    avg_inj = conn.execute(f"SELECT AVG(c.number_injured) FROM crashes c {where}", params).fetchone()[0]

    conn.close()
    return jsonify({
        'total_crashes': total,
        'total_injured': injured[0],
        'total_killed': injured[1],
        'top_collision_type': top_type['collision_type_desc'] if top_type else None,
        'top_city': top_city['city_name'] if top_city else None,
        'avg_injured_per_crash': round(avg_inj, 2) if avg_inj else 0,
    })


@app.route('/api/heatmap')
def api_heatmap():
    """Puntos geo para mapa de calor (con filtros + bbox)."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'county_code': request.args.getlist('county_code'),
        'collision_type': request.args.getlist('collision_type'),
        'make': request.args.getlist('make'),
        'lat_min': request.args.get('lat_min'),
        'lat_max': request.args.get('lat_max'),
        'lon_min': request.args.get('lon_min'),
        'lon_max': request.args.get('lon_max'),
        'min_injured': request.args.get('min_injured'),
    }
    where, params = build_where(filters)

    # ALWAYS randomize when limiting — prevents geographic bias (e.g. only SoCal)
    limit = min(int(request.args.get('limit', 50000)), 100000)

    rows = conn.execute(f"""
        SELECT c.latitude, c.longitude, c.number_injured, c.number_killed,
               c.collision_type_desc, c.crash_date
        FROM crashes c {where}
        AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY RANDOM()
        LIMIT ?
    """, params + [limit]).fetchall()

    conn.close()
    return jsonify({
        'points': [{
            'lat': r['latitude'],
            'lon': r['longitude'],
            'weight': min((r["number_injured"] or 0) + (r["number_killed"] or 0) * 3 + 1, 10),
            'injured': r['number_injured'],
            'killed': r['number_killed'],
            'type': r['collision_type_desc'],
        } for r in rows],
        'count': len(rows),
        'truncated': len(rows) >= limit,
    })


@app.route('/api/by-city')
def api_by_city():
    """Top ciudades por número de accidentes."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'collision_type': request.args.getlist('collision_type'),
        'make': request.args.getlist('make'),
        'county_code': request.args.getlist('county_code'),
    }
    where, params = build_where(filters)
    limit = int(request.args.get('limit', 50))

    rows = conn.execute(f"""
        SELECT c.city_name, c.county_code,
               COUNT(*) as total_crashes,
               COALESCE(SUM(c.number_injured),0) as total_injured,
               COALESCE(SUM(c.number_killed),0) as total_killed,
               ROUND(AVG(c.number_injured),2) as avg_injured
        FROM crashes c {where}
        AND c.city_name IS NOT NULL AND c.city_name != ''
        GROUP BY c.city_name, c.county_code
        ORDER BY total_crashes DESC
        LIMIT ?
    """, params + [limit]).fetchall()

    conn.close()
    return jsonify({'cities': [dict(r) for r in rows]})


@app.route('/api/by-make')
def api_by_make():
    """Marcas más involucradas en accidentes."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'county_code': request.args.getlist('county_code'),
        'collision_type': request.args.getlist('collision_type'),
    }
    where, params = build_where(filters)
    limit = int(request.args.get('limit', 40))

    rows = conn.execute(f"""
        SELECT
            UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
            COUNT(*) as crash_count,
            ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age,
            SUM(CASE WHEN p.is_at_fault = 'True' THEN 1 ELSE 0 END) as at_fault_count,
            SUM(CASE WHEN p.is_at_fault = 'True' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as at_fault_pct
        FROM parties p
        JOIN crashes c ON p.collision_id = c.collision_id
        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
        {where}
          AND p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code != ''
        GROUP BY UPPER(COALESCE(l.make_name, p.vehicle_make_code))
        HAVING COALESCE(l.make_name, p.vehicle_make_code) IS NOT NULL AND COALESCE(l.make_name, p.vehicle_make_code) != ""
        ORDER BY crash_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()

    conn.close()
    return jsonify({'makes': [dict(r) for r in rows]})


@app.route('/api/by-month')
def api_by_month():
    """Tendencia mensual de accidentes."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'county_code': request.args.getlist('county_code'),
        'collision_type': request.args.getlist('collision_type'),
        'make': request.args.getlist('make'),
    }
    where, params = build_where(filters)

    rows = conn.execute(f"""
        SELECT SUBSTR(c.crash_date,1,7) as month,
               COUNT(*) as crashes,
               COALESCE(SUM(c.number_injured),0) as injured,
               COALESCE(SUM(c.number_killed),0) as killed
        FROM crashes c {where}
        AND c.crash_date IS NOT NULL
        GROUP BY month
        ORDER BY month
    """, params).fetchall()

    conn.close()
    return jsonify({'months': [dict(r) for r in rows]})


@app.route('/api/by-collision-type')
def api_by_collision_type():
    """Tipos de colisión."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'county_code': request.args.getlist('county_code'),
        'make': request.args.getlist('make'),
    }
    where, params = build_where(filters)

    rows = conn.execute(f"""
        SELECT c.collision_type_desc,
               COUNT(*) as total,
               COALESCE(SUM(c.number_injured),0) as total_injured,
               COALESCE(SUM(c.number_killed),0) as total_killed,
               ROUND(AVG(CASE WHEN c.number_injured > 0 THEN 1.0 ELSE 0.0 END)*100,1) as pct_with_injury
        FROM crashes c {where}
        AND c.collision_type_desc IS NOT NULL AND c.collision_type_desc != ''
        GROUP BY c.collision_type_desc
        ORDER BY total DESC
    """, params).fetchall()

    conn.close()
    return jsonify({'types': [dict(r) for r in rows]})


@app.route('/api/by-day-of-week')
def api_by_day_of_week():
    """Accidentes por día de la semana."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'collision_type': request.args.getlist('collision_type'),
        'make': request.args.getlist('make'),
    }
    where, params = build_where(filters)

    day_order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    rows = conn.execute(f"""
        SELECT c.day_of_week, COUNT(*) as n
        FROM crashes c {where}
        AND c.day_of_week IS NOT NULL
        GROUP BY c.day_of_week
    """, params).fetchall()

    # Order by day of week
    result = {r['day_of_week']: r['n'] for r in rows}
    ordered = [{'day': d, 'crashes': result.get(d, 0)} for d in day_order]

    conn.close()
    return jsonify({'days': ordered})


@app.route('/api/by-hour')
def api_by_hour():
    """Accidentes por hora del día."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'collision_type': request.args.getlist('collision_type'),
        'make': request.args.getlist('make'),
    }
    where, params = build_where(filters)

    rows = conn.execute(f"""
        SELECT CAST(SUBSTR(c.crash_time,1,2) AS INTEGER) as hour,
               COUNT(*) as n,
               COALESCE(SUM(c.number_injured),0) as injured
        FROM crashes c {where}
        AND c.crash_time IS NOT NULL
        GROUP BY hour
        ORDER BY hour
    """, params).fetchall()

    conn.close()
    return jsonify({'hours': [dict(r) for r in rows]})


@app.route('/api/demographics')
def api_demographics():
    """Demografía: edad y género de conductores."""
    conn = get_conn()
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'make': request.args.getlist('make'),
    }
    where, params = build_where(filters)

    rows = conn.execute(f"""
        SELECT
            CASE
                WHEN CAST(p.stated_age AS INTEGER) < 18 THEN '<18'
                WHEN CAST(p.stated_age AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
                WHEN CAST(p.stated_age AS INTEGER) BETWEEN 25 AND 34 THEN '25-34'
                WHEN CAST(p.stated_age AS INTEGER) BETWEEN 35 AND 44 THEN '35-44'
                WHEN CAST(p.stated_age AS INTEGER) BETWEEN 45 AND 54 THEN '45-54'
                WHEN CAST(p.stated_age AS INTEGER) BETWEEN 55 AND 64 THEN '55-64'
                WHEN CAST(p.stated_age AS INTEGER) >= 65 THEN '65+'
                ELSE 'Unknown'
            END as age_group,
            COUNT(*) as n,
            SUM(CASE WHEN p.is_at_fault = 'True' THEN 1 ELSE 0 END) as at_fault
        FROM parties p
        JOIN crashes c ON p.collision_id = c.collision_id
        {where}
        AND p.stated_age IS NOT NULL
        GROUP BY age_group
        ORDER BY MIN(CAST(p.stated_age AS INTEGER))
    """, params).fetchall()

    # Gender breakdown
    gender = conn.execute(f"""
        SELECT COALESCE(p.gender_desc, 'Unknown') as gender, COUNT(*) as n
        FROM parties p
        JOIN crashes c ON p.collision_id = c.collision_id
        {where}
        GROUP BY p.gender_desc
        ORDER BY n DESC
    """, params).fetchall()

    conn.close()
    return jsonify({
        'age_groups': [dict(r) for r in rows],
        'genders': [dict(r) for r in gender],
    })


@app.route('/api/luxury-brands')
def api_luxury_brands():
    """Luxury/premium brands — from precomputed cache (< 1ms)."""
    conn = get_conn()
    year = request.args.get('year', '2025')
    # Use the most specific year if multiple selected
    if request.args.getlist('year'):
        year = request.args.getlist('year')[0]

    # Try cache first
    cached = conn.execute(
        "SELECT data FROM analytics_cache WHERE cache_key = ?",
        [f'luxury_brands_{year}']
    ).fetchone()

    if cached:
        conn.close()
        return jsonify({'luxury': json.loads(cached[0])})

    # Fallback: live query
    filters = {
        'year': request.args.getlist('year'),
        'city': request.args.getlist('city'),
        'county_code': request.args.getlist('county_code'),
    }
    where, params = build_where(filters)

    luxury = ['TESLA','BMW','MERCEDES-BENZ','AUDI','LEXUS','PORSCHE',
              'MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI',
              'GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']

    placeholders = ','.join(['?' for _ in luxury])
    rows = conn.execute(f"""
        SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
               COUNT(*) as crashes,
               ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age,
               SUM(CASE WHEN p.is_at_fault = 'True' THEN 1 ELSE 0 END) as at_fault
        FROM parties p
        JOIN crashes c ON p.collision_id = c.collision_id
        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
        {where}
          AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) IN ({placeholders})
        GROUP BY 1
        ORDER BY crashes DESC
    """, params + luxury).fetchall()

    conn.close()
    return jsonify({'luxury': [dict(r) for r in rows]})


@app.route('/api/filters')
def api_filters():
    """Opciones disponibles para filtros — cacheado (< 1ms)."""
    conn = get_conn()

    # Try cache first (refresh daily — cached 24h)
    cached = conn.execute(
        "SELECT data, updated_at FROM analytics_cache WHERE cache_key = 'filters'"
    ).fetchone()

    if cached:
        data = json.loads(cached[0])
        age_hours = (datetime.utcnow() - datetime.fromisoformat(cached[1])).total_seconds() / 3600 if cached[1] else 999
        if age_hours < 24:
            conn.close()
            return jsonify(data)

    # Cache miss or expired — rebuild (expensive, ~17s on cold DB)
    years = [r[0] for r in conn.execute(
        "SELECT DISTINCT SUBSTR(crash_date,1,4) FROM crashes WHERE crash_date IS NOT NULL ORDER BY 1"
    ).fetchall()]

    cities = [r[0] for r in conn.execute("""
        SELECT city_name FROM crashes
        WHERE city_name IS NOT NULL AND city_name != ''
        GROUP BY city_name
        HAVING COUNT(*) > 100
        ORDER BY COUNT(*) DESC
        LIMIT 100
    """).fetchall()]

    col_types = [r[0] for r in conn.execute("""
        SELECT DISTINCT collision_type_desc FROM crashes
        WHERE collision_type_desc IS NOT NULL AND collision_type_desc != ''
        ORDER BY collision_type_desc
    """).fetchall()]

    # Vehicle makes — include ALL premium/luxury brands regardless of volume
    PREMIUM_MAKES = ['ACURA','ALFA ROMEO','ASTON MARTIN','AUDI','BENTLEY','BMW','CADILLAC',
                     'FERRARI','GENESIS','INFINITI','JAGUAR','LAMBORGHINI','LAND ROVER',
                     'LEXUS','LOTUS','LUCID','MASERATI','MCLAREN','MERCEDES-BENZ',
                     'POLESTAR','PORSCHE','RIVIAN','ROLLS ROYCE','TESLA','VOLVO']

    # Single query — get ALL makes with counts, then filter in Python (avoids N+1)
    all_makes = conn.execute("""
        SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
               COUNT(*) as n
        FROM parties p
        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
        WHERE p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code != ''
        GROUP BY 1
        ORDER BY n DESC
    """).fetchall()

    # Top 60 by volume + any premium make that exists (even low volume)
    makes = []
    seen = set()
    for row in all_makes:
        if len(makes) >= 60 and row['make'] not in PREMIUM_MAKES:
            continue
        if row['make'] not in seen:
            makes.append(row['make'])
            seen.add(row['make'])

    # Add any missing premium makes that exist in DB
    for pm in PREMIUM_MAKES:
        if pm not in seen:
            # Check if it exists in the all_makes results
            for row in all_makes:
                if row['make'] == pm:
                    makes.append(pm)
                    seen.add(pm)
                    break

    # Sort alphabetically
    makes.sort()

    # County codes
    counties = [dict(r) for r in conn.execute("""
        SELECT c.county_code, c.city_name as sample_city
        FROM crashes c
        WHERE c.county_code IS NOT NULL
        GROUP BY c.county_code
        ORDER BY COUNT(*) DESC
        LIMIT 58
    """).fetchall()]

    result = {
        'years': years,
        'cities': cities,
        'collision_types': col_types,
        'makes': makes,
        'counties': counties,
    }

    # Cache for 24h
    conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES (?, ?, datetime('now'))",
                 ['filters', json.dumps(result)])
    conn.commit()
    conn.close()

    return jsonify(result)


@app.route('/api/acg-locations')
def api_acg_locations():
    """Datos de accidentes para cada taller ACG — desde caché (< 10ms)."""
    conn = get_conn()
    year = request.args.get('year', '2025')

    locations = [
        {'name': 'Whittier HQ',          'address': '12426 Lambert Rd., Whittier, CA 90606',            'phone': '562-317-1400', 'lat': 33.9792,  'lon': -118.0327},
        {'name': 'Los Angeles',          'address': 'Los Angeles, CA 90001',                            'phone': '833-333-4224', 'lat': 34.0522,  'lon': -118.2437},
        {'name': 'Gardena — Rosecrans',  'address': '1706 W Rosecrans Ave., Gardena, CA 90249',        'phone': '424-360-0700', 'lat': 33.8969,  'lon': -118.3092},
        {'name': 'Gardena — Vermont',    'address': 'Gardena, CA 90247',                               'phone': '833-333-4224', 'lat': 33.8883,  'lon': -118.3089},
        {'name': 'Santa Ana',            'address': 'Santa Ana, CA 92701',                             'phone': '833-333-4224', 'lat': 33.7455,  'lon': -117.8677},
        {'name': 'Covina',               'address': 'Covina, CA 91722',                                'phone': '833-333-4224', 'lat': 34.0900,  'lon': -117.8903},
        {'name': 'Ontario',              'address': 'Ontario, CA 91761',                               'phone': '833-333-4224', 'lat': 34.0633,  'lon': -117.6509},
        {'name': 'Rancho Cucamonga',     'address': 'Rancho Cucamonga, CA 91730',                      'phone': '833-333-4224', 'lat': 34.1064,  'lon': -117.5931},
        {'name': 'Victorville',          'address': 'Victorville, CA 92392',                           'phone': '833-333-4224', 'lat': 34.5362,  'lon': -117.2928},
        {'name': 'Fresno',               'address': 'Fresno, CA 93711',                                'phone': '833-333-4224', 'lat': 36.7378,  'lon': -119.7871},
        {'name': 'Bakersfield — Ming',   'address': 'Ming Ave, Bakersfield, CA 93301',                 'phone': '833-333-4224', 'lat': 35.3733,  'lon': -119.0187},
        {'name': 'Bakersfield — McCutchen','address': '6916 McCutchen Rd., Bakersfield, CA 93309',    'phone': '661-460-1400', 'lat': 35.3345,  'lon': -119.0778},
        {'name': 'El Cajon',             'address': 'El Cajon, CA 92020',                              'phone': '833-333-4224', 'lat': 32.7948,  'lon': -116.9625},
    ]

    results = []
    for loc in locations:
        name = loc['name']
        cached = conn.execute("SELECT data FROM acg_location_cache WHERE year=? AND name=?", [year, name]).fetchone()
        if cached:
            d = json.loads(cached[0])
            d['name'] = name
            d['address'] = loc['address']
            d['lat'] = loc['lat']
            d['lon'] = loc['lon']
            results.append(d)
        else:
            results.append({'name': name, 'address': loc['address'], 'total_crashes': 0, 'total_injured': 0})

    conn.close()
    return jsonify({'locations': results, 'year': year})


@app.route('/api/billboard-intel')
def api_billboard_intel():
    """Inteligencia para billboards: mejores corredores por condado/marca."""
    conn = get_conn()
    year = request.args.get('year', '2025')
    make = request.args.get('make', '').upper()

    params = [f'{year}-01-01', f'{int(year)+1}-01-01']
    make_join = ""
    make_where = ""
    if make:
        make_join = """JOIN parties p ON c.collision_id = p.collision_id
                        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code"""
        make_where = "AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) = ?"
        params.append(make)

    # Top roads/highways for billboard placement (high crash count + high injury = high visibility)
    roads = [dict(r) for r in conn.execute(f"""
        SELECT c.primary_road, c.county_code, c.city_name,
               COUNT(*) as crashes,
               COALESCE(SUM(c.number_injured),0) as injured,
               ROUND(AVG(c.number_injured),2) as avg_injured,
               ROUND(AVG(c.latitude),5) as lat,
               ROUND(AVG(c.longitude),5) as lon
        FROM crashes c {make_join}
        WHERE c.crash_date >= ? AND c.crash_date < ?
        AND c.primary_road IS NOT NULL AND c.primary_road != ''
        AND c.primary_road NOT LIKE '%UNNAMED%'
        AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        {make_where}
        GROUP BY c.primary_road, c.county_code
        HAVING crashes >= 50
        ORDER BY crashes DESC
        LIMIT 30
    """, params).fetchall()]

    conn.close()
    return jsonify({'roads': roads, 'make_filter': make or 'TODAS', 'year': year})


@app.route('/api/ad-intel-composite')
def api_ad_intel_composite():
    """Geo-fence zones enriched with DMV luxury vehicle registration data.

    For each zone, finds nearby ZIP codes and sums luxury vehicle registrations,
    then calculates a composite score weighting:
      - 30% crash volume
      - 25% luxury crash mix
      - 25% DMV luxury density (vehicles registered nearby)
      - 20% ACG proximity
    """
    conn = get_conn()
    year = request.args.get('year', '2025')
    make = request.args.get('make', '').upper()
    city = request.args.get('city', '')
    min_crashes = int(request.args.get('min_crashes', 25))
    limit = min(int(request.args.get('limit', 60)), 100)
    radius_miles = float(request.args.get('dmv_radius', 5))

    # Check cache first (24h TTL)
    cache_make = make if make else 'ALL'
    cache_key = f'composite_{year}_{cache_make}_{min_crashes}'
    cached = conn.execute("SELECT data, updated_at FROM ad_intel_cache WHERE cache_key=?", [cache_key]).fetchone()
    if cached:
        data = json.loads(cached[0])
        age_hours = (datetime.now(timezone.utc) - datetime.fromisoformat(cached[1]).replace(tzinfo=timezone.utc)).total_seconds() / 3600
        if age_hours < 24:
            data['_cached'] = True
            data['_cache_age_hours'] = round(age_hours, 1)
            conn.close()
            return jsonify(data)

    # Get base geo-fence zones
    LOW_VOLUME = {'LUCID','RIVIAN','BENTLEY','LAMBORGHINI','FERRARI','MASERATI','GENESIS','ASTON MARTIN','ROLLS ROYCE','MCLAREN'}
    if make in LOW_VOLUME:
        min_crashes = max(2, min_crashes // 5)

    y1, y2 = f'{year}-01-01', f'{int(year)+1}-01-01'
    params = [y1, y2]

    where_c = ["c.crash_date >= ? AND c.crash_date < ?",
               "c.latitude IS NOT NULL", "c.longitude IS NOT NULL",
               "c.primary_road IS NOT NULL", "c.primary_road != ''",
               "c.primary_road NOT LIKE '%UNNAMED%'"]
    if city:
        where_c.append("c.city_name = ?")
        params.append(city)

    query = f"""
        SELECT c.primary_road, c.secondary_road, c.city_name,
               ROUND(AVG(c.latitude), 5) as center_lat,
               ROUND(AVG(c.longitude), 5) as center_lon,
               COUNT(*) as total_crashes,
               COALESCE(SUM(c.number_injured), 0) as total_injured,
               COALESCE(SUM(c.number_killed), 0) as total_killed,
               ROUND(CAST(SUM(CASE WHEN c.number_injured > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1) as injury_pct
        FROM crashes c
        WHERE {' AND '.join(where_c)}
        GROUP BY c.primary_road, COALESCE(c.secondary_road, ''), c.city_name
        HAVING total_crashes >= {max(10, min_crashes)}
        ORDER BY total_crashes DESC
        LIMIT {limit * 2}
    """
    base_zones = [dict(r) for r in conn.execute(query, params).fetchall()]

    if not base_zones:
        conn.close()
        return jsonify({'zones': [], 'count': 0})

    # ACG locations for proximity scoring
    acg_locs = [
        {'name':'Whittier HQ','lat':33.9792,'lon':-118.0327},
        {'name':'Los Angeles','lat':34.0522,'lon':-118.2437},
        {'name':'Gardena — Rosecrans','lat':33.8969,'lon':-118.3092},
        {'name':'Gardena — Vermont','lat':33.8883,'lon':-118.3089},
        {'name':'Santa Ana','lat':33.7455,'lon':-117.8677},
        {'name':'Covina','lat':34.0900,'lon':-117.8903},
        {'name':'Ontario','lat':34.0633,'lon':-117.6509},
        {'name':'Rancho Cucamonga','lat':34.1064,'lon':-117.5931},
        {'name':'Victorville','lat':34.5362,'lon':-117.2928},
        {'name':'Fresno','lat':36.7378,'lon':-119.7871},
        {'name':'Bakersfield — Ming','lat':35.3733,'lon':-119.0187},
        {'name':'Bakersfield — McCutchen','lat':35.3345,'lon':-119.0778},
        {'name':'El Cajon','lat':32.7948,'lon':-116.9625},
    ]

    # Luxury brand list for crash query
    LUXURY_MAKES = ['TESLA','BMW','MERCEDES-BENZ','AUDI','LEXUS','PORSCHE',
                    'MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI',
                    'GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']

    # Build enriched zones — single DMV spatial JOIN for speed
    # Pre-compute all zone-to-ZIP mappings in one pass
    zone_results = []
    dmv_data_by_zone = {}
    dmv_year = year if year in ['2019','2020','2021','2022','2023','2024','2025'] else '2025'

    # For each zone, find nearby ZIPs + DMV data in ONE query using spatial JOIN
    for z in base_zones:
        lat, lon = z['center_lat'], z['center_lon']
        lat_r = radius_miles / 69.0
        lon_r = radius_miles / (69.0 * abs(math.cos(math.radians(lat))))
        # Single query: JOIN zip_centroids + DMV table
        ph = ','.join(['?' for _ in LUXURY_MAKES])
        dmv_rows = conn.execute(f"""
            SELECT d.make, SUM(d.vehicles) as total
            FROM dmv_vehicles_by_zip d
            JOIN zip_centroids zc ON d.zip_code = zc.zip_code
            WHERE d.data_year = ?
              AND zc.lat BETWEEN ? AND ? AND zc.lon BETWEEN ? AND ?
              AND d.make IN ({ph})
            GROUP BY d.make ORDER BY total DESC
        """, [dmv_year, lat - lat_r, lat + lat_r, lon - lon_r, lon + lon_r] + LUXURY_MAKES).fetchall()

        dmv_luxury_total = sum(r['total'] for r in dmv_rows)
        dmv_top_brands = [{'make': r['make'], 'vehicles': r['total']} for r in dmv_rows[:5]]
        dmv_data_by_zone[z['primary_road'] + '|' + (z.get('secondary_road') or '')] = {
            'total': dmv_luxury_total,
            'brands': dmv_top_brands,
            'zips': len(dmv_rows)
        }

    for z in base_zones:
        lat, lon = z['center_lat'], z['center_lon']
        key = z['primary_road'] + '|' + (z.get('secondary_road') or '')
        dmv_info = dmv_data_by_zone.get(key, {'total': 0, 'brands': [], 'zips': 0})
        dmv_luxury_total = dmv_info['total']
        dmv_top_brands = dmv_info['brands']
        nearby_zip_count = dmv_info['zips']

        # ── Luxury crash breakdown ──
        lux_ph = ','.join(['?' for _ in LUXURY_MAKES])
        sec_where = "AND (c2.secondary_road = ? OR (c2.secondary_road IS NULL AND ? = ''))"
        lux_params = [y1, y2, z['primary_road'], z['secondary_road'] or '', z['secondary_road'] or '']
        lux_rows = conn.execute(f"""
            SELECT UPPER(COALESCE(vl.make_name, p2.vehicle_make_code)) as make,
                   COUNT(*) as crashes
            FROM crashes c2
            JOIN parties p2 ON c2.collision_id = p2.collision_id
            LEFT JOIN vehicle_make_lookup vl ON p2.vehicle_make_code = vl.make_code
            WHERE c2.crash_date >= ? AND c2.crash_date < ?
              AND c2.primary_road = ? {sec_where}
              AND c2.latitude IS NOT NULL
              AND UPPER(COALESCE(vl.make_name, p2.vehicle_make_code)) IN ({lux_ph})
            GROUP BY 1 ORDER BY crashes DESC
        """, lux_params + LUXURY_MAKES).fetchall()

        luxury_breakdown = {r['make']: r['crashes'] for r in lux_rows if r['crashes']}
        total_luxury = sum(luxury_breakdown.values())
        luxury_pct = round(total_luxury / max(z['total_crashes'], 1) * 100, 1)

        # ── ACG proximity score ──
        min_acg_dist = 999
        nearest_acg = None
        for acg in acg_locs:
            dlat = lat - acg['lat']
            dlon = lon - acg['lon']
            dist = math.sqrt(dlat**2 + (dlon * math.cos(math.radians(lat)))**2) * 69.0
            if dist < min_acg_dist:
                min_acg_dist = dist
                nearest_acg = acg['name']
        acg_score = max(0, 100 - min_acg_dist * 2)  # 0 at 50+ miles, 100 at 0 miles

        # ── Composite score ──
        # Normalize each component to 0-100
        max_crashes = max(b['total_crashes'] for b in base_zones)
        crash_score = (z['total_crashes'] / max(max_crashes, 1)) * 100
        luxury_pct_score = luxury_pct  # Already 0-100

        # DMV density score (logarithmic to handle wide range)
        dmv_max = max(1, *(r.get('_dmv_total', 1) for r in zone_results), dmv_luxury_total)
        if dmv_luxury_total > 0:
            dmv_score = min(100, (dmv_luxury_total / max(dmv_max, 1)) * 100)
        else:
            dmv_score = 0

        # Composite: 30% crash volume + 25% luxury mix + 25% DMV density + 20% ACG proximity
        composite = round(
            crash_score * 0.30 +
            luxury_pct_score * 0.25 +
            dmv_score * 0.25 +
            acg_score * 0.20
        )

        # Peak hours
        peak_hours = [dict(r) for r in conn.execute("""
            SELECT CAST(SUBSTR(c.crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n
            FROM crashes c
            WHERE c.crash_date >= ? AND c.crash_date < ?
              AND c.primary_road = ?
              AND (c.secondary_road = ? OR (c.secondary_road IS NULL AND ? = ''))
              AND c.crash_time IS NOT NULL
            GROUP BY hour ORDER BY n DESC LIMIT 3
        """, [y1, y2, z['primary_road'], z['secondary_road'] or '', z['secondary_road'] or '']).fetchall()]

        peak_day_row = conn.execute("""
            SELECT c.day_of_week, COUNT(*) as n FROM crashes c
            WHERE c.crash_date >= ? AND c.crash_date < ?
              AND c.primary_road = ?
              AND (c.secondary_road = ? OR (c.secondary_road IS NULL AND ? = ''))
              AND c.day_of_week IS NOT NULL
            GROUP BY c.day_of_week ORDER BY n DESC LIMIT 1
        """, [y1, y2, z['primary_road'], z['secondary_road'] or '', z['secondary_road'] or '']).fetchone()

        # Backward-compatible radius
        radius_m = round(800 + (1 - composite/100) * 2200) if composite < 100 else 800

        zone_results.append({
            'zone_id': f"{z['primary_road'][:20].replace(' ','-').replace('/','-')}-{z.get('secondary_road','')[:10] if z.get('secondary_road') else ''}",
            'name': f"{z['primary_road']}{' × ' + z['secondary_road'] if z.get('secondary_road') else ''}",
            'primary_road': z['primary_road'],
            'secondary_road': z.get('secondary_road') or '',
            'city': z.get('city_name') or '',
            'center': {'lat': z['center_lat'], 'lon': z['center_lon']},
            'radius_meters': radius_m,
            'ad_score': composite,  # Backward compat — now the composite score
            'composite_score': composite,
            'stats': {
                'total_crashes': z['total_crashes'],
                'total_injured': z['total_injured'],
                'total_killed': z['total_killed'],
                'injury_pct': z['injury_pct'],
                'total_luxury': total_luxury,
                'luxury_pct': luxury_pct,
                'top_luxury': [{'make': m, 'crashes': c} for m, c in sorted(luxury_breakdown.items(), key=lambda x: x[1], reverse=True)[:5]],
                'peak_hours': peak_hours,
                'peak_day': peak_day_row['day_of_week'] if peak_day_row else None,
                # DMV enrichment
                'dmv_luxury_total': dmv_luxury_total,
                'dmv_top_brands': dmv_top_brands,
                'dmv_zip_count': nearby_zip_count,
                'dmv_radius_miles': radius_miles,
                # ACG proximity
                'nearest_acg': nearest_acg,
                'acg_distance_miles': round(min_acg_dist, 1),
                # Component scores
                'score_breakdown': {
                    'crash_volume': round(crash_score),
                    'luxury_mix': round(luxury_pct_score),
                    'dmv_density': round(dmv_score),
                    'acg_proximity': round(acg_score),
                }
            }
        })

    # Re-sort by composite score
    zone_results.sort(key=lambda z: z['composite_score'], reverse=True)
    zone_results = zone_results[:limit]

    # Recalculate dmv_max after final sort for accurate relative scores
    if zone_results:
        dmv_values = [z['stats']['dmv_luxury_total'] for z in zone_results]
        dmv_max_val = max(dmv_values) if max(dmv_values) > 0 else 1
        for z in zone_results:
            z['stats']['score_breakdown']['dmv_density'] = round(
                min(100, (z['stats']['dmv_luxury_total'] / dmv_max_val) * 100))

    result = {
        'zones': zone_results,
        'count': len(zone_results),
        'filters': {'year': year, 'make': make or 'ALL', 'city': city or 'ALL', 'dmv_radius_miles': radius_miles},
    }

    # Cache for 24h
    conn.execute("INSERT OR REPLACE INTO ad_intel_cache VALUES (?, ?, datetime('now'))",
                 [cache_key, json.dumps(result)])
    conn.commit()
    conn.close()

    return jsonify(result)


@app.route('/api/claims-intel')
def api_claims_intel():
    """Claims Intelligence — CDI claims data × CCRS crashes × DMV registrations.

    Cross-references California Department of Insurance actual claims data
    with police-reported crashes to show the full market picture.
    """
    conn = get_conn()
    year = request.args.get('year', '2022')  # CDI most recent year available
    ccr_year = request.args.get('ccr_year', '2025')  # CCRS most recent complete year

    # ── CDI State-level totals ──
    liab_total = conn.execute("""
        SELECT num_claims, incurred_losses, earned_exposure
        FROM cdi_liability_claims WHERE year=? AND program='ALL' AND coverage='ALL'
    """, [year]).fetchone()

    phys_total = conn.execute("""
        SELECT num_claims, incurred_losses, earned_exposure
        FROM cdi_physical_damage_claims WHERE year=? AND program='ALL' AND coverage='ALL'
    """, [year]).fetchone()

    phys_collision = conn.execute("""
        SELECT SUM(num_claims) as num_claims, SUM(incurred_losses) as incurred_losses
        FROM cdi_physical_damage_claims
        WHERE year=? AND program IN ('1 - Standard','2 - Non-Standard','3 - Motorcycle')
    """, [year]).fetchone()

    # Compute variables first
    total_liab = liab_total['num_claims'] if liab_total else 0
    total_phys = phys_total['num_claims'] if phys_total else 0
    total_liab_losses = liab_total['incurred_losses'] if liab_total else 0
    total_phys_losses = phys_total['incurred_losses'] if phys_total else 0
    total_claims = total_liab + total_phys
    total_prog_claims = phys_collision['num_claims'] if phys_collision and phys_collision['num_claims'] else 0
    comp_claims_est = max(0, total_phys - total_prog_claims)
    total_prog_losses = phys_collision['incurred_losses'] if phys_collision and phys_collision['incurred_losses'] else 0
    comp_losses_est = max(0, total_phys_losses - total_prog_losses)

    # ── CCRS police-reported totals ──
    yr = int(year)
    ccr_yr = int(ccr_year)
    ccr_total = conn.execute("""
        SELECT COUNT(*) FROM crashes WHERE crash_date>=? AND crash_date<?
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01']).fetchone()[0]

    ccr_injured = conn.execute("""
        SELECT COALESCE(SUM(number_injured),0), COALESCE(SUM(number_killed),0)
        FROM crashes WHERE crash_date>=? AND crash_date<?
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01']).fetchone()

    ccr_towed = conn.execute("""
        SELECT COUNT(*) FROM crashes WHERE crash_date>=? AND crash_date<? AND is_tow_away=1
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01']).fetchone()[0]

    # ── County distribution ──
    counties = conn.execute("""
        SELECT c.county_code, c.city_name as sample_city,
               COUNT(*) as crashes, COALESCE(SUM(c.number_injured),0) as injured,
               SUM(CASE WHEN c.is_tow_away=1 THEN 1 ELSE 0 END) as towed
        FROM crashes c
        WHERE c.crash_date>=? AND c.crash_date<? AND c.county_code IS NOT NULL
        GROUP BY c.county_code ORDER BY crashes DESC LIMIT 58
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01']).fetchall()

    # ── Compute metrics ──
    collision_claims = total_prog_claims
    comp_claims = comp_claims_est
    collision_losses = total_prog_losses
    comp_losses = comp_losses_est

    total_market = total_liab_losses + total_phys_losses
    claims_per_crash = total_claims / max(ccr_total, 1)
    # Non-police: comprehensive (never police) + estimated unreported minor collisions
    non_police_est = comp_claims + max(0, collision_claims - ccr_total)

    avg_collision_claim = collision_losses / max(collision_claims, 1)
    avg_comp_claim = comp_losses / max(comp_claims, 1)

    # County-level distribution
    county_data = []
    for c in counties:
        share = c['crashes'] / max(ccr_total, 1)
        county_data.append({
            'county_code': c['county_code'],
            'sample_city': c['sample_city'],
            'ccr_crashes': c['crashes'],
            'ccr_injured': c['injured'],
            'ccr_towed': c['towed'],
            'est_total_claims': round(share * total_claims),
            'est_collision_claims': round(share * collision_claims),
            'est_comprehensive_claims': round(share * comp_claims),
            'est_market_value': round(share * total_market),
            'crash_share_pct': round(share * 100, 1),
        })

    # ── Luxury make breakdown ──
    luxury_makes = ['BMW','MERCEDES-BENZ','TESLA','AUDI','LEXUS','PORSCHE',
                    'MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI',
                    'GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']
    lx_ph = ','.join(['?' for _ in luxury_makes])
    luxury_rows = conn.execute(f"""
        SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
               COUNT(*) as crashes,
               SUM(CASE WHEN c.is_tow_away=1 THEN 1 ELSE 0 END) as tow_aways,
               ROUND(AVG(CASE WHEN c.number_injured>0 THEN 1.0 ELSE 0.0 END)*100,1) as injury_rate
        FROM parties p JOIN crashes c ON p.collision_id=c.collision_id
        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code
        WHERE c.crash_date>=? AND c.crash_date<?
          AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) IN ({lx_ph})
        GROUP BY 1 ORDER BY crashes DESC
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01'] + luxury_makes).fetchall()

    # DMV luxury total
    dmv_total = conn.execute(f"""
        SELECT SUM(vehicles) FROM dmv_vehicles_by_zip
        WHERE data_year=? AND zip_code!='OOS' AND make IN ({lx_ph})
    """, ['2025'] + luxury_makes).fetchone()[0] or 0

    # ── Insurer breakdown ──
    insurers = [dict(r) for r in conn.execute("""
        SELECT company_name, written_premium, market_share, incurred_losses, loss_ratio
        FROM cdi_insurers ORDER BY written_premium DESC LIMIT 20
    """).fetchall()]

    # ── Vehicle type breakdown (from CCRS parties) ──
    vehicle_types = [dict(r) for r in conn.execute("""
        SELECT p.vehicle_type_desc as vehicle_type,
               COUNT(*) as crashes,
               SUM(CASE WHEN c.is_tow_away=1 THEN 1 ELSE 0 END) as tow_aways
        FROM parties p JOIN crashes c ON p.collision_id=c.collision_id
        WHERE c.crash_date>=? AND c.crash_date<?
          AND p.vehicle_type_desc IS NOT NULL AND p.vehicle_type_desc != ''
        GROUP BY p.vehicle_type_desc ORDER BY crashes DESC LIMIT 10
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01']).fetchall()]

    # EV-specific breakdown
    ev_crashes = conn.execute("""
        SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crashes
        FROM parties p JOIN crashes c ON p.collision_id=c.collision_id
        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code
        WHERE c.crash_date>=? AND c.crash_date<?
          AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) IN ('TESLA','RIVIAN','LUCID','POLESTAR')
        GROUP BY 1 ORDER BY crashes DESC
    """, [f'{ccr_yr}-01-01', f'{ccr_yr+1}-01-01']).fetchall()

    # ── Customer-Pay estimates (industry data) ──
    customer_pay_pct = 0.20  # 2025 industry average
    customer_pay_market = total_market * customer_pay_pct / (1 - customer_pay_pct) if customer_pay_pct < 1 else 0
    total_market_with_cp = total_market + customer_pay_market

    # ── Market Intelligence (industry data) ──
    market_intel = {
        'shops': {
            'us_total': 36000,
            'ca_total': 3800,
            'ca_per_100k': 9.7,
            'independent_pct': 52,
            'mso_pct': 28,
            'regional_chain_pct': 20,
            'closures_2024': 800,
            'note': '~800 independent shops closed in 2024. Consolidators (MSOs) growing 15-22% per year.'
        },
        'msos': [
            {'name': 'Caliber Collision', 'us_locations': 1800, 'ca_locations': 220, 'market_position': '#1 US MSO. PE-backed (Hellman & Friedman)'},
            {'name': 'Crash Champions', 'us_locations': 650, 'ca_locations': 85, 'market_position': 'Fastest growing. PE-backed (Clearlake Capital)'},
            {'name': 'Gerber Collision', 'us_locations': 700, 'ca_locations': 70, 'market_position': 'Boyd Group (Canada, publicly traded)'},
            {'name': 'Classic Collision', 'us_locations': 280, 'ca_locations': 25, 'market_position': 'PE-backed. +22% growth in 2024'},
            {'name': 'Joe Hudson\'s', 'us_locations': 250, 'ca_locations': 30, 'market_position': 'PE-backed. +22% growth in 2024'},
            {'name': 'Fix Auto USA', 'us_locations': 350, 'ca_locations': 45, 'market_position': 'Franchise model. Part of Fix Network'},
            {'name': 'G&C Auto Body', 'us_locations': 43, 'ca_locations': 43, 'market_position': 'CA-focused. 31→43 shops in 2024'},
            {'name': 'Service King', 'us_locations': 300, 'ca_locations': 35, 'market_position': 'Declining. Many locations closed/sold'},
        ],
        'mso_consolidation': {
            'big5_market_share_pct': 30,
            'big5_names': ['Caliber', 'Crash Champions', 'Gerber', 'Classic Collision', "Joe Hudson's"],
            'big5_footprint_growth_2024_pct': 13,
            'big5_shops_end_2024': 3842,
            'pe_sharks_shops': 376,
            'pe_sharks_added_2024': 100,
            'independent_closures_2024': 800,
        },
        'drp': {
            'pct_claims_through_drp': 60,
            'top_insurer_drp': 'State Farm Select Service',
            'note': '~60% of insurance claims go through DRP. CA has strong anti-steering laws — customer chooses shop.'
        },
        'oem_certifications': {
            'pct_shops_certified': 54,
            'top_certs': [
                {'make': 'Tesla', 'pct_of_certified': 26},
                {'make': 'BMW', 'pct_of_certified': 9},
                {'make': 'Mercedes-Benz', 'pct_of_certified': 9},
                {'make': 'Audi', 'pct_of_certified': 9},
                {'make': 'Lexus', 'pct_of_certified': 11},
                {'make': 'Porsche', 'pct_of_certified': 7},
            ],
        },
        'repair_economics': {
            'avg_repair_cost_2025': 5470,
            'avg_repair_cost_2014': 2169,
            'increase_10yr_pct': 152,
            'labor_rate_avg': 65,
            'labor_rate_ca': 78,
            'labor_rate_increase_2024_pct': 4.5,
            'labor_rate_increase_2023_pct': 7.5,
            'parts_vs_labor_pct': 55,
            'oem_parts_pct': 35,
            'aftermarket_parts_pct': 38,
            'recycled_parts_pct': 27,
            'total_loss_pct': 22.6,
            'total_loss_over_7yr_pct': 70,
            'avg_vehicle_age_at_repair': 7.3,
            'ev_repair_premium_pct': 47,
            'gross_profit_margin_max_pct': 48,
            'calibrations_on_estimates_pct': 31,
            'scans_on_estimates_pct': 87,
            'avg_parts_per_job': 13.6,
            'avg_labor_hours_per_claim': 26.7,
        },
        'claim_frequency_per_vehicle': {
            'collision': 0.06514,
            'comprehensive': 0.03862,
            'property_damage': 0.03222,
            'bodily_injury': 0.00760,
            'note': 'Claims per insured vehicle-year (CA DOI rating standards)',
        },
        'claim_severity': {
            'bodily_injury': 14096,
            'collision': 4725,
            'property_damage': 3202,
            'comprehensive': 1820,
            'medical_payments': 855,
            'note': 'Average cost per claim in CA (CA DOI data)',
        },
        'market_size': {
            'ca_annual_revenue_billions': 9.5,
            'us_annual_revenue_billions': 48,
            'ca_pct_of_us': 19.8,
            'avg_shop_revenue_ca': 2500000,
            'top_shop_revenue': 5000000,
            'acg_estimated_revenue': 39000000,  # 13 shops × $3M avg
            'acg_market_share_pct': 0.41,
        },
    }

    conn.close()

    return jsonify({
        'cdi_year': year,
        'ccr_year': ccr_year,
        'state_summary': {
            'cdi_liability_claims': total_liab,
            'cdi_physical_damage_claims': total_phys,
            'cdi_collision_claims': collision_claims,
            'cdi_comprehensive_claims': comp_claims,
            'ccr_police_reported': ccr_total,
            'ccr_injured': ccr_injured[0],
            'ccr_killed': ccr_injured[1],
            'ccr_towed': ccr_towed,
            'non_police_claims': non_police_est,
            'total_market_value': round(total_market),
            'avg_collision_claim': round(avg_collision_claim),
            'avg_comprehensive_claim': round(avg_comp_claim),
            'claims_per_crash': round(claims_per_crash, 1),
            'police_reported_pct': round(ccr_total/max(total_claims,1)*100, 1),
            'dmv_luxury_total': dmv_total,
        },
        'county_data': sorted(county_data, key=lambda x: x['est_total_claims'], reverse=True),
        'luxury_claims': [dict(r) for r in luxury_rows],
        'insurers': insurers,
        'vehicle_types': vehicle_types,
        'ev_crashes': [dict(r) for r in ev_crashes],
        'customer_pay': {
            'pct': round(customer_pay_pct * 100),
            'market_value': round(customer_pay_market),
            'total_market_with_cp': round(total_market_with_cp),
            'note': 'Customer-pay = repairs paid out-of-pocket (no insurance). ~20% of market in 2025, rising from ~8% in 2021.'
        },
        'market_intel': market_intel,
    })


@app.route('/api/geo-fence')
def api_geo_fence():
    """Geo-fence advertising zones — high-crash intersections ranked by ad-score.

    Composite ad-score weights:
      - 40% crash volume (normalized)
      - 30% injury severity (% of crashes with injuries)
      - 30% luxury/premium mix (% of luxury brands)

    Returns top zones with center coords + radius for ad targeting.
    """
    conn = get_conn()
    year = request.args.get('year', '2025')
    make = request.args.get('make', '').upper()
    city = request.args.get('city', '')
    # Dynamic threshold: much lower for specific low-volume makes
    LOW_VOLUME = {'LUCID','RIVIAN','BENTLEY','LAMBORGHINI','FERRARI','MASERATI','GENESIS','ASTON MARTIN','ROLLS ROYCE','MCLAREN'}
    default_min = 2 if make in LOW_VOLUME else (8 if make else 30)
    min_crashes = int(request.args.get('min_crashes', default_min))
    limit = min(int(request.args.get('limit', 50)), 100)

    LUXURY_MAKES = ['TESLA','BMW','MERCEDES-BENZ','AUDI','LEXUS','PORSCHE',
                    'MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI',
                    'GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']

    params = [f'{year}-01-01', f'{int(year)+1}-01-01']

    # Base WHERE for crashes (NEVER filter by make in main query — we want real intersection totals)
    where_clauses = ["c.crash_date >= ? AND c.crash_date < ?",
                     "c.latitude IS NOT NULL", "c.longitude IS NOT NULL",
                     "c.primary_road IS NOT NULL", "c.primary_road != ''",
                     "c.primary_road NOT LIKE '%UNNAMED%'"]

    if city:
        where_clauses.append("c.city_name = ?")
        params.append(city)

    where_c = " AND ".join(where_clauses)

    # Main query: ALL crashes at intersections (NO make filter — always real totals)
    query = f"""
        SELECT
            c.primary_road,
            c.secondary_road,
            c.city_name,
            ROUND(AVG(c.latitude), 5) as center_lat,
            ROUND(AVG(c.longitude), 5) as center_lon,
            COUNT(*) as total_crashes,
            COALESCE(SUM(c.number_injured), 0) as total_injured,
            COALESCE(SUM(c.number_killed), 0) as total_killed,
            ROUND(CAST(SUM(CASE WHEN c.number_injured > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1) as injury_pct
        FROM crashes c
        WHERE {where_c}
        GROUP BY c.primary_road, COALESCE(c.secondary_road, ''), c.city_name
        HAVING total_crashes >= {min(10, min_crashes)}
        ORDER BY total_crashes DESC
        LIMIT {limit * 3}
    """

    base_zones = [dict(r) for r in conn.execute(query, params).fetchall()]

    # If make filter active: fast second query (JOIN, no correlated subquery)
    make_counts = {}
    if make and base_zones:
        mk_params = [f'{year}-01-01', f'{int(year)+1}-01-01', make]
        mk_extra = ""
        if city:
            mk_extra = "AND c2.city_name = ?"
            mk_params.append(city)

        mk_sql = f"""
            SELECT c2.primary_road,
                   COALESCE(c2.secondary_road, '') as secondary_road,
                   c2.city_name,
                   COUNT(*) as make_crashes
            FROM crashes c2
            JOIN parties p ON c2.collision_id = p.collision_id
            LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
            WHERE c2.crash_date >= ? AND c2.crash_date < ?
              AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) = ?
              AND c2.latitude IS NOT NULL
              AND c2.primary_road IS NOT NULL AND c2.primary_road != ''
              {mk_extra}
            GROUP BY c2.primary_road, COALESCE(c2.secondary_road, ''), c2.city_name
        """
        for row in conn.execute(mk_sql, mk_params).fetchall():
            key = (row['primary_road'], row['secondary_road'] or '', row['city_name'] or '')
            make_counts[key] = row['make_crashes']

        # Filter: only zones with enough make-specific crashes
        base_zones = [z for z in base_zones
                      if make_counts.get((z['primary_road'], z['secondary_road'] or '', z['city_name'] or ''), 0) >= min_crashes]
        base_zones = base_zones[:limit * 2]

    if not base_zones:
        conn.close()
        return jsonify({'zones': [], 'count': 0, 'summary': {}, 'filters': {'year': year, 'make': make or 'ALL', 'city': city or 'ALL'}})

    # For each zone, get luxury brand breakdown
    zone_results = []
    for z in base_zones:
        # Get luxury breakdown for this zone's roads
        lux_params = [f'{year}-01-01', f'{int(year)+1}-01-01', z['primary_road']]
        sec_where = "AND (c2.secondary_road = ? OR (c2.secondary_road IS NULL AND ? = ''))"
        lux_params.append(z['secondary_road'] or '')
        lux_params.append(z['secondary_road'] or '')

        if city:
            lux_params.append(z['city_name'])

        city_clause = "AND c2.city_name = ?" if city else ""

        lux_ph = ','.join(['?' for _ in LUXURY_MAKES])

        lux_sql = f"""
            SELECT UPPER(COALESCE(vl.make_name, p2.vehicle_make_code)) as make,
                   COUNT(*) as crashes
            FROM crashes c2
            JOIN parties p2 ON c2.collision_id = p2.collision_id
            LEFT JOIN vehicle_make_lookup vl ON p2.vehicle_make_code = vl.make_code
            WHERE c2.crash_date >= ? AND c2.crash_date < ?
              AND c2.primary_road = ?
              {sec_where}
              {city_clause}
              AND c2.latitude IS NOT NULL
              AND UPPER(COALESCE(vl.make_name, p2.vehicle_make_code)) IN ({lux_ph})
            GROUP BY 1
            ORDER BY crashes DESC
        """

        lux_rows = conn.execute(lux_sql, lux_params + LUXURY_MAKES).fetchall()
        luxury_breakdown = {r['make']: r['crashes'] for r in lux_rows if r['crashes'] and r['crashes'] > 0}

        total_luxury = sum(luxury_breakdown.values())
        luxury_pct = round(total_luxury / max(z['total_crashes'], 1) * 100, 1)

        # Calculate composite ad-score (0-100)
        # Find max values for normalization across all zones
        max_crashes = max(b['total_crashes'] for b in base_zones)
        max_injury_pct = max(b['injury_pct'] for b in base_zones)

        crash_score = (z['total_crashes'] / max(max_crashes, 1)) * 40
        injury_score = (z['injury_pct'] / max(max_injury_pct, 1)) * 30
        luxury_score = (luxury_pct / 100.0) * 30

        ad_score = round(crash_score + injury_score + luxury_score)

        # Calculate radius based on crash density (tighter cluster = smaller radius)
        # Default radius: 800m-3000m depending on crash count
        density = z['total_crashes'] / max(max_crashes, 1)
        radius_m = round(800 + (1 - density) * 2200)

        # Top luxury makes in this zone
        top_luxury = sorted(luxury_breakdown.items(), key=lambda x: x[1], reverse=True)[:5]

        # Peak hours for this zone
        peak_hours = [dict(r) for r in conn.execute("""
            SELECT CAST(SUBSTR(c.crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n
            FROM crashes c
            WHERE c.crash_date >= ? AND c.crash_date < ?
              AND c.primary_road = ?
              AND (c.secondary_road = ? OR (c.secondary_road IS NULL AND ? = ''))
              AND c.crash_time IS NOT NULL
            GROUP BY hour ORDER BY n DESC LIMIT 3
        """, [f'{year}-01-01', f'{int(year)+1}-01-01', z['primary_road'],
              z['secondary_road'] or '', z['secondary_road'] or '']).fetchall()]

        # Peak day
        peak_day_row = conn.execute("""
            SELECT c.day_of_week, COUNT(*) as n
            FROM crashes c
            WHERE c.crash_date >= ? AND c.crash_date < ?
              AND c.primary_road = ?
              AND (c.secondary_road = ? OR (c.secondary_road IS NULL AND ? = ''))
              AND c.day_of_week IS NOT NULL
            GROUP BY c.day_of_week ORDER BY n DESC LIMIT 1
        """, [f'{year}-01-01', f'{int(year)+1}-01-01', z['primary_road'],
              z['secondary_road'] or '', z['secondary_road'] or '']).fetchone()

        zone_results.append({
            'zone_id': z['primary_road'].replace(' ','-').replace('/','-')[:20],
            'name': f"{z['primary_road']}{' × ' + z['secondary_road'] if z['secondary_road'] else ''}",
            'primary_road': z['primary_road'],
            'secondary_road': z['secondary_road'] or '',
            'city': z['city_name'] or '',
            'center': {'lat': z['center_lat'], 'lon': z['center_lon']},
            'radius_meters': radius_m,
            'ad_score': ad_score,
            'stats': {
                'total_crashes': z['total_crashes'],
                'total_injured': z['total_injured'],
                'total_killed': z['total_killed'],
                'injury_pct': z['injury_pct'],
                'total_luxury': total_luxury,
                'luxury_pct': luxury_pct,
                'make_crashes': make_counts.get((z['primary_road'], z['secondary_road'] or '', z['city_name'] or ''), 0),
                'top_luxury': [{'make': m, 'crashes': c} for m, c in top_luxury],
                'peak_hours': peak_hours,
                'peak_day': peak_day_row['day_of_week'] if peak_day_row else None,
            }
        })

    # Re-sort by ad_score and limit
    zone_results.sort(key=lambda z: z['ad_score'], reverse=True)
    zone_results = zone_results[:limit]

    # Summary stats
    total_zones = len(zone_results)
    total_luxury_crashes = sum(z['stats']['total_luxury'] for z in zone_results)
    best_zone = zone_results[0] if zone_results else None

    conn.close()
    return jsonify({
        'zones': zone_results,
        'count': total_zones,
        'summary': {
            'total_luxury_crashes': total_luxury_crashes,
            'best_zone': best_zone['name'] if best_zone else None,
            'best_score': best_zone['ad_score'] if best_zone else None,
        },
        'filters': {
            'year': year,
            'make': make or 'ALL',
            'city_filter': city or 'ALL',
            'min_crashes': min_crashes,
        }
    })


def _merge_dashboards(cached: dict) -> dict:
    """Merge multiple cached dashboard years in Python. Instant."""
    years = sorted(cached.keys())
    first = cached[years[0]]
    merged = {
        'stats': {'total_crashes':0,'total_injured':0,'total_killed':0,'avg_injured_per_crash':0,'top_collision_type':None},
        'makes': {}, 'months': [], 'types': {}, 'cities': {},
        'days': first['days'], 'hours': {},  # days are same pattern, hours merge
        'luxury': {}, 'age_groups': {},
        '_cached': True, '_merged_years': years
    }

    # Sum stats
    for y in years:
        s = cached[y]['stats']
        merged['stats']['total_crashes'] += s['total_crashes']
        merged['stats']['total_injured'] += s['total_injured']
        merged['stats']['total_killed'] += s['total_killed']
    merged['stats']['avg_injured_per_crash'] = round(
        merged['stats']['total_injured'] / max(merged['stats']['total_crashes'], 1), 2)

    # Find top collision type across all years (simple count merge)
    type_counts = {}
    for y in years:
        for t in cached[y].get('types',[]):
            k = t.get('collision_type_desc','')
            type_counts[k] = type_counts.get(k,0) + t.get('total',0)
    merged['stats']['top_collision_type'] = max(type_counts, key=type_counts.get) if type_counts else None

    # Merge months (concatenate)
    for y in years:
        merged['months'].extend(cached[y].get('months',[]))

    # Merge makes (sum crash_count, recalc avg)
    make_data = {}
    for y in years:
        for m in cached[y].get('makes',[]):
            k = m['make']
            if k not in make_data:
                make_data[k] = {'crash_count':0,'at_fault_sum':0,'make':k}
            make_data[k]['crash_count'] += m['crash_count']
            make_data[k]['at_fault_sum'] += m.get('at_fault_pct',0) * m['crash_count'] / 100
    merged['makes'] = sorted(make_data.values(), key=lambda x: x['crash_count'], reverse=True)[:14]
    for m in merged['makes']:
        m['at_fault_pct'] = round(m['at_fault_sum'] / max(m['crash_count'],1) * 100, 1)
        del m['at_fault_sum']

    # Merge types
    for y in years:
        for t in cached[y].get('types',[]):
            k = t.get('collision_type_desc','')
            if k not in merged['types']:
                merged['types'][k] = {'collision_type_desc':k,'total':0,'total_injured':0}
            merged['types'][k]['total'] += t.get('total',0)
            merged['types'][k]['total_injured'] += t.get('total_injured',0)
    merged['types'] = sorted(merged['types'].values(), key=lambda x: x['total'], reverse=True)

    # Merge cities
    for y in years:
        for c in cached[y].get('cities',[]):
            k = c.get('city_name','')
            if k not in merged['cities']:
                merged['cities'][k] = {'city_name':k,'total_crashes':0,'total_injured':0,'total_killed':0}
            merged['cities'][k]['total_crashes'] += c.get('total_crashes',0)
            merged['cities'][k]['total_injured'] += c.get('total_injured',0)
            merged['cities'][k]['total_killed'] += c.get('total_killed',0)
    merged['cities'] = sorted(merged['cities'].values(), key=lambda x: x['total_crashes'], reverse=True)[:12]

    # Merge luxury
    for y in years:
        for l in cached[y].get('luxury',[]):
            k = l['make']
            if k not in merged['luxury']:
                merged['luxury'][k] = {'make':k,'crashes':0,'at_fault':0}
            merged['luxury'][k]['crashes'] += l.get('crashes',0)
            merged['luxury'][k]['at_fault'] += l.get('at_fault',0)
    merged['luxury'] = sorted(merged['luxury'].values(), key=lambda x: x['crashes'], reverse=True)

    # Merge age_groups
    for y in years:
        for a in cached[y].get('age_groups',[]):
            k = a['age_group']
            if k not in merged['age_groups']:
                merged['age_groups'][k] = {'age_group':k,'n':0,'at_fault':0}
            merged['age_groups'][k]['n'] += a.get('n',0)
            merged['age_groups'][k]['at_fault'] += a.get('at_fault',0)
    merged['age_groups'] = list(merged['age_groups'].values())

    # Merge hours
    for y in years:
        for h in cached[y].get('hours',[]):
            k = h['hour']
            if k not in merged['hours']:
                merged['hours'][k] = {'hour':k,'n':0,'injured':0}
            merged['hours'][k]['n'] += h.get('n',0)
            merged['hours'][k]['injured'] += h.get('injured',0)
    merged['hours'] = sorted(merged['hours'].values(), key=lambda x: x['hour'])

    return merged


@app.route('/api/dashboard')
def api_dashboard():
    """Single endpoint — all dashboard data. < 50ms from cache, 5-8s cold with filters."""
    conn = get_conn()
    years = request.args.getlist('year')
    city = request.args.getlist('city')
    make = request.args.getlist('make')
    collision_type = request.args.getlist('collision_type')

    # Default year when filters active
    if not years and (city or make or collision_type):
        years = ['2025']

    # Use cache when no filters (merge multiple years in Python)
    if not city and not make and not collision_type:
        ylist = years if years else ['2025']
        cached_years = {}
        for y in ylist:
            row = conn.execute("SELECT data FROM analytics_cache WHERE cache_key=?",
                              [f'dashboard_{y}']).fetchone()
            if row:
                cached_years[y] = json.loads(row[0])

        if len(cached_years) == 1:
            conn.close()
            return jsonify(list(cached_years.values())[0])

        if len(cached_years) > 1:
            merged = _merge_dashboards(cached_years)
            conn.close()
            return jsonify(merged)

    # Cache key for filtered queries (e.g. dashboard_2025_make_LUCID)
    cache_key_parts = ['dashboard', '_'.join(sorted(years)) if years else 'all']
    if city:
        cache_key_parts.append('city_' + '_'.join(sorted(city)))
    if make:
        cache_key_parts.append('make_' + '_'.join(sorted(make)))
    if collision_type:
        cache_key_parts.append('type_' + '_'.join(sorted(collision_type)))
    cache_key = '_'.join(cache_key_parts)[:100]

    # Try filtered cache
    cached = conn.execute(
        "SELECT data FROM analytics_cache WHERE cache_key=?", [cache_key]
    ).fetchone()

    if cached:
        result = json.loads(cached[0])
        result['_cached'] = True
        conn.close()
        return jsonify(result)

    # Live query (filters active, first time — 5-8s)
    result = _build_dashboard_live(conn, years, city, make, collision_type)

    # Cache it for instant future access
    conn.execute("INSERT OR REPLACE INTO analytics_cache VALUES (?, ?, datetime('now'))",
                 [cache_key, json.dumps(result)])
    conn.commit()
    result['_cached'] = False
    conn.close()
    return jsonify(result)


def _build_dashboard_live(conn, years, city, make, collision_type):
    """Build dashboard data with filters (slower, only when filters active)."""
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

    result['makes'] = [dict(r) for r in conn.execute(f"""SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crash_count, ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END)*100.0/COUNT(*) as at_fault_pct FROM parties p JOIN crashes c ON p.collision_id=c.collision_id LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code {where_c} AND p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code!='' GROUP BY 1 ORDER BY crash_count DESC LIMIT 14""", params_c).fetchall()]

    result['months'] = [dict(r) for r in conn.execute(f"SELECT SUBSTR(c.crash_date,1,7) as month, COUNT(*) as crashes, COALESCE(SUM(c.number_injured),0) as injured, COALESCE(SUM(c.number_killed),0) as killed FROM crashes c {where_c} AND c.crash_date IS NOT NULL GROUP BY month ORDER BY month", params_c).fetchall()]

    result['types'] = [dict(r) for r in conn.execute(f"SELECT c.collision_type_desc, COUNT(*) as total, COALESCE(SUM(c.number_injured),0) as total_injured, ROUND(AVG(CASE WHEN c.number_injured>0 THEN 1.0 ELSE 0.0 END)*100,1) as pct_with_injury FROM crashes c {where_c} AND c.collision_type_desc IS NOT NULL AND c.collision_type_desc!='' GROUP BY 1 ORDER BY total DESC", params_c).fetchall()]

    result['cities'] = [dict(r) for r in conn.execute(f"SELECT c.city_name, c.county_code, COUNT(*) as total_crashes, COALESCE(SUM(c.number_injured),0) as total_injured, COALESCE(SUM(c.number_killed),0) as total_killed FROM crashes c {where_c} AND c.city_name IS NOT NULL AND c.city_name!='' GROUP BY c.city_name, c.county_code ORDER BY total_crashes DESC LIMIT 12", params_c).fetchall()]

    day_order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    dow = {r['day_of_week']:r['n'] for r in conn.execute(f"SELECT c.day_of_week, COUNT(*) as n FROM crashes c {where_c} AND c.day_of_week IS NOT NULL GROUP BY 1", params_c).fetchall()}
    result['days'] = [{'day':d,'crashes':dow.get(d,0)} for d in day_order]

    result['hours'] = [dict(r) for r in conn.execute(f"SELECT CAST(SUBSTR(c.crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n, COALESCE(SUM(c.number_injured),0) as injured FROM crashes c {where_c} AND c.crash_time IS NOT NULL GROUP BY hour ORDER BY hour", params_c).fetchall()]

    luxury = ['TESLA','BMW','MERCEDES-BENZ','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']
    ph = ','.join(['?' for _ in luxury])
    result['luxury'] = [dict(r) for r in conn.execute(f"SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make, COUNT(*) as crashes, ROUND(AVG(CAST(p.stated_age AS FLOAT)),1) as avg_driver_age, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END) as at_fault FROM parties p JOIN crashes c ON p.collision_id=c.collision_id LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code=l.make_code {where_c} AND UPPER(COALESCE(l.make_name, p.vehicle_make_code)) IN ({ph}) GROUP BY 1 ORDER BY crashes DESC", params_c + luxury).fetchall()]

    result['age_groups'] = [dict(r) for r in conn.execute(f"""SELECT CASE WHEN CAST(p.stated_age AS INTEGER)<18 THEN '<18' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 18 AND 24 THEN '18-24' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 25 AND 34 THEN '25-34' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 35 AND 44 THEN '35-44' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 45 AND 54 THEN '45-54' WHEN CAST(p.stated_age AS INTEGER) BETWEEN 55 AND 64 THEN '55-64' WHEN CAST(p.stated_age AS INTEGER)>=65 THEN '65+' ELSE 'Unknown' END as age_group, COUNT(*) as n, SUM(CASE WHEN p.is_at_fault='True' THEN 1 ELSE 0 END) as at_fault FROM parties p JOIN crashes c ON p.collision_id=c.collision_id {where_c} AND p.stated_age IS NOT NULL GROUP BY age_group ORDER BY MIN(CAST(p.stated_age AS INTEGER))""", params_c).fetchall()]

    result['_cached'] = False
    return result


# ── Weather & Forecast v2 ────────────────────────────────────────────

@app.route('/api/forecast')
def api_forecast():
    """7-day crash forecast with current conditions + risk scores + revenue estimates."""
    data = weather_engine.get_forecast_data()
    if not data:
        # Generate on the fly
        try:
            weather_engine.init_tables()
            weather_engine.build_crash_baselines()
            weather_engine.generate_forecast()
        except Exception as e:
            pass
        data = weather_engine.get_forecast_data()

    if not data:
        return jsonify({'daily': [], 'current': None, 'summary': {}, 'corridors': [],
                        'generated_at': datetime.now(timezone.utc).isoformat()})

    return jsonify(data)


@app.route('/api/weather/current')
def api_weather_current():
    """Live current weather conditions for all corridors."""
    conditions = weather_engine.get_current_conditions()
    return jsonify(conditions)


@app.route('/api/weather/refresh')
def api_weather_refresh():
    """Force-refresh current conditions + forecast."""
    try:
        weather_engine.refresh_current_conditions()
        weather_engine.generate_forecast()
        return jsonify({'status': 'ok', 'message': 'Weather data refreshed',
                        'timestamp': datetime.now(timezone.utc).isoformat()})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/revenue-radar')
def api_revenue_radar():
    """Revenue Radar — per-ACG competitive intelligence.

    For each ACG location: competitors nearby, insurer flow, reputation gap,
    fleet at risk, and revenue opportunity score.
    """
    conn = get_conn()
    year = request.args.get('year', '2025')

    acg_locs = [
        {'name':'Whittier HQ','lat':33.9792,'lon':-118.0327,'city':'Whittier'},
        {'name':'Los Angeles','lat':34.0522,'lon':-118.2437,'city':'Los Angeles'},
        {'name':'Gardena — Rosecrans','lat':33.8969,'lon':-118.3092,'city':'Gardena'},
        {'name':'Gardena — Vermont','lat':33.8883,'lon':-118.3089,'city':'Gardena'},
        {'name':'Santa Ana','lat':33.7455,'lon':-117.8677,'city':'Santa Ana'},
        {'name':'Covina','lat':34.0900,'lon':-117.8903,'city':'Covina'},
        {'name':'Ontario','lat':34.0633,'lon':-117.6509,'city':'Ontario'},
        {'name':'Rancho Cucamonga','lat':34.1064,'lon':-117.5931,'city':'Rancho Cucamonga'},
        {'name':'Victorville','lat':34.5362,'lon':-117.2928,'city':'Victorville'},
        {'name':'Fresno','lat':36.7378,'lon':-119.7871,'city':'Fresno'},
        {'name':'Bakersfield — Ming','lat':35.3733,'lon':-119.0187,'city':'Bakersfield'},
        {'name':'Bakersfield — McCutchen','lat':35.3345,'lon':-119.0778,'city':'Bakersfield'},
        {'name':'El Cajon','lat':32.7948,'lon':-116.9625,'city':'El Cajon'},
    ]

    # Get crash data per ACG zone
    crash_counts = {}
    for loc in acg_locs:
        cached = conn.execute(
            "SELECT data FROM acg_location_cache WHERE year=? AND name=?", [year, loc['name']]
        ).fetchone()
        if cached:
            crash_counts[loc['name']] = json.loads(cached[0])

    # Get competitor data
    competitors = {}
    for loc in acg_locs:
        comps = conn.execute("""
            SELECT competitor_name, competitor_brand, distance_miles, competitor_city
            FROM acg_competitor_distances WHERE acg_name=?
            ORDER BY distance_miles
        """, [loc['name']]).fetchall()
        competitors[loc['name']] = [dict(c) for c in comps]

    # Get reputation
    reputation = {}
    for row in conn.execute("SELECT * FROM acg_reputation").fetchall():
        reputation[row['acg_name']] = dict(row)

    # Get insurer distribution (top 5 in CA, distributed by crash volume)
    insurers = conn.execute("""
        SELECT company_name, market_share, written_premium
        FROM cdi_insurers ORDER BY written_premium DESC LIMIT 5
    """).fetchall()

    # DMV luxury density per ACG zone
    luxury_makes = ['BMW','MERCEDES-BENZ','TESLA','AUDI','LEXUS','PORSCHE',
                    'MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI',
                    'GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID']
    lx_ph = ','.join(['?' for _ in luxury_makes])

    # Build per-location radar
    radar = []
    for loc in acg_locs:
        name = loc['name']
        cd = crash_counts.get(name, {})
        comp_list = competitors.get(name, [])
        rep = reputation.get(name, {})

        # Nearest 3 competitors
        nearest = comp_list[:3]
        nearest_names = [f"{c['competitor_brand']} ({c['distance_miles']}mi)" for c in nearest]

        # Competitor score (0-100): more competitors nearby = higher competition
        comp_score = min(100, len(comp_list) * 20 + sum(10 for c in nearest if c['distance_miles'] < 3))

        # Reputation score (0-100)
        gr = rep.get('google_rating', 4.0) or 4.0
        gv = rep.get('google_reviews', 0) or 0
        rep_score = min(100, gr * 18 + gv * 0.1)  # 4.5★ + 100 reviews = 91

        # Fleet at risk (luxury vehicles near this ACG, 10mi radius)
        lat_r = 10 / 69.0
        lon_r = lat_r / abs(math.cos(math.radians(loc['lat'])))
        LUX_LIST = "'BMW','MERCEDES-BENZ','TESLA','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID'"
        row = conn.execute(f"""
            SELECT SUM(d.vehicles) FROM dmv_vehicles_by_zip d
            JOIN zip_centroids zc ON d.zip_code = zc.zip_code
            WHERE d.data_year='2025' AND d.make IN ({LUX_LIST})
            AND zc.lat BETWEEN ? AND ? AND zc.lon BETWEEN ? AND ?
        """, [loc['lat'] - lat_r, loc['lat'] + lat_r, loc['lon'] - lon_r, loc['lon'] + lon_r]).fetchone()
        fleet_luxury = row[0] if row and row[0] else 0

        # Monthly crash potential in zone
        total_crashes = cd.get('total_crashes', 0) or 0
        monthly_crashes = round(total_crashes / 12)
        # Estimated revenue opportunity
        monthly_rev_opp = round(monthly_crashes * 2800)  # avg repair cost

        # Insurer flow: distribute state-level market share to this zone
        insurer_flow = []
        for ins in insurers:
            zone_share = ins['market_share']  # proportional
            zone_claims = round(monthly_crashes * zone_share * 0.5)  # 50% claim rate
            insurer_flow.append({
                'company': ins['company_name'].split(' - ')[0],
                'market_share_pct': round(ins['market_share'] * 100, 1),
                'est_monthly_claims': zone_claims,
                'estimated_revenue': round(zone_claims * 2800),
            })

        # Overall opportunity score (0-100)
        opportunity_score = round(
            (100 - comp_score) * 0.30 +   # Less competition = better
            rep_score * 0.20 +              # Better reputation = better
            min(100, fleet_luxury / 30000 * 100) * 0.25 +  # More luxury cars = better
            min(100, monthly_crashes / 100 * 100) * 0.25    # More crashes = more opportunity
        )

        radar.append({
            'acg_name': name,
            'city': loc['city'],
            'lat': loc['lat'],
            'lon': loc['lon'],
            'total_crashes_year': total_crashes,
            'monthly_crashes': monthly_crashes,
            'monthly_revenue_opportunity': monthly_rev_opp,
            'fleet_luxury_10mi': fleet_luxury,
            'competitors_nearby': len(comp_list),
            'nearest_competitors': nearest_names,
            'competitor_score': comp_score,
            'reputation': {'google_rating': gr, 'google_reviews': gv, 'score': round(rep_score)},
            'insurer_flow': insurer_flow[:5],
            'opportunity_score': opportunity_score,
            'score_breakdown': {
                'competition': round(100 - comp_score),
                'reputation': round(rep_score),
                'luxury_density': round(min(100, fleet_luxury / 30000 * 100)),
                'crash_volume': round(min(100, monthly_crashes / 100 * 100)),
            }
        })

    radar.sort(key=lambda x: x['opportunity_score'], reverse=True)

    conn.close()
    return jsonify({'radar': radar, 'year': year})

@app.route('/api/seasonal-patterns')
def api_seasonal_patterns():
    """3-year CCRS seasonal crash patterns — monthly, daily, hourly."""
    conn = get_conn()
    patterns = {}
    for row in conn.execute("SELECT * FROM seasonal_patterns ORDER BY pattern_type, pattern_key").fetchall():
        ptype = row['pattern_type']
        if ptype not in patterns:
            patterns[ptype] = []
        patterns[ptype].append({
            'key': row['pattern_key'], 'crashes': row['crash_count'],
            'avg_3yr': row['avg_3yr'], 'injury_rate': row['injury_rate'], 'tow_rate': row['tow_rate']
        })

    # Peak insights
    monthly = patterns.get('monthly', [])
    dow = patterns.get('dow', [])
    hourly = patterns.get('hourly', [])

    peak_month = max(monthly, key=lambda x: x['avg_3yr']) if monthly else None
    low_month = min(monthly, key=lambda x: x['avg_3yr']) if monthly else None
    peak_day = max(dow, key=lambda x: x['avg_3yr']) if dow else None
    peak_hour = max(hourly, key=lambda x: x['avg_3yr']) if hourly else None

    conn.close()
    return jsonify({
        'patterns': patterns,
        'insights': {
            'peak_month': peak_month,
            'low_month': low_month,
            'peak_day': peak_day,
            'peak_hour': peak_hour,
            'seasonal_swing_pct': round((peak_month['avg_3yr'] - low_month['avg_3yr']) / low_month['avg_3yr'] * 100, 1) if peak_month and low_month else 0,
            'weekend_vs_weekday': round(
                (sum(d['avg_3yr'] for d in dow if d['key'] in ('Saturday','Sunday')) / 2) /
                (sum(d['avg_3yr'] for d in dow if d['key'] not in ('Saturday','Sunday')) / 5) * 100, 1
            ) if dow else 0,
        }
    })

@app.route('/api/weather-stats')
def api_weather_stats():
    """Corridor crash baselines (new format)."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT * FROM corridor_crash_baseline ORDER BY avg_crashes_per_day DESC
    """).fetchall()
    conn.close()
    return jsonify({'baselines': [dict(r) for r in rows]})


@app.route('/api/health')
def api_health():
    return jsonify({'status': 'ok', 'db_size_mb': DB_PATH.stat().st_size / 1024 / 1024})


@app.route('/')
def serve_dashboard():
    return send_from_directory(app.static_folder, 'index.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5052, debug=False)
