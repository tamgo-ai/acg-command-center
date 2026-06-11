#!/usr/bin/env python3
"""
ACG Crash Intelligence — MCP Server
Connects Claude to all Crash Intel data: revenue radar, competitors,
market analysis, claims, DMV, crash patterns, and more.

Usage: Add to Claude Code MCP config or run via stdio.
"""

import sqlite3
import json
import math
import sys
import os
from pathlib import Path
from datetime import datetime

DB = Path(__file__).parent / "data" / "crash_intel.db"

# ── Tools registry ──────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "get_revenue_radar",
        "description": "Obtiene inteligencia competitiva completa para cada ubicación ACG: competidores cercanos, reputación (Google Reviews), flujo de aseguradoras, flota luxury cercana, y puntuación de oportunidad. Devuelve las 13 ubicaciones ordenadas por oportunidad.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "Filtrar por nombre de ubicación ACG (ej: 'Whittier HQ', 'Ontario'). Dejar vacío para todas."},
                "min_score": {"type": "integer", "description": "Filtrar por puntuación mínima de oportunidad (0-100)"},
            }
        }
    },
    {
        "name": "get_competitor_analysis",
        "description": "Análisis detallado de competidores (Caliber, Gerber, Crash Champions, etc.) cerca de cada ACG. Incluye distancia, ratings de Google reales, y comparación de reputación.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "acg_location": {"type": "string", "description": "Nombre de la ubicación ACG (ej: 'Whittier HQ')"},
                "max_distance_miles": {"type": "integer", "description": "Distancia máxima en millas para buscar competidores (default: 15)"},
            }
        }
    },
    {
        "name": "get_market_analysis",
        "description": "Análisis completo del mercado de colisión en California: tamaño de mercado, claims de seguro (CDI), customer-pay, DRP, aseguradoras principales, y tendencias de reparación.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Tema específico: 'overview', 'insurers', 'drp', 'customer_pay', 'repair_costs', 'claims'"},
            }
        }
    },
    {
        "name": "get_dmv_luxury_density",
        "description": "Densidad de vehículos luxury registrados (BMW, Mercedes, Tesla, etc.) por área geográfica. Usa datos reales del DMV de California (2025 snapshot).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lat": {"type": "number", "description": "Latitud del centro de búsqueda"},
                "lon": {"type": "number", "description": "Longitud del centro de búsqueda"},
                "radius_miles": {"type": "integer", "description": "Radio de búsqueda en millas (default: 10)"},
                "make": {"type": "string", "description": "Filtrar por marca específica (BMW, TESLA, MERCEDES-BENZ, etc.). Vacío para todas luxury."},
            }
        }
    },
    {
        "name": "get_crash_patterns",
        "description": "Patrones estacionales de accidentes en California: por mes, día de la semana, y hora del día. Basado en 3 años de datos CCRS (1.36M crashes).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern_type": {"type": "string", "description": "'monthly', 'daily', 'hourly', o 'all' para todos"},
            }
        }
    },
    {
        "name": "get_ad_zones",
        "description": "Zonas publicitarias de alto valor (geo-fence) enriquecidas con datos DMV de vehículos luxury registrados cerca. Puntuación compuesta: crash volume + luxury mix + DMV density + ACG proximity.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "make": {"type": "string", "description": "Filtrar por marca de vehículo (BMW, TESLA, etc.). 'ALL' para todas."},
                "city": {"type": "string", "description": "Filtrar por ciudad"},
                "min_score": {"type": "integer", "description": "Score compuesto mínimo (0-100)"},
                "limit": {"type": "integer", "description": "Número máximo de zonas a devolver (default: 10)"},
            }
        }
    },
    {
        "name": "get_claims_data",
        "description": "Datos reales de reclamaciones de seguro en California (CDI): claims por tipo (liability, collision, comprehensive), valores promedio, frecuencia, y comparación con crashes policiales.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "year": {"type": "string", "description": "Año de datos CDI (2018-2022). Default: 2022"},
            }
        }
    },
    {
        "name": "search_crashes",
        "description": "Buscar accidentes por ciudad, carretera, o tipo. Devuelve estadísticas agregadas.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Término de búsqueda (ciudad, carretera, marca de vehículo)"},
                "year": {"type": "string", "description": "Año (2023-2026). Default: 2025"},
            }
        }
    },
    {
        "name": "get_acg_locations",
        "description": "Lista las 13 ubicaciones de Auto Collision Group con datos de accidentes en su zona, marcas luxury que más chocan, y calles peligrosas cercanas.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "year": {"type": "string", "description": "Año de datos. Default: 2025"},
            }
        }
    },
    {
        "name": "get_forecast",
        "description": "Predicción de riesgo de accidentes a 7 días basada en clima × patrones históricos. Incluye condiciones actuales en tiempo real.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
]


