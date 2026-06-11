"""
Crash Intel Search API — Unified search across all data sources
"""
import sqlite3, json, math, os
from flask import Blueprint, request, jsonify

DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'crash_intel.db')
search_bp = Blueprint('search', __name__)

LUXURY_CODES = [
    'BMW','MERC','TESL','AUDI','POR','JAGU','LAND','MAS','FERR',
    'BENT','ASTO','LAM','LOTU','RROL','MAYB','GEN','ACUR',
    'INF','LEXS','CADI','LINC','VOLV','ALFA'
]

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

# ─── SEARCH: Unified search across crashes, parties, towing, DMV ───
@search_bp.route('/api/search')
def unified_search():
    """Search across crashes, towing companies, DMV data, and CHP offices"""
    q = request.args.get('q', '').strip()
    filter_type = request.args.get('type', 'all')  # crashes | towing | dmv | chp | all
    limit = min(int(request.args.get('limit', 50)), 200)
    
    conn = get_db()
    results = {'query': q, 'type': filter_type, 'results': {}}
    
    # 1. Search crashes (intersections, cities, roads)
    if filter_type in ('all', 'crashes'):
        crash_rows = conn.execute("""
            SELECT DISTINCT c.city_name, c.primary_road, c.secondary_road,
                   COUNT(DISTINCT c.collision_id) as crash_count,
                   COUNT(DISTINCT CASE WHEN p.vehicle_make_code IN ({lux}) THEN c.collision_id END) as luxury_count
            FROM crashes c
            JOIN parties p ON c.collision_id = p.collision_id
            WHERE (c.city_name LIKE ? OR c.primary_road LIKE ? OR c.secondary_road LIKE ?)
                AND c.crash_date >= '2024-01-01'
            GROUP BY c.city_name, c.primary_road, c.secondary_road
            ORDER BY crash_count DESC
            LIMIT ?
        """.format(lux=','.join(f"'{c}'" for c in LUXURY_CODES)),
        (f'%{q}%', f'%{q}%', f'%{q}%', limit)).fetchall()
        
        results['results']['crashes'] = [dict(r) for r in crash_rows]
        results['crashes_count'] = len(crash_rows)
    
    # 2. Search towing companies
    if filter_type in ('all', 'towing'):
        tow_rows = conn.execute("""
            SELECT company_name, phone, address, city, google_rating, 
                   google_review_count, website, chp_area_name
            FROM chp_tow_services
            WHERE company_name LIKE ? OR address LIKE ? OR city LIKE ?
            ORDER BY google_rating DESC, google_review_count DESC
            LIMIT ?
        """, (f'%{q}%', f'%{q}%', f'%{q}%', limit)).fetchall()
        
        results['results']['towing'] = [dict(r) for r in tow_rows]
        results['towing_count'] = len(tow_rows)
    
    # 3. Search DMV data
    if filter_type in ('all', 'dmv'):
        dmv_rows = conn.execute("""
            SELECT zip_code, make, model_year, fuel_type, SUM(vehicles) as total_vehicles
            FROM dmv_vehicles_by_zip
            WHERE zip_code LIKE ? OR make LIKE ?
            GROUP BY zip_code, make
            ORDER BY total_vehicles DESC
            LIMIT ?
        """, (f'%{q}%', f'%{q}%', limit)).fetchall()
        
        results['results']['dmv'] = [dict(r) for r in dmv_rows]
        results['dmv_count'] = len(dmv_rows)
    
    # 4. Search CHP offices
    if filter_type in ('all', 'chp'):
        chp_rows = conn.execute("""
            SELECT division, area_name, area_code, city, phone, address, website_url, notes
            FROM chp_area_offices
            WHERE area_name LIKE ? OR city LIKE ? OR division LIKE ? OR phone LIKE ?
            LIMIT ?
        """, (f'%{q}%', f'%{q}%', f'%{q}%', f'%{q}%', limit)).fetchall()
        
        results['results']['chp_offices'] = [dict(r) for r in chp_rows]
        results['chp_count'] = len(chp_rows)
    
    conn.close()
    return jsonify(results)

