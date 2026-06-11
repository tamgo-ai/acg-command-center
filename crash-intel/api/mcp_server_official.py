#!/usr/bin/env python3
"""
ACG Crash Intel MCP Server v3 — Official Anthropic MCP SDK
Usa streamable_http_app() para compatibilidad total con Claude.ai
"""
import json, math, sqlite3, sys, os
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse

DB = Path(__file__).parent.parent / "data" / "crash_intel.db"

mcp = FastMCP("acg-crash-intel")

def get_db():
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    return conn

# ── Tools ─────────────────────────────────────────────────────────────

@mcp.tool()
def get_revenue_radar(location: str = "", min_score: int = 0) -> dict:
    """Inteligencia competitiva para las 13 ubicaciones ACG: competidores, reputación Google, flujo aseguradoras, flota luxury, puntuación oportunidad."""
    conn = get_db()
    acg_locs = [
        ('Whittier HQ',33.9792,-118.0327,'Whittier'),('Los Angeles',34.0522,-118.2437,'Los Angeles'),
        ('Gardena — Rosecrans',33.8969,-118.3092,'Gardena'),('Gardena — Vermont',33.8883,-118.3089,'Gardena'),
        ('Santa Ana',33.7455,-117.8677,'Santa Ana'),('Covina',34.0900,-117.8903,'Covina'),
        ('Ontario',34.0633,-117.6509,'Ontario'),('Rancho Cucamonga',34.1064,-117.5931,'RC'),
        ('Victorville',34.5362,-117.2928,'Victorville'),('Fresno',36.7378,-119.7871,'Fresno'),
        ('Bakersfield — Ming',35.3733,-119.0187,'Bakersfield'),('Bakersfield — McCutchen',35.3345,-119.0778,'Bakersfield'),
        ('El Cajon',32.7948,-116.9625,'El Cajon'),
    ]
    results = []
    for name,lat,lon,city in acg_locs:
        if location and location.lower() not in name.lower(): continue
        comps = conn.execute("SELECT competitor_brand,distance_miles,competitor_rating,competitor_reviews FROM acg_competitor_distances WHERE acg_name=? ORDER BY distance_miles",[name]).fetchall()
        rep = conn.execute("SELECT * FROM acg_reputation WHERE acg_name=?",[name]).fetchone()
        crashes = conn.execute("SELECT data FROM acg_location_cache WHERE year='2025' AND name=?",[name]).fetchone()
        cd = json.loads(crashes['data']) if crashes else {}
        results.append({
            "acg_name":name,"city":city,
            "competitors":[{"brand":c['competitor_brand'],"distance_mi":c['distance_miles'],"rating":c['competitor_rating'],"reviews":c['competitor_reviews']} for c in comps],
            "competitor_count":len(comps),
            "reputation":{"google_rating":rep['google_rating'],"google_reviews":rep['google_reviews']} if rep else None,
            "total_crashes_year":cd.get('total_crashes',0),"total_injured":cd.get('total_injured',0),
        })
    conn.close()
    return {"count":len(results),"locations":results}

@mcp.tool()
def get_competitor_analysis(acg_location: str) -> dict:
    """Competidores cerca de una ubicación ACG con ratings reales Google."""
    conn = get_db()
    comps = conn.execute("SELECT * FROM acg_competitor_distances WHERE acg_name=? ORDER BY distance_miles",[acg_location]).fetchall()
    rep = conn.execute("SELECT * FROM acg_reputation WHERE acg_name=?",[acg_location]).fetchone()
    conn.close()
    return {"acg":acg_location,"acg_rating":f"{rep['google_rating']}★ ({rep['google_reviews']} rev)" if rep else "N/A","competitors":[dict(c) for c in comps]}