def get_db():
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    return conn


# ── Tool implementations ─────────────────────────────────────────────────

def handle_get_revenue_radar(args):
    conn = get_db()
    location = args.get('location', '')
    min_score = args.get('min_score', 0)

    acg_locs = [
        ('Whittier HQ', 33.9792, -118.0327, 'Whittier'),
        ('Los Angeles', 34.0522, -118.2437, 'Los Angeles'),
        ('Gardena — Rosecrans', 33.8969, -118.3092, 'Gardena'),
        ('Gardena — Vermont', 33.8883, -118.3089, 'Gardena'),
        ('Santa Ana', 33.7455, -117.8677, 'Santa Ana'),
        ('Covina', 34.0900, -117.8903, 'Covina'),
        ('Ontario', 34.0633, -117.6509, 'Ontario'),
        ('Rancho Cucamonga', 34.1064, -117.5931, 'Rancho Cucamonga'),
        ('Victorville', 34.5362, -117.2928, 'Victorville'),
        ('Fresno', 36.7378, -119.7871, 'Fresno'),
        ('Bakersfield — Ming', 35.3733, -119.0187, 'Bakersfield'),
        ('Bakersfield — McCutchen', 35.3345, -119.0778, 'Bakersfield'),
        ('El Cajon', 32.7948, -116.9625, 'El Cajon'),
    ]

    results = []
    for name, lat, lon, city in acg_locs:
        if location and location.lower() not in name.lower():
            continue

        # Competitors
        comps = conn.execute("""
            SELECT competitor_brand, distance_miles, competitor_rating, competitor_reviews
            FROM acg_competitor_distances WHERE acg_name=?
            ORDER BY distance_miles
        """, [name]).fetchall()

        # Reputation
        rep = conn.execute("SELECT * FROM acg_reputation WHERE acg_name=?", [name]).fetchone()

        # Crash data
        crashes = conn.execute(
            "SELECT data FROM acg_location_cache WHERE year='2025' AND name=?", [name]
        ).fetchone()
        crash_data = json.loads(crashes['data']) if crashes else {}

        results.append({
            "acg_name": name,
            "city": city,
            "coordinates": {"lat": lat, "lon": lon},
            "competitors": [{"brand": c['competitor_brand'], "distance_miles": c['distance_miles'],
                           "google_rating": c['competitor_rating'], "google_reviews": c['competitor_reviews']}
                          for c in comps],
            "reputation": {
                "google_rating": rep['google_rating'] if rep else None,
                "google_reviews": rep['google_reviews'] if rep else None,
                "yelp_rating": rep['yelp_rating'] if rep else None,
            } if rep else None,
            "crash_data": {
                "total_crashes": crash_data.get('total_crashes', 0),
                "total_injured": crash_data.get('total_injured', 0),
                "top_roads": crash_data.get('top_roads', [])[:3],
            },
            "competitor_count": len(comps),
        })

    conn.close()
    return results


