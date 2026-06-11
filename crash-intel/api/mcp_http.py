#!/usr/bin/env python3
"""
ACG Crash Intelligence — MCP HTTP Server (SSE)
Endpoint para conectar Claude.ai / Claude API a todos los datos de Crash Intel.

Usage:
  python3 api/mcp_http.py --port 5053

Endpoints:
  GET  /mcp/sse      — SSE stream para MCP
  POST /mcp/messages — JSON-RPC messages
  GET  /mcp/health   — Health check
"""

import json, math, sys, os
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import sqlite3
import queue
import threading
import uuid

DB = Path(__file__).parent.parent / "data" / "crash_intel.db"

app = Flask(__name__)
CORS(app)

# ── SSE Connection Manager ──────────────────────────────────────────────

sessions = {}  # session_id -> queue

def get_db():
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    return conn

# ── Tools ────────────────────────────────────────────────────────────────

TOOLS = [
    {"name":"get_revenue_radar","description":"Inteligencia competitiva para las 13 ubicaciones ACG: competidores, reputación, aseguradoras, flota luxury, y puntuación de oportunidad.","inputSchema":{"type":"object","properties":{"location":{"type":"string","description":"Filtrar por ubicación (ej: 'Whittier HQ')"},"min_score":{"type":"integer","description":"Score mínimo (0-100)"}}}},
    {"name":"get_competitor_analysis","description":"Competidores cerca de una ubicación ACG con ratings reales de Google, distancia, y comparación de reputación.","inputSchema":{"type":"object","properties":{"acg_location":{"type":"string","description":"Ubicación ACG"},"max_distance_miles":{"type":"integer"}}}},
    {"name":"get_market_analysis","description":"Mercado de colisión en CA: tamaño, aseguradoras, DRP, customer-pay, costos de reparación.","inputSchema":{"type":"object","properties":{"topic":{"type":"string","description":"'overview', 'insurers', 'drp', 'customer_pay', 'repair_costs'"}}}},
    {"name":"get_dmv_luxury_density","description":"Vehículos luxury registrados por área geográfica (datos DMV 2025).","inputSchema":{"type":"object","properties":{"lat":{"type":"number"},"lon":{"type":"number"},"radius_miles":{"type":"integer"},"make":{"type":"string"}}}},
    {"name":"get_crash_patterns","description":"Patrones estacionales de accidentes: mensual, diario, horario (3 años de datos).","inputSchema":{"type":"object","properties":{"pattern_type":{"type":"string","description":"'monthly', 'daily', 'hourly', o 'all'"}}}},
    {"name":"get_ad_zones","description":"Zonas publicitarias de alto valor con datos DMV de vehículos luxury.","inputSchema":{"type":"object","properties":{"make":{"type":"string"},"city":{"type":"string"},"min_score":{"type":"integer"},"limit":{"type":"integer"}}}},
    {"name":"get_claims_data","description":"Datos reales de claims de seguro en CA (CDI) con comparación police-reported.","inputSchema":{"type":"object","properties":{"year":{"type":"string"}}}},
    {"name":"search_crashes","description":"Buscar accidentes por ciudad, carretera, o marca de vehículo.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"year":{"type":"string"}}}},
    {"name":"get_acg_locations","description":"Las 13 ubicaciones de Auto Collision Group con datos de accidentes en su zona.","inputSchema":{"type":"object","properties":{"year":{"type":"string"}}}},
    {"name":"get_forecast","description":"Predicción de riesgo de accidentes a 7 días con clima en tiempo real.","inputSchema":{"type":"object","properties":{}}},
]

def execute_tool(name, args):
    conn = get_db()
    try:
        if name == "get_revenue_radar":
            return _revenue_radar(conn, args)
        elif name == "get_competitor_analysis":
            return _competitor_analysis(conn, args)
        elif name == "get_market_analysis":
            return _market_analysis(conn, args)
        elif name == "get_dmv_luxury_density":
            return _dmv_density(conn, args)
        elif name == "get_crash_patterns":
            return _crash_patterns(conn, args)
        elif name == "get_ad_zones":
            return _ad_zones(conn, args)
        elif name == "get_claims_data":
            return _claims_data(conn, args)
        elif name == "search_crashes":
            return _search_crashes(conn, args)
        elif name == "get_acg_locations":
            return _acg_locations(conn, args)
        elif name == "get_forecast":
            return _forecast(conn)
        return {"error": f"Unknown tool: {name}"}
    finally:
        conn.close()

def _revenue_radar(conn, args):
    acg_locs = [
        ('Whittier HQ',33.9792,-118.0327,'Whittier'),('Los Angeles',34.0522,-118.2437,'Los Angeles'),
        ('Gardena — Rosecrans',33.8969,-118.3092,'Gardena'),('Gardena — Vermont',33.8883,-118.3089,'Gardena'),
        ('Santa Ana',33.7455,-117.8677,'Santa Ana'),('Covina',34.0900,-117.8903,'Covina'),
        ('Ontario',34.0633,-117.6509,'Ontario'),('Rancho Cucamonga',34.1064,-117.5931,'Rancho Cucamonga'),
        ('Victorville',34.5362,-117.2928,'Victorville'),('Fresno',36.7378,-119.7871,'Fresno'),
        ('Bakersfield — Ming',35.3733,-119.0187,'Bakersfield'),('Bakersfield — McCutchen',35.3345,-119.0778,'Bakersfield'),
        ('El Cajon',32.7948,-116.9625,'El Cajon'),
    ]
    location = args.get('location','')
    min_score = args.get('min_score',0)
    results = []
    for name,lat,lon,city in acg_locs:
        if location and location.lower() not in name.lower(): continue
        comps = conn.execute("SELECT competitor_brand,distance_miles,competitor_rating,competitor_reviews FROM acg_competitor_distances WHERE acg_name=? ORDER BY distance_miles",[name]).fetchall()
        rep = conn.execute("SELECT * FROM acg_reputation WHERE acg_name=?",[name]).fetchone()
        crashes = conn.execute("SELECT data FROM acg_location_cache WHERE year='2025' AND name=?",[name]).fetchone()
        cd = json.loads(crashes['data']) if crashes else {}
        results.append({"acg_name":name,"city":city,"competitors":[dict(c) for c in comps],"competitor_count":len(comps),
                       "reputation":{"google_rating":rep['google_rating'],"google_reviews":rep['google_reviews']} if rep else None,
                       "total_crashes":cd.get('total_crashes',0),"total_injured":cd.get('total_injured',0)})
    return {"count":len(results),"locations":results}

def _competitor_analysis(conn, args):
    acg = args.get('acg_location','Whittier HQ')
    md = args.get('max_distance_miles',15)
    comps = conn.execute("SELECT * FROM acg_competitor_distances WHERE acg_name=? AND distance_miles<=? ORDER BY distance_miles",[acg,md]).fetchall()
    rep = conn.execute("SELECT * FROM acg_reputation WHERE acg_name=?",[acg]).fetchone()
    return {"acg":acg,"acg_reputation":dict(rep) if rep else None,"competitors":[dict(c) for c in comps],
            "summary":f"{len(comps)} competidores en {md} millas. Ratings: {min([c['competitor_rating'] for c in comps]) if comps else 'N/A'}★ - {max([c['competitor_rating'] for c in comps]) if comps else 'N/A'}★"}

def _market_analysis(conn, args):
    topic = args.get('topic','overview')
    r = {}
    if topic in ('overview','insurers'):
        r['top_insurers'] = [dict(i) for i in conn.execute("SELECT company_name,market_share,written_premium,loss_ratio FROM cdi_insurers ORDER BY written_premium DESC LIMIT 10").fetchall()]
    if topic in ('overview','claims'):
        liab = conn.execute("SELECT * FROM cdi_liability_claims WHERE program='ALL' AND coverage='ALL' ORDER BY year DESC LIMIT 1").fetchone()
        phys = conn.execute("SELECT * FROM cdi_physical_damage_claims WHERE program='ALL' AND coverage='ALL' ORDER BY year DESC LIMIT 1").fetchone()
        if liab: r['liability'] = dict(liab)
        if phys: r['physical_damage'] = dict(phys)
    if topic in ('overview','repair_costs'):
        r['repair'] = {"avg_cost_2025":5470,"increase_10yr_pct":152,"labor_ca":78,"total_loss_pct":22.6,"ev_premium_pct":47,"parts_oem":35,"parts_aftermarket":38,"parts_recycled":27}
    if topic in ('overview','drp'):
        r['drp'] = {"pct_through_drp":60,"ca_anti_steering":True,"customer_pay_pct":20}
    return r

def _dmv_density(conn, args):
    lat = args.get('lat',34.05); lon = args.get('lon',-118.25); radius = args.get('radius_miles',10); make = args.get('make','')
    lat_r = radius/69.0; lon_r = lat_r/abs(math.cos(math.radians(lat)))
    LUX = "'BMW','MERCEDES-BENZ','TESLA','AUDI','LEXUS','PORSCHE','MASERATI','JAGUAR','LAND ROVER','CADILLAC','ACURA','INFINITI','GENESIS','VOLVO','BENTLEY','FERRARI','LAMBORGHINI','RIVIAN','LUCID'"
    mf = f"AND d.make='{make.upper()}'" if make else f"AND d.make IN ({LUX})"
    rows = conn.execute(f"SELECT d.make,SUM(d.vehicles) as total FROM dmv_vehicles_by_zip d JOIN zip_centroids zc ON d.zip_code=zc.zip_code WHERE d.data_year='2025' {mf} AND zc.lat BETWEEN ? AND ? AND zc.lon BETWEEN ? AND ? GROUP BY d.make ORDER BY total DESC",[lat-lat_r,lat+lat_r,lon-lon_r,lon+lon_r]).fetchall()
    total = sum(r['total'] for r in rows)
    return {"center":{"lat":lat,"lon":lon},"radius_miles":radius,"total_luxury":total,"by_make":[{"make":r['make'],"vehicles":r['total'],"pct":round(r['total']/max(total,1)*100,1)} for r in rows[:10]]}

def _crash_patterns(conn, args):
    pt = args.get('pattern_type','all'); r = {}
    if pt in ('all','monthly'): r['monthly']=[dict(x) for x in conn.execute("SELECT * FROM seasonal_patterns WHERE pattern_type='monthly' ORDER BY pattern_key").fetchall()]
    if pt in ('all','daily'): r['daily']=[dict(x) for x in conn.execute("SELECT * FROM seasonal_patterns WHERE pattern_type='dow' ORDER BY avg_3yr DESC").fetchall()]
    if pt in ('all','hourly'): r['hourly']=[dict(x) for x in conn.execute("SELECT * FROM seasonal_patterns WHERE pattern_type='hourly' ORDER BY CAST(pattern_key AS INTEGER)").fetchall()]
    if r.get('monthly'):
        peak=max(r['monthly'],key=lambda x:x['avg_3yr']); low=min(r['monthly'],key=lambda x:x['avg_3yr'])
        r['insight']=f"Peak: {peak['pattern_key']} ({peak['avg_3yr']:,.0f}). Low: {low['pattern_key']} ({low['avg_3yr']:,.0f}). Swing: +{round((peak['avg_3yr']-low['avg_3yr'])/low['avg_3yr']*100)}%."
    return r

def _ad_zones(conn, args):
    make = args.get('make','ALL'); city = args.get('city',''); ms = args.get('min_score',0); limit = args.get('limit',10)
    cached = conn.execute("SELECT data FROM ad_intel_cache WHERE cache_key=?",[f"composite_2025_{make}_25"]).fetchone()
    zones = json.loads(cached[0])['zones'] if cached else []
    if city: zones=[z for z in zones if city.lower() in z.get('city','').lower()]
    if ms: zones=[z for z in zones if z.get('ad_score',0)>=ms]
    return {"count":len(zones[:limit]),"zones":[{"name":z['name'],"city":z['city'],"ad_score":z.get('ad_score',0),"total_crashes":z['stats']['total_crashes'],"luxury_pct":z['stats']['luxury_pct'],"dmv_nearby":z['stats'].get('dmv_luxury_total',0),"nearest_acg":z['stats'].get('nearest_acg','')} for z in zones[:limit]]}

def _claims_data(conn, args):
    year = args.get('year','2022')
    liab = conn.execute("SELECT * FROM cdi_liability_claims WHERE year=? AND program='ALL' AND coverage='ALL'",[year]).fetchone()
    phys = conn.execute("SELECT * FROM cdi_physical_damage_claims WHERE year=? AND program='ALL' AND coverage='ALL'",[year]).fetchone()
    ccr = conn.execute("SELECT COUNT(*) as n FROM crashes WHERE crash_date>='2025-01-01' AND crash_date<'2026-01-01'").fetchone()
    tc = (liab['num_claims'] if liab else 0)+(phys['num_claims'] if phys else 0)
    return {"cdi_year":year,"total_claims":tc,"police_reported":ccr['n'],"claims_per_crash":round(tc/max(ccr['n'],1),1),"liability":dict(liab) if liab else None,"physical_damage":dict(phys) if phys else None}

def _search_crashes(conn, args):
    q = args.get('query',''); year = args.get('year','2025')
    rows = conn.execute("SELECT c.city_name,c.primary_road,COUNT(*) as crashes,COALESCE(SUM(c.number_injured),0) as injured FROM crashes c WHERE c.crash_date>=? AND c.crash_date<? AND (c.city_name LIKE ? OR c.primary_road LIKE ?) GROUP BY c.city_name,c.primary_road ORDER BY crashes DESC LIMIT 15",[f'{year}-01-01',f'{int(year)+1}-01-01',f'%{q}%',f'%{q}%']).fetchall()
    return [dict(r) for r in rows]

def _acg_locations(conn, args):
    year = args.get('year','2025')
    locs = [
        {'name':'Whittier HQ','city':'Whittier','address':'12426 Lambert Rd., Whittier, CA 90606','phone':'562-317-1400'},
        {'name':'Los Angeles','city':'Los Angeles','address':'Los Angeles, CA 90001','phone':'833-333-4224'},
        {'name':'Gardena — Rosecrans','city':'Gardena','address':'1706 W Rosecrans Ave., Gardena, CA 90249','phone':'424-360-0700'},
        {'name':'Gardena — Vermont','city':'Gardena','address':'Gardena, CA 90247','phone':'833-333-4224'},
        {'name':'Santa Ana','city':'Santa Ana','address':'Santa Ana, CA 92701','phone':'833-333-4224'},
        {'name':'Covina','city':'Covina','address':'Covina, CA 91722','phone':'833-333-4224'},
        {'name':'Ontario','city':'Ontario','address':'Ontario, CA 91761','phone':'833-333-4224'},
        {'name':'Rancho Cucamonga','city':'Rancho Cucamonga','address':'Rancho Cucamonga, CA 91730','phone':'833-333-4224'},
        {'name':'Victorville','city':'Victorville','address':'Victorville, CA 92392','phone':'833-333-4224'},
        {'name':'Fresno','city':'Fresno','address':'Fresno, CA 93711','phone':'833-333-4224'},
        {'name':'Bakersfield — Ming','city':'Bakersfield','address':'Ming Ave, Bakersfield, CA 93301','phone':'833-333-4224'},
        {'name':'Bakersfield — McCutchen','city':'Bakersfield','address':'6916 McCutchen Rd., Bakersfield, CA 93309','phone':'661-460-1400'},
        {'name':'El Cajon','city':'El Cajon','address':'El Cajon, CA 92020','phone':'833-333-4224'},
    ]
    for l in locs:
        c=conn.execute("SELECT data FROM acg_location_cache WHERE year=? AND name=?",[year,l['name']]).fetchone()
        if c:
            d=json.loads(c[0]); l['total_crashes']=d.get('total_crashes',0); l['total_injured']=d.get('total_injured',0)
    return locs

def _forecast(conn):
    rows = conn.execute("SELECT * FROM daily_forecasts ORDER BY date,risk_score DESC").fetchall()
    current = conn.execute("SELECT location_name,temp_c,weather_icon,weather_label,wind_speed_kmh,humidity_pct FROM weather_current ORDER BY fetched_at DESC LIMIT 10").fetchall()
    by_date = {}
    for r in rows:
        d=r['date']
        if d not in by_date: by_date[d]=[]
        by_date[d].append(dict(r))
    forecast = []
    for ds in sorted(by_date.keys())[:7]:
        zones=by_date[ds]; ms=max(z['risk_score'] for z in zones)
        forecast.append({"date":ds,"zones":len(zones),"max_risk":ms,"weather":zones[0]['weather_label'],"icon":zones[0]['weather_icon']})
    return {"current":[dict(c) for c in current],"forecast":forecast}

# ── MCP HTTP Endpoints ───────────────────────────────────────────────────

@app.route('/mcp/health')
def health():
    return jsonify({"status":"ok","server":"acg-crash-intel","tools":len(TOOLS)})

@app.route('/mcp/sse', methods=['GET', 'POST', 'OPTIONS'])
def sse():
    """SSE endpoint — handles BOTH SSE connect + POST messages (stateless)"""
    if request.method == 'POST':
        # Streamable HTTP: handle JSON-RPC via POST with SSE response
        msg = request.get_json(force=True)
        msg_id = msg.get('id', 0)

        def generate_responses():
            if msg.get('method') == 'initialize':
                resp = {
                    "jsonrpc": "2.0", "id": msg_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "acg-crash-intel", "version": "1.0.0"}
                    }
                }
                yield f"data: {json.dumps(resp)}\n\n"

            elif msg.get('method') == 'tools/list':
                resp = {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}
                yield f"data: {json.dumps(resp)}\n\n"

            elif msg.get('method') == 'tools/call':
                name = msg['params']['name']
                args = msg['params'].get('arguments', {})
                try:
                    result = execute_tool(name, args)
                    resp = {
                        "jsonrpc": "2.0", "id": msg_id,
                        "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]}
                    }
                except Exception as e:
                    resp = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32603, "message": str(e)}}
                yield f"data: {json.dumps(resp)}\n\n"

            elif msg.get('method') == 'notifications/initialized':
                yield f"data: {json.dumps({'jsonrpc':'2.0','id':msg_id,'result':{}})}\n\n"

            else:
                yield f"data: {json.dumps({'jsonrpc':'2.0','id':msg_id,'error':{'code':-32601,'message':'Method not found'}})}\n\n"

        resp = Response(generate_responses(), mimetype='text/event-stream')
        resp.headers['Cache-Control'] = 'no-cache'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept'
        return resp

    # GET: Standard SSE connection
    def generate():
        yield f"event: endpoint\ndata: /mcp/sse\n\n"
        import time
        while True:
            yield ": heartbeat\n\n"
            time.sleep(15)

    response = Response(generate(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Connection'] = 'keep-alive'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@app.route('/mcp/messages', methods=['POST', 'OPTIONS'])
def messages():
    """Legacy message endpoint — redirects to /mcp/sse"""
    if request.method == 'OPTIONS':
        resp = jsonify({})
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept'
        return resp
    return sse()

if __name__ == '__main__':
    port = int(sys.argv[2]) if '--port' in sys.argv else 5053
    print(f"🚀 ACG Crash Intel MCP HTTP Server on port {port}")
    print(f"   SSE: http://localhost:{port}/mcp/sse")
    print(f"   Health: http://localhost:{port}/mcp/health")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