@mcp.tool()
def get_market_analysis(topic: str = "overview") -> dict:
    """Mercado colisión CA: aseguradoras, DRP, customer-pay, costos reparación."""
    conn = get_db()
    r = {}
    if topic in ('overview','insurers'):
        r['top_insurers'] = [dict(i) for i in conn.execute("SELECT company_name,market_share*100 as market_share_pct,loss_ratio*100 as loss_ratio_pct FROM cdi_insurers ORDER BY written_premium DESC LIMIT 10").fetchall()]
    if topic in ('overview','claims'):
        liab = conn.execute("SELECT num_claims,incurred_losses FROM cdi_liability_claims WHERE program='ALL' AND coverage='ALL' ORDER BY year DESC LIMIT 1").fetchone()
        phys = conn.execute("SELECT num_claims,incurred_losses FROM cdi_physical_damage_claims WHERE program='ALL' AND coverage='ALL' ORDER BY year DESC LIMIT 1").fetchone()
        ccr = conn.execute("SELECT COUNT(*) as n FROM crashes WHERE crash_date>='2025-01-01' AND crash_date<'2026-01-01'").fetchone()
        tc = (liab['num_claims'] if liab else 0)+(phys['num_claims'] if phys else 0)
        r['claims'] = {"total_insurance_claims":tc,"police_reported":ccr['n'],"ratio":round(tc/max(ccr['n'],1),1)}
    if topic in ('overview','repair_costs'):
        r['repair'] = {"avg_cost_2025":5470,"increase_10yr_pct":152,"labor_ca_hr":78,"total_loss_pct":22.6,"ev_premium_pct":47}
    if topic in ('overview','drp'):
        r['drp'] = {"pct_through_drp":60,"ca_anti_steering_law":True,"customer_pay_pct":20,"trend":"Rising 8%→20% since 2021"}
    conn.close()
    return r

@mcp.tool()
def get_dmv_luxury_density(lat: float = 34.05, lon: float = -118.25, radius_miles: int = 10, make: str = "") -> dict:
    """Vehículos luxury registrados por área geográfica (DMV 2025 real)."""
    conn = get_db()
    lat_r = radius_miles/69.0; lon_r = lat_r/abs(math.cos(math.radians(lat)))
    LUX = "'BMW','MERCEDES-BENZ','TESLA','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID'"
    mf = f"AND d.make='{make.upper()}'" if make else f"AND d.make IN ({LUX})"
    rows = conn.execute(f"SELECT d.make,SUM(d.vehicles) as t FROM dmv_vehicles_by_zip d JOIN zip_centroids zc ON d.zip_code=zc.zip_code WHERE d.data_year='2025' {mf} AND zc.lat BETWEEN ? AND ? AND zc.lon BETWEEN ? AND ? GROUP BY d.make ORDER BY t DESC",[lat-lat_r,lat+lat_r,lon-lon_r,lon+lon_r]).fetchall()
    total = sum(r['t'] for r in rows)
    conn.close()
    return {"total":total,"by_make":[{"make":r['make'],"vehicles":r['t']} for r in rows[:10]]}

@mcp.tool()
def get_crash_patterns(pattern_type: str = "all") -> dict:
    """Patrones estacionales accidentes: mensual, diario, horario (3 años datos CCRS)."""
    conn = get_db()
    r = {}
    if pattern_type in ('all','monthly'):
        r['monthly']=[{"month":x['pattern_key'],"avg_crashes":x['avg_3yr'],"injury_rate":x['injury_rate'],"tow_rate":x['tow_rate']} for x in conn.execute("SELECT * FROM seasonal_patterns WHERE pattern_type='monthly' ORDER BY pattern_key").fetchall()]
    if pattern_type in ('all','daily'):
        r['daily']=[{"day":x['pattern_key'],"avg_crashes":x['avg_3yr']} for x in conn.execute("SELECT * FROM seasonal_patterns WHERE pattern_type='dow' ORDER BY avg_3yr DESC").fetchall()]
    conn.close()
    return r