def handle_get_competitor_analysis(args):
    conn = get_db()
    acg = args.get('acg_location', 'Whittier HQ')
    max_dist = args.get('max_distance_miles', 15)

    comps = conn.execute("""
        SELECT competitor_name, competitor_brand, distance_miles,
               competitor_rating, competitor_reviews, competitor_city
        FROM acg_competitor_distances
        WHERE acg_name=? AND distance_miles <= ?
        ORDER BY distance_miles
    """, [acg, max_dist]).fetchall()

    acg_rep = conn.execute("SELECT * FROM acg_reputation WHERE acg_name=?", [acg]).fetchone()

    conn.close()

    return {
        "acg_location": acg,
        "acg_reputation": {"rating": acg_rep['google_rating'], "reviews": acg_rep['google_reviews']} if acg_rep else None,
        "competitors": [dict(c) for c in comps],
        "summary": f"{len(comps)} competidores en {max_dist} millas. "
                   f"Rango de ratings: {min([c['competitor_rating'] for c in comps]) if comps else 'N/A'}★ - "
                   f"{max([c['competitor_rating'] for c in comps]) if comps else 'N/A'}★"
    }


def handle_get_market_analysis(args):
    conn = get_db()
    topic = args.get('topic', 'overview')

    result = {}

    if topic in ('overview', 'insurers'):
        insurers = conn.execute("""
            SELECT company_name, market_share, written_premium, loss_ratio
            FROM cdi_insurers ORDER BY written_premium DESC LIMIT 10
        """).fetchall()
        result['top_insurers'] = [dict(i) for i in insurers]

    if topic in ('overview', 'claims'):
        liab = conn.execute("""
            SELECT year, num_claims, incurred_losses, earned_exposure
            FROM cdi_liability_claims WHERE program='ALL' AND coverage='ALL'
            ORDER BY year DESC LIMIT 1
        """).fetchone()
        phys = conn.execute("""
            SELECT year, num_claims, incurred_losses
            FROM cdi_physical_damage_claims WHERE program='ALL' AND coverage='ALL'
            ORDER BY year DESC LIMIT 1
        """).fetchone()
        if liab:
            result['liability_claims'] = dict(liab)
        if phys:
            result['physical_damage_claims'] = dict(phys)

    if topic in ('overview', 'repair_costs'):
        result['repair_economics'] = {
            "avg_repair_cost_2025": 5470,
            "increase_10yr_pct": 152,
            "labor_rate_ca": 78,
            "total_loss_pct": 22.6,
            "ev_repair_premium_pct": 47,
            "parts_mix": {"oem": 35, "aftermarket": 38, "recycled": 27},
        }

    if topic in ('overview', 'drp'):
        result['drp'] = {
            "pct_claims_through_drp": 60,
            "california_anti_steering": True,
            "customer_pay_pct": 20,
            "customer_pay_trend": "Rising from 8% (2021) to 20% (2025)",
        }

    conn.close()
    return result


def handle_get_dmv_luxury_density(args):
    conn = get_db()
    lat = args.get('lat', 34.05)
    lon = args.get('lon', -118.25)
    radius = args.get('radius_miles', 10)
    make = args.get('make', '')

    lat_r = radius / 69.0
    lon_r = lat_r / abs(math.cos(math.radians(lat)))

    LUXURY_MAKES = "'BMW','MERCEDES-BENZ','TESLA','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID'"

    make_filter = f"AND d.make = '{make.upper()}'" if make else f"AND d.make IN ({LUXURY_MAKES})"

    rows = conn.execute(f"""
        SELECT d.make, SUM(d.vehicles) as total
        FROM dmv_vehicles_by_zip d
        JOIN zip_centroids zc ON d.zip_code = zc.zip_code
        WHERE d.data_year='2025' {make_filter}
        AND zc.lat BETWEEN ? AND ? AND zc.lon BETWEEN ? AND ?
        GROUP BY d.make ORDER BY total DESC
    """, [lat - lat_r, lat + lat_r, lon - lon_r, lon + lon_r]).fetchall()

    total = sum(r['total'] for r in rows)
    conn.close()

    return {
        "center": {"lat": lat, "lon": lon},
        "radius_miles": radius,
        "make_filter": make or "ALL LUXURY",
        "total_luxury_vehicles": total,
        "by_make": [{"make": r['make'], "vehicles": r['total'],
                     "pct": round(r['total'] / max(total, 1) * 100, 1)} for r in rows[:10]],
    }