# ─── FILTER: Luxury mailer targets ───
@search_bp.route('/api/mailer-targets')
def mailer_targets():
    """Get luxury mailer targets with filters"""
    city = request.args.get('city', '')
    min_score = float(request.args.get('min_score', 0))
    acg_center = request.args.get('acg_center', '')
    action = request.args.get('action', '')  # HIGH PRIORITY, MEDIUM, LOW
    limit = min(int(request.args.get('limit', 100)), 500)
    offset = int(request.args.get('offset', 0))
    
    conn = get_db()
    
    where = ['1=1']
    params = []
    if city:
        where.append('city LIKE ?')
        params.append(f'%{city}%')
    if min_score > 0:
        where.append('mailer_priority_score >= ?')
        params.append(min_score)
    if acg_center:
        where.append('nearest_acg_center LIKE ?')
        params.append(f'%{acg_center}%')
    if action:
        where.append('recommended_action = ?')
        params.append(action)
    
    count_row = conn.execute(f"SELECT COUNT(*) FROM luxury_mailer_targets WHERE {' AND '.join(where)}", params).fetchone()
    total = count_row[0] if count_row else 0
    
    rows = conn.execute(f"""
        SELECT * FROM luxury_mailer_targets 
        WHERE {' AND '.join(where)}
        ORDER BY mailer_priority_score DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()
    
    conn.close()
    
    return jsonify({
        'total': total,
        'limit': limit,
        'offset': offset,
        'targets': [dict(r) for r in rows]
    })

# ─── FILTER: Towing companies by location/rating ───
@search_bp.route('/api/towing')
def towing():
    """Filter towing companies"""
    city = request.args.get('city', '')
    min_rating = float(request.args.get('min_rating', 0))
    area = request.args.get('area', '')  # CHP area or search location
    limit = min(int(request.args.get('limit', 100)), 500)
    
    conn = get_db()
    where = ['1=1']
    params = []
    if city:
        where.append('(city LIKE ? OR address LIKE ?)')
        params.extend([f'%{city}%', f'%{city}%'])
    if min_rating > 0:
        where.append('google_rating >= ?')
        params.append(min_rating)
    if area:
        where.append('chp_area_name LIKE ?')
        params.append(f'%{area}%')
    
    rows = conn.execute(f"""
        SELECT * FROM chp_tow_services
        WHERE {' AND '.join(where)}
        ORDER BY google_rating DESC, google_review_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    
    conn.close()
    return jsonify({'total': len(rows), 'towing_services': [dict(r) for r in rows]})

# ─── FILTER: CHP offices ───
@search_bp.route('/api/chp-offices')
def chp_offices():
    """Get CHP area offices"""
    division = request.args.get('division', '')
    conn = get_db()
    if division:
        rows = conn.execute("SELECT * FROM chp_area_offices WHERE division LIKE ? ORDER BY area_name", (f'%{division}%',)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM chp_area_offices ORDER BY division, area_name").fetchall()
    conn.close()
    return jsonify({'total': len(rows), 'offices': [dict(r) for r in rows]})

# ─── FILTER: DMV luxury vehicles by ZIP ───
@search_bp.route('/api/dmv-luxury')
def dmv_luxury():
    """Get luxury vehicle registration data by ZIP"""
    zip_code = request.args.get('zip', '')
    make = request.args.get('make', '')
    limit = min(int(request.args.get('limit', 100)), 500)
    
    conn = get_db()
    year = request.args.get('year', '2025').strip()
    where = ['data_year = ?']
    params = [year]
    
    # Luxury makes list
    luxury_makes = [
        'BMW','MERCEDES-BENZ','TESLA','AUDI','PORSCHE','JAGUAR',
        'LAND ROVER','MASERATI','FERRARI','BENTLEY','ASTON MARTIN',
        'LAMBORGHINI','LOTUS','ROLLS ROYCE','MAYBACH','GENESIS',
        'ACURA','INFINITI','LEXUS','CADILLAC','LINCOLN','VOLVO','ALFA ROMEO'
    ]
    where.append(f"make IN ({','.join('?' for _ in luxury_makes)})")
    params.extend(luxury_makes)
    
    if zip_code:
        where.append('zip_code LIKE ?')
        params.append(f'%{zip_code}%')
    where.append("zip_code != 'OOS'")
    if make:
        where.append('make LIKE ?')
        params.append(f'%{make}%')
    
    rows = conn.execute(f"""
        SELECT zip_code, make, model_year, fuel_type, SUM(vehicles) as count
        FROM dmv_vehicles_by_zip
        WHERE {' AND '.join(where)}
        GROUP BY zip_code, make
        ORDER BY count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    
    conn.close()
    return jsonify({'total': len(rows), 'luxury_vehicles': [dict(r) for r in rows]})

# ─── COMBINED: Full city/zip profile ───
@search_bp.route('/api/profile/<city_or_zip>')
def location_profile(city_or_zip):
    """Get complete profile for a city or ZIP code"""
    conn = get_db()
    profile = {'query': city_or_zip, 'is_zip': city_or_zip.isdigit() and len(city_or_zip) == 5}
    
    if profile['is_zip']:
        # DMV data for this ZIP
        dmv = conn.execute("""
            SELECT make, SUM(vehicles) as total, 
                   MAX(model_year) as newest_model,
                   COUNT(DISTINCT model_year) as year_range
            FROM dmv_vehicles_by_zip
            WHERE zip_code = ? AND data_year = 2025
            GROUP BY make
            ORDER BY total DESC
            LIMIT 20
        """, (city_or_zip,)).fetchall()
        profile['dmv_vehicles'] = [dict(r) for r in dmv]
        
        # Total luxury vehicles
        lux_total = conn.execute("""
            SELECT SUM(vehicles) FROM dmv_vehicles_by_zip
            WHERE zip_code = ? AND data_year = 2025
            AND make IN ('BMW','MERCEDES-BENZ','TESLA','AUDI','PORSCHE','LAND ROVER','LEXUS','ACURA','CADILLAC','INFINITI','VOLVO','GENESIS','JAGUAR','LINCOLN','MASERATI','LUCID','RIVIAN','POLESTAR','MINI')
        """, (city_or_zip,)).fetchone()
        profile['luxury_total'] = lux_total[0] if lux_total[0] else 0
    else:
        # Crash data for this city
        crashes = conn.execute("""
            SELECT 
                COUNT(DISTINCT c.collision_id) as total_2025,
                COUNT(DISTINCT CASE WHEN p.vehicle_make_code IN ({lux}) THEN c.collision_id END) as luxury_2025,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.vehicle_make_code IN ({lux}) THEN c.collision_id END) / 
                    COUNT(DISTINCT c.collision_id), 1) as luxury_pct
            FROM crashes c
            JOIN parties p ON c.collision_id = p.collision_id
            WHERE c.city_name = ? AND c.crash_date >= '2025-01-01' AND c.crash_date < '2026-01-01'
        """.format(lux=','.join(f"'{c}'" for c in LUXURY_CODES)), (city_or_zip,)).fetchone()
        profile['crashes'] = dict(crashes) if crashes else {}
        
        # Top intersections
        intersections = conn.execute(f"""
            SELECT primary_road || ' x ' || secondary_road as intersection,
                   COUNT(*) as crashes
            FROM crashes c
            WHERE c.city_name = ? AND c.crash_date >= '2025-01-01' AND c.crash_date < '2026-01-01'
                AND secondary_road IS NOT NULL AND secondary_road != ''
            GROUP BY primary_road, secondary_road
            ORDER BY crashes DESC LIMIT 5
        """, (city_or_zip,)).fetchall()
        profile['top_intersections'] = [dict(r) for r in intersections]
        
        # Towing companies nearby
        towing = conn.execute("""
            SELECT company_name, phone, google_rating, google_review_count, website
            FROM chp_tow_services
            WHERE city LIKE ? OR address LIKE ?
            ORDER BY google_rating DESC LIMIT 10
        """, (f'%{city_or_zip}%', f'%{city_or_zip}%')).fetchall()
        profile['towing_nearby'] = [dict(r) for r in towing]
    
    # Mailer target if exists
    mailer = conn.execute("""
        SELECT * FROM luxury_mailer_targets
        WHERE city LIKE ? 
        ORDER BY mailer_priority_score DESC LIMIT 1
    """, (f'%{city_or_zip}%',)).fetchone()
    if mailer:
        profile['mailer_target'] = dict(mailer)
    
    conn.close()
    return jsonify(profile)


# ─── REVERSE: Top ZIP codes by luxury make ───
@search_bp.route('/api/dmv-top-zips')
def dmv_top_zips():
    """Get top ZIP codes with most vehicles for a given luxury make"""
    make = request.args.get('make', 'BMW').strip()
    year = request.args.get('year', '2025').strip()
    limit = min(int(request.args.get('limit', 20)), 100)
    
    conn = get_db()
    rows = conn.execute("""
        SELECT zip_code, make, SUM(vehicles) as total_vehicles,
               COUNT(DISTINCT model_year) as year_range,
               MIN(model_year) as oldest_model,
               MAX(model_year) as newest_model
        FROM dmv_vehicles_by_zip
        WHERE data_year = ? AND LOWER(make) = LOWER(?) AND zip_code != 'OOS'
        GROUP BY zip_code
        ORDER BY total_vehicles DESC
        LIMIT ?
    """, (year, make, limit)).fetchall()
    
    conn.close()
    
    return jsonify({
        'make': make,
        'total_zips_found': len(rows),
        'top_zips': [dict(r) for r in rows],
        'total_vehicles_across_zips': sum(r['total_vehicles'] for r in rows)
    })

# ─── QUICK STATS ───

# --- Available data years ---
@search_bp.route('/api/dmv-years')
def dmv_years():
    conn = get_db()
    rows = conn.execute("""
        SELECT data_year, SUM(vehicles) as total_vehicles,
               SUM(CASE WHEN make IN ('BMW','MERCEDES-BENZ','TESLA','AUDI','PORSCHE','LAND ROVER','LEXUS','ACURA','CADILLAC','INFINITI','VOLVO','GENESIS','JAGUAR','LINCOLN','MASERATI','LUCID','RIVIAN','POLESTAR','MINI') THEN vehicles ELSE 0 END) as luxury_vehicles,
               COUNT(DISTINCT zip_code) as zip_codes
        FROM dmv_vehicles_by_zip
        WHERE zip_code != 'OOS'
        GROUP BY data_year
        ORDER BY data_year DESC
    """).fetchall()
    conn.close()
    return jsonify({
        'years': [dict(r) for r in rows],
        'note': 'Each year is a snapshot of all vehicles registered in California as of January 1.'
    })

# --- Ultra-luxury crash data (bypasses DMV privacy masking) ---
@search_bp.route('/api/ultra-luxury-crashes')
def ultra_luxury_crashes():
    year = request.args.get('year', '2025').strip()
    conn = get_db()
    
    ultra_brands = [
        ('ROLLS ROYCE', ['ROLLS ROYCE', 'ROLLS-ROYCE']),
        ('BENTLEY', ['BENT']),
        ('FERRARI', ['FERR']),
        ('ASTON MARTIN', ['ASTO']),
        ('LAMBORGHINI', ['LAM']),
        ('LOTUS', ['LOTU']),
        ('MCLAREN', ['MCLR']),
        ('MAYBACH', ['MAYB']),
        ('LUCID', ['LUCI']),
        ('RIVIAN', ['RIVN']),
        ('POLESTAR', ['POLS']),
    ]
    
    results = []
    for brand_name, codes in ultra_brands:
        placeholders = ','.join(['?' for _ in codes])
        row = conn.execute(f"""
            SELECT COUNT(DISTINCT c.collision_id) as crashes,
                   COUNT(DISTINCT c.city_name) as cities,
                   GROUP_CONCAT(DISTINCT c.city_name) as city_list
            FROM crashes c
            JOIN parties p ON c.collision_id = p.collision_id
            WHERE c.crash_date >= ? || '-01-01' AND c.crash_date < ? || '-01-01'
            AND (p.vehicle_make_code IN ({placeholders}) OR p.vehicle_make IN ({placeholders}))
        """, [year, str(int(year)+1)] + codes + codes).fetchone()
        
        if row and row[0] and row[0] > 0:
            results.append({
                'brand': brand_name,
                'crashes': row[0],
                'cities': row[1],
                'top_cities': row[2] if row[2] else '',
                'dmv_visible': 'Minimal (privacy masked)'
            })
    
    conn.close()
    return jsonify({
        'year': year,
        'ultra_luxury': sorted(results, key=lambda x: x['crashes'], reverse=True),
        'note': 'CCRS crash data is NOT privacy-masked. DMV registration data masks brands with <10 vehicles per ZIP.'
    })

@search_bp.route('/api/stats')
def quick_stats():
    """Quick summary stats for the dashboard"""
    conn = get_db()
    stats = {}
    
    # Total crashes 2025
    r = conn.execute("SELECT COUNT(*) FROM crashes WHERE crash_date >= '2025-01-01' AND crash_date < '2026-01-01'").fetchone()
    stats['total_crashes_2025'] = r[0] if r else 0
    
    # Luxury crashes 2025
    r = conn.execute(f"""
        SELECT COUNT(DISTINCT c.collision_id) FROM crashes c
        JOIN parties p ON c.collision_id = p.collision_id
        WHERE c.crash_date >= '2025-01-01' AND c.crash_date < '2026-01-01'
        AND p.vehicle_make_code IN ({','.join(f"'{c}'" for c in LUXURY_CODES)})
    """).fetchone()
    stats['luxury_crashes_2025'] = r[0] if r else 0
    
    # DMV total luxury vehicles
    r = conn.execute("""
        SELECT SUM(vehicles) FROM dmv_vehicles_by_zip WHERE data_year = 2025
        AND make IN ('BMW','MERCEDES-BENZ','TESLA','AUDI','PORSCHE','LAND ROVER','LEXUS','ACURA','CADILLAC','INFINITI','VOLVO','GENESIS','JAGUAR','LINCOLN','MASERATI','LUCID','RIVIAN','POLESTAR','MINI')
    """).fetchone()
    stats['total_luxury_registered_ca'] = r[0] if r[0] else 0
    
    # Towing companies
    stats['towing_companies_indexed'] = conn.execute("SELECT COUNT(*) FROM chp_tow_services").fetchone()[0]
    
    # CHP offices
    stats['chp_offices'] = conn.execute("SELECT COUNT(*) FROM chp_area_offices").fetchone()[0]
    
    # Mailer targets
    stats['mailer_targets'] = conn.execute("SELECT COUNT(*) FROM luxury_mailer_targets").fetchone()[0]
    stats['high_priority_targets'] = conn.execute("SELECT COUNT(*) FROM luxury_mailer_targets WHERE recommended_action='HIGH PRIORITY'").fetchone()[0]
    
    # Top 5 mailer cities
    top = conn.execute("SELECT city, luxury_crashes_2025, mailer_priority_score FROM luxury_mailer_targets ORDER BY mailer_priority_score DESC LIMIT 5").fetchall()
    stats['top_5_mailer_cities'] = [dict(r) for r in top]
    
    conn.close()
    return jsonify(stats)