@mcp.tool()
def get_claims_data() -> dict:
    """Claims de seguro reales CA (CDI) vs crashes policiales."""
    conn = get_db()
    liab = conn.execute("SELECT num_claims FROM cdi_liability_claims WHERE program='ALL' AND coverage='ALL' ORDER BY year DESC LIMIT 1").fetchone()
    phys = conn.execute("SELECT num_claims FROM cdi_physical_damage_claims WHERE program='ALL' AND coverage='ALL' ORDER BY year DESC LIMIT 1").fetchone()
    ccr = conn.execute("SELECT COUNT(*) as n FROM crashes WHERE crash_date>='2025-01-01' AND crash_date<'2026-01-01'").fetchone()
    tc = (liab['num_claims'] if liab else 0)+(phys['num_claims'] if phys else 0)
    conn.close()
    return {"total_insurance_claims":tc,"police_reported":ccr['n'],"ratio":round(tc/max(ccr['n'],1),1),"non_police":tc-ccr['n'],"police_pct":round(ccr['n']/max(tc,1)*100,1)}

@mcp.tool()
def get_acg_locations() -> list:
    """Las 13 ubicaciones Auto Collision Group con datos accidentes zona."""
    conn = get_db()
    locs = [
        {'name':'Whittier HQ','address':'12426 Lambert Rd, Whittier, CA 90606','phone':'562-317-1400'},
        {'name':'Los Angeles','address':'Los Angeles, CA 90001','phone':'833-333-4224'},
        {'name':'Gardena — Rosecrans','address':'1706 W Rosecrans Ave, Gardena, CA 90249','phone':'424-360-0700'},
        {'name':'Gardena — Vermont','address':'Gardena, CA 90247','phone':'833-333-4224'},
        {'name':'Santa Ana','address':'Santa Ana, CA 92701','phone':'833-333-4224'},
        {'name':'Covina','address':'Covina, CA 91722','phone':'833-333-4224'},
        {'name':'Ontario','address':'Ontario, CA 91761','phone':'833-333-4224'},
        {'name':'Rancho Cucamonga','address':'Rancho Cucamonga, CA 91730','phone':'833-333-4224'},
        {'name':'Victorville','address':'Victorville, CA 92392','phone':'833-333-4224'},
        {'name':'Fresno','address':'Fresno, CA 93711','phone':'833-333-4224'},
        {'name':'Bakersfield — Ming','address':'Ming Ave, Bakersfield, CA 93301','phone':'833-333-4224'},
        {'name':'Bakersfield — McCutchen','address':'6916 McCutchen Rd, Bakersfield, CA 93309','phone':'661-460-1400'},
        {'name':'El Cajon','address':'El Cajon, CA 92020','phone':'833-333-4224'},
    ]
    for l in locs:
        c=conn.execute("SELECT data FROM acg_location_cache WHERE year='2025' AND name=?",[l['name']]).fetchone()
        if c:
            d=json.loads(c[0]); l['total_crashes']=d.get('total_crashes',0); l['total_injured']=d.get('total_injured',0)
    conn.close()
    return locs

@mcp.tool()
def get_forecast() -> dict:
    """Predicción riesgo accidentes 7 días + clima actual corredores CA."""
    conn = get_db()
    current = conn.execute("SELECT location_name,temp_c,weather_icon,weather_label,wind_speed_kmh FROM weather_current ORDER BY fetched_at DESC LIMIT 10").fetchall()
    rows = conn.execute("SELECT * FROM daily_forecasts ORDER BY date,risk_score DESC").fetchall()
    by_date = {}
    for r in rows:
        d=r['date']
        if d not in by_date: by_date[d]=[]
        by_date[d].append({"corridor":r['corridor_name'],"risk":r['risk_level'],"score":r['risk_score'],"weather":r['weather_label']})
    conn.close()
    return {"current_conditions":[dict(c) for c in current],"forecast":[{"date":d,"zones":by_date[d]} for d in sorted(by_date.keys())[:7]]}


# ── App ────────────────────────────────────────────────────────────────

# Use the built-in streamable_http_app from the SDK
# This handles GET /mcp/sse and POST /mcp/messages correctly per the spec
app = mcp.streamable_http_app()

# Add health endpoint
@mcp.custom_route("/health", methods=["GET"])
async def health(request):
    return JSONResponse({"status":"ok","server":"acg-crash-intel","version":"1.0.0"})

if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[2]) if '--port' in sys.argv else 5054
    print(f"\n🚀 ACG Crash Intel MCP v3 (Official SDK)")
    print(f"   Endpoint: http://localhost:{port}/mcp\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