def handle_get_crash_patterns(args):
    conn = get_db()
    pattern = args.get('pattern_type', 'all')

    result = {}
    if pattern in ('all', 'monthly'):
        result['monthly'] = [dict(r) for r in conn.execute(
            "SELECT * FROM seasonal_patterns WHERE pattern_type='monthly' ORDER BY pattern_key"
        ).fetchall()]

    if pattern in ('all', 'daily'):
        result['daily'] = [dict(r) for r in conn.execute(
            "SELECT * FROM seasonal_patterns WHERE pattern_type='dow' ORDER BY avg_3yr DESC"
        ).fetchall()]

    if pattern in ('all', 'hourly'):
        result['hourly'] = [dict(r) for r in conn.execute(
            "SELECT * FROM seasonal_patterns WHERE pattern_type='hourly' ORDER BY CAST(pattern_key AS INTEGER)"
        ).fetchall()]

    conn.close()

    # Add insights
    if result.get('monthly'):
        peak = max(result['monthly'], key=lambda x: x['avg_3yr'])
        low = min(result['monthly'], key=lambda x: x['avg_3yr'])
        result['insight'] = f"Peak month: {peak['pattern_key']} ({peak['avg_3yr']:,.0f} avg crashes). "
        result['insight'] += f"Lowest: {low['pattern_key']} ({low['avg_3yr']:,.0f}). "
        result['insight'] += f"Seasonal swing: +{round((peak['avg_3yr']-low['avg_3yr'])/low['avg_3yr']*100)}%."

    return result


def handle_get_ad_zones(args):
    conn = get_db()
    make = args.get('make', 'ALL')
    city = args.get('city', '')
    min_score = args.get('min_score', 0)
    limit = args.get('limit', 10)

    # Use cached data if available
    cache_key = f"composite_2025_{make}_25"
    cached = conn.execute("SELECT data FROM ad_intel_cache WHERE cache_key=?", [cache_key]).fetchone()
    if cached:
        zones = json.loads(cached[0])['zones']
    else:
        zones = []

    if city:
        zones = [z for z in zones if city.lower() in z.get('city', '').lower()]
    if min_score:
        zones = [z for z in zones if z.get('ad_score', 0) >= min_score]

    conn.close()

    result = []
    for z in zones[:limit]:
        result.append({
            "name": z['name'],
            "city": z['city'],
            "ad_score": z.get('ad_score', 0),
            "total_crashes": z['stats']['total_crashes'],
            "luxury_pct": z['stats']['luxury_pct'],
            "dmv_luxury_nearby": z['stats'].get('dmv_luxury_total', 0),
            "nearest_acg": z['stats'].get('nearest_acg', ''),
            "top_luxury_brands": z['stats'].get('top_luxury', [])[:3],
        })

    return {"count": len(result), "zones": result}


def handle_get_claims_data(args):
    conn = get_db()
    year = args.get('year', '2022')

    liab = conn.execute("""
        SELECT * FROM cdi_liability_claims WHERE year=? AND program='ALL' AND coverage='ALL'
    """, [year]).fetchone()
    phys = conn.execute("""
        SELECT * FROM cdi_physical_damage_claims WHERE year=? AND program='ALL' AND coverage='ALL'
    """, [year]).fetchone()

    # CCRS comparison
    ccr_year = '2025'
    ccr = conn.execute("""
        SELECT COUNT(*) as n FROM crashes WHERE crash_date>=? AND crash_date<?
    """, [f'{ccr_year}-01-01', f'{int(ccr_year)+1}-01-01']).fetchone()

    conn.close()

    total_claims = (liab['num_claims'] if liab else 0) + (phys['num_claims'] if phys else 0)
    return {
        "cdi_year": year,
        "ccr_year": ccr_year,
        "total_claims": total_claims,
        "police_reported": ccr['n'],
        "claims_per_crash": round(total_claims / max(ccr['n'], 1), 1),
        "liability": dict(liab) if liab else None,
        "physical_damage": dict(phys) if phys else None,
    }


def handle_search_crashes(args):
    conn = get_db()
    query = args.get('query', '')
    year = args.get('year', '2025')

    results = conn.execute("""
        SELECT c.city_name, c.primary_road, COUNT(*) as crashes,
               COALESCE(SUM(c.number_injured),0) as injured
        FROM crashes c
        WHERE c.crash_date>=? AND c.crash_date<?
          AND (c.city_name LIKE ? OR c.primary_road LIKE ? OR c.secondary_road LIKE ?)
        GROUP BY c.city_name, c.primary_road
        ORDER BY crashes DESC LIMIT 15
    """, [f'{year}-01-01', f'{int(year)+1}-01-01',
          f'%{query}%', f'%{query}%', f'%{query}%']).fetchall()

    conn.close()
    return [dict(r) for r in results]


def handle_get_acg_locations(args):
    conn = get_db()
    year = args.get('year', '2025')

    locations = [
        {'name': 'Whittier HQ', 'city': 'Whittier', 'address': '12426 Lambert Rd., Whittier, CA 90606',
         'phone': '562-317-1400', 'certifications': 'BMW, Tesla, Mercedes, Maserati, Porsche, Audi + 29 more'},
        {'name': 'Los Angeles', 'city': 'Los Angeles', 'address': 'Los Angeles, CA 90001', 'phone': '833-333-4224'},
        {'name': 'Gardena — Rosecrans', 'city': 'Gardena', 'address': '1706 W Rosecrans Ave., Gardena, CA 90249', 'phone': '424-360-0700'},
        {'name': 'Gardena — Vermont', 'city': 'Gardena', 'address': 'Gardena, CA 90247', 'phone': '833-333-4224'},
        {'name': 'Santa Ana', 'city': 'Santa Ana', 'address': 'Santa Ana, CA 92701', 'phone': '833-333-4224'},
        {'name': 'Covina', 'city': 'Covina', 'address': 'Covina, CA 91722', 'phone': '833-333-4224'},
        {'name': 'Ontario', 'city': 'Ontario', 'address': 'Ontario, CA 91761', 'phone': '833-333-4224'},
        {'name': 'Rancho Cucamonga', 'city': 'Rancho Cucamonga', 'address': 'Rancho Cucamonga, CA 91730', 'phone': '833-333-4224'},
        {'name': 'Victorville', 'city': 'Victorville', 'address': 'Victorville, CA 92392', 'phone': '833-333-4224'},
        {'name': 'Fresno', 'city': 'Fresno', 'address': 'Fresno, CA 93711', 'phone': '833-333-4224'},
        {'name': 'Bakersfield — Ming', 'city': 'Bakersfield', 'address': 'Ming Ave, Bakersfield, CA 93301', 'phone': '833-333-4224'},
        {'name': 'Bakersfield — McCutchen', 'city': 'Bakersfield', 'address': '6916 McCutchen Rd., Bakersfield, CA 93309', 'phone': '661-460-1400'},
        {'name': 'El Cajon', 'city': 'El Cajon', 'address': 'El Cajon, CA 92020', 'phone': '833-333-4224'},
    ]

    for loc in locations:
        cached = conn.execute("SELECT data FROM acg_location_cache WHERE year=? AND name=?",
                            [year, loc['name']]).fetchone()
        if cached:
            d = json.loads(cached[0])
            loc['total_crashes'] = d.get('total_crashes', 0)
            loc['total_injured'] = d.get('total_injured', 0)
            loc['top_roads'] = d.get('top_roads', [])[:3]

    conn.close()
    return locations


def handle_get_forecast(args):
    conn = get_db()
    rows = conn.execute("""
        SELECT * FROM daily_forecasts ORDER BY date, risk_score DESC
    """).fetchall()

    # Current conditions
    current = conn.execute("""
        SELECT location_name, temp_c, weather_icon, weather_label, wind_speed_kmh, humidity_pct
        FROM weather_current ORDER BY fetched_at DESC LIMIT 10
    """).fetchall()

    conn.close()

    # Group by date
    by_date = {}
    for r in rows:
        d = r['date']
        if d not in by_date:
            by_date[d] = []
        by_date[d].append(dict(r))

    forecast = []
    for date_str in sorted(by_date.keys())[:7]:
        zones = by_date[date_str]
        max_score = max(z['risk_score'] for z in zones)
        forecast.append({
            "date": date_str,
            "zones_count": len(zones),
            "max_risk_score": max_score,
            "weather": zones[0]['weather_label'],
            "icon": zones[0]['weather_icon'],
        })

    return {
        "current_conditions": [dict(c) for c in current],
        "forecast": forecast,
    }


# ── Tool dispatcher ──────────────────────────────────────────────────────

HANDLERS = {
    "get_revenue_radar": handle_get_revenue_radar,
    "get_competitor_analysis": handle_get_competitor_analysis,
    "get_market_analysis": handle_get_market_analysis,
    "get_dmv_luxury_density": handle_get_dmv_luxury_density,
    "get_crash_patterns": handle_get_crash_patterns,
    "get_ad_zones": handle_get_ad_zones,
    "get_claims_data": handle_get_claims_data,
    "search_crashes": handle_search_crashes,
    "get_acg_locations": handle_get_acg_locations,
    "get_forecast": handle_get_forecast,
}


# ── MCP stdio server ─────────────────────────────────────────────────────

def run_mcp_server():
    """Run as MCP stdio server (for Claude Code / Claude Desktop)"""
    import sys

    # Send initialize response
    init_msg = json.loads(sys.stdin.readline())
    print(json.dumps({
        "jsonrpc": "2.0",
        "id": init_msg.get("id", 0),
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "acg-crash-intel", "version": "1.0.0"}
        }
    }))
    sys.stdout.flush()

    # Send tools/list response
    list_msg = json.loads(sys.stdin.readline())
    print(json.dumps({
        "jsonrpc": "2.0",
        "id": list_msg.get("id", 1),
        "result": {"tools": TOOLS}
    }))
    sys.stdout.flush()

    # Handle tool calls
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            msg = json.loads(line)

            if msg.get("method") == "tools/call":
                tool_name = msg["params"]["name"]
                tool_args = msg["params"].get("arguments", {})

                handler = HANDLERS.get(tool_name)
                if handler:
                    result = handler(tool_args)
                    print(json.dumps({
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "result": {
                            "content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]
                        }
                    }))
                else:
                    print(json.dumps({
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "error": {"code": -32601, "message": f"Tool not found: {tool_name}"}
                    }))
                sys.stdout.flush()

        except Exception as e:
            print(json.dumps({
                "jsonrpc": "2.0",
                "id": msg.get("id", 0) if 'msg' in dir() else 0,
                "error": {"code": -32603, "message": str(e)}
            }))
            sys.stdout.flush()


def test_tool(tool_name, args=None):
    """Test a tool directly (CLI mode)"""
    handler = HANDLERS.get(tool_name)
    if not handler:
        print(f"Unknown tool: {tool_name}")
        print(f"Available: {list(HANDLERS.keys())}")
        return
    result = handler(args or {})
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    if "--test" in sys.argv:
        tool = sys.argv[2] if len(sys.argv) > 2 else "get_revenue_radar"
        print(f"Testing tool: {tool}\n")
        test_tool(tool)
    elif "--list" in sys.argv:
        print(json.dumps(TOOLS, indent=2))
    elif "--tool" in sys.argv:
        tool = sys.argv[sys.argv.index("--tool") + 1]
        import argparse
        args_str = sys.argv[sys.argv.index("--tool") + 2] if len(sys.argv) > sys.argv.index("--tool") + 2 else "{}"
        test_tool(tool, json.loads(args_str))
    else:
        run_mcp_server()
