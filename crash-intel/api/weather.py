#!/usr/bin/env python3
"""
Crash Weather Intelligence Engine v2
Open-Meteo (free) → Current + Forecast + Crash correlation → Risk scores
"""

import sqlite3
import json
import math
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import defaultdict

PACIFIC_TZ = timezone(timedelta(hours=-7))
DB_PATH = Path(__file__).parent.parent / "data" / "crash_intel.db"

# ── WMO Weather Codes → Icons & Labels ─────────────────────────────────

WMO_CODES = {
    0:  {"label": "Clear Sky",          "icon": "☀️", "category": "clear"},
    1:  {"label": "Mainly Clear",       "icon": "🌤️", "category": "clear"},
    2:  {"label": "Partly Cloudy",      "icon": "⛅",  "category": "cloudy"},
    3:  {"label": "Overcast",           "icon": "☁️", "category": "cloudy"},
    45: {"label": "Fog",                "icon": "🌫️", "category": "fog"},
    48: {"label": "Depositing Rime Fog","icon": "🌫️", "category": "fog"},
    51: {"label": "Light Drizzle",      "icon": "🌦️", "category": "rain"},
    53: {"label": "Moderate Drizzle",   "icon": "🌦️", "category": "rain"},
    55: {"label": "Dense Drizzle",      "icon": "🌧️", "category": "rain"},
    56: {"label": "Freezing Drizzle",   "icon": "🌧️", "category": "rain"},
    57: {"label": "Dense Freezing Drizzle","icon": "🌧️", "category": "rain"},
    61: {"label": "Slight Rain",        "icon": "🌦️", "category": "rain"},
    63: {"label": "Moderate Rain",      "icon": "🌧️", "category": "rain"},
    65: {"label": "Heavy Rain",         "icon": "🌧️", "category": "heavy_rain"},
    66: {"label": "Freezing Rain",      "icon": "🌧️", "category": "rain"},
    67: {"label": "Heavy Freezing Rain","icon": "🌧️", "category": "heavy_rain"},
    71: {"label": "Slight Snow",        "icon": "🌨️", "category": "snow"},
    73: {"label": "Moderate Snow",      "icon": "🌨️", "category": "snow"},
    75: {"label": "Heavy Snow",         "icon": "❄️", "category": "snow"},
    77: {"label": "Snow Grains",        "icon": "❄️", "category": "snow"},
    80: {"label": "Rain Showers",       "icon": "🌦️", "category": "rain"},
    81: {"label": "Moderate Showers",   "icon": "🌧️", "category": "rain"},
    82: {"label": "Violent Showers",    "icon": "⛈️", "category": "heavy_rain"},
    85: {"label": "Snow Showers",       "icon": "🌨️", "category": "snow"},
    86: {"label": "Heavy Snow Showers", "icon": "❄️", "category": "snow"},
    95: {"label": "Thunderstorm",       "icon": "⛈️", "category": "storm"},
    96: {"label": "Thunderstorm + Hail","icon": "⛈️", "category": "storm"},
    99: {"label": "Thunderstorm + Heavy Hail","icon": "⛈️", "category": "storm"},
}

# ── Corridors & Locations ──────────────────────────────────────────────

LOCATIONS = [
    {"name": "Los Angeles",        "lat": 34.05, "lon": -118.25},
    {"name": "Whittier",           "lat": 33.98, "lon": -118.03},
    {"name": "Fresno",             "lat": 36.74, "lon": -119.79},
    {"name": "Ontario",            "lat": 34.06, "lon": -117.65},
    {"name": "Santa Ana",          "lat": 33.75, "lon": -117.87},
    {"name": "Victorville",        "lat": 34.54, "lon": -117.29},
    {"name": "Bakersfield",        "lat": 35.37, "lon": -119.02},
    {"name": "El Cajon",           "lat": 32.79, "lon": -116.96},
    {"name": "Covina",             "lat": 34.09, "lon": -117.89},
    {"name": "Rancho Cucamonga",   "lat": 34.11, "lon": -117.59},
]

TOP_CORRIDORS = [
    {"name": "I-10 × Baldwin Park Blvd", "lat": 34.07, "lon": -117.98, "city": "Baldwin Park"},
    {"name": "I-405 × Burbank Blvd",     "lat": 34.18, "lon": -118.46, "city": "Van Nuys"},
    {"name": "US-101 × Van Nuys Blvd",   "lat": 34.18, "lon": -118.45, "city": "Van Nuys"},
    {"name": "I-5 × SR-22",              "lat": 33.88, "lon": -117.90, "city": "Santa Ana"},
    {"name": "SR-60 × Grand Ave",        "lat": 34.01, "lon": -117.82, "city": "Diamond Bar"},
    {"name": "US-101 × Sepulveda Blvd",  "lat": 34.17, "lon": -118.53, "city": "Sherman Oaks"},
    {"name": "I-210 × Irwindale Ave",    "lat": 34.13, "lon": -117.93, "city": "Irwindale"},
    {"name": "I-15 × SR-138",            "lat": 34.32, "lon": -117.48, "city": "Cajon Pass"},
    {"name": "I-80 × Powell St",         "lat": 37.84, "lon": -122.30, "city": "Emeryville"},
    {"name": "I-880 × Stevenson Blvd",   "lat": 37.55, "lon": -121.98, "city": "Fremont"},
]

# Regional centroids for API calls (reduce API hits)
REGIONS = {
    "socal": {"lat": 34.05, "lon": -117.65, "corridors": [
        "I-10 × Baldwin Park Blvd", "I-405 × Burbank Blvd", "US-101 × Van Nuys Blvd",
        "I-5 × SR-22", "SR-60 × Grand Ave", "US-101 × Sepulveda Blvd",
        "I-210 × Irwindale Ave", "I-15 × SR-138"
    ]},
    "norcal": {"lat": 37.70, "lon": -122.15, "corridors": [
        "I-80 × Powell St", "I-880 × Stevenson Blvd"
    ]},
}

# ── DB ─────────────────────────────────────────────────────────────────

def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_tables():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS weather_current (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_name TEXT NOT NULL,
            lat REAL, lon REAL,
            fetched_at TEXT NOT NULL,
            temp_c REAL,
            feels_like_c REAL,
            humidity_pct INTEGER,
            wind_speed_kmh REAL,
            wind_gusts_kmh REAL,
            wind_direction INTEGER,
            weather_code INTEGER,
            weather_icon TEXT,
            weather_label TEXT,
            precipitation_mm REAL,
            cloud_cover_pct INTEGER,
            visibility_m INTEGER,
            is_day INTEGER DEFAULT 1,
            uv_index REAL,
            raw_json TEXT
        );

        CREATE TABLE IF NOT EXISTS weather_daily (
            location_name TEXT NOT NULL,
            lat REAL, lon REAL,
            date TEXT NOT NULL,
            temp_max REAL, temp_min REAL, temp_avg REAL,
            precipitation_mm REAL,
            rain_mm REAL, snowfall_cm REAL,
            wind_speed_max REAL,
            weather_code INTEGER, weather_desc TEXT, weather_icon TEXT,
            is_rain INTEGER DEFAULT 0,
            is_heavy_rain INTEGER DEFAULT 0,
            is_fog INTEGER DEFAULT 0,
            is_storm INTEGER DEFAULT 0,
            PRIMARY KEY (location_name, date)
        );

        CREATE TABLE IF NOT EXISTS corridor_crash_baseline (
            corridor_name TEXT PRIMARY KEY,
            avg_crashes_per_day REAL,
            avg_crashes_weekday REAL,
            avg_crashes_weekend REAL,
            avg_crashes_rain REAL,
            avg_crashes_heavy_rain REAL,
            avg_crashes_fog REAL,
            avg_crashes_storm REAL,
            peak_hour INTEGER,
            peak_day TEXT,
            total_crashes_3yr INTEGER,
            sample_days INTEGER,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS daily_forecasts (
            date TEXT NOT NULL,
            corridor_name TEXT NOT NULL,
            weather_code INTEGER,
            weather_icon TEXT,
            weather_label TEXT,
            precipitation_mm REAL,
            temp_max REAL,
            wind_speed_max REAL,
            humidity_pct INTEGER,
            risk_level TEXT,
            risk_score INTEGER,
            expected_crashes REAL,
            baseline_crashes REAL,
            weather_factor REAL,
            recommendation TEXT,
            revenue_opportunity TEXT,
            PRIMARY KEY (date, corridor_name)
        );
    """)
    conn.commit()
    conn.close()

# ── Open-Meteo API ─────────────────────────────────────────────────────

def _api_call(url, timeout=15):
    """Call Open-Meteo with retries."""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ACG-CrashIntel/3.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if attempt < 2:
                time.sleep(1.5)
            else:
                print(f"  API error: {e}")
                return None

def fetch_current_weather(lat, lon):
    """Live current conditions from Open-Meteo."""
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,relative_humidity_2m,apparent_temperature"
        f",weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m"
        f",precipitation,cloud_cover,is_day"
        f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
        f",wind_speed_10m_max,weather_code"
        f"&timezone=America/Los_Angeles&forecast_days=7"
    )
    return _api_call(url, timeout=15)

def fetch_forecast_daily(lat, lon):
    """7-day forecast from Open-Meteo."""
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
        f",rain_sum,wind_speed_10m_max,weather_code,relative_humidity_2m_max"
        f"&timezone=America/Los_Angeles&forecast_days=7"
    )
    return _api_call(url, timeout=15)

def fetch_weather_history(lat, lon, start_date, end_date):
    """Historical weather from Open-Meteo Archive."""
    url = (
        f"https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean"
        f",precipitation_sum,rain_sum,snowfall_sum,wind_speed_10m_max"
        f",weather_code"
        f"&timezone=America/Los_Angeles"
    )
    return _api_call(url, timeout=30)

# ── Risk Engine ────────────────────────────────────────────────────────

def weather_danger_score(code, precip_mm, wind_kmh, humidity_pct):
    """
    Calculate weather danger score (0-100).
    Based on actual crash risk amplification, NOT just crash volume.

    Rain doubles crash risk per mile driven (NHTSA data).
    Wet roads = 2x risk, heavy rain = 4x, fog = 2x, storm = 5x.
    """
    score = 0

    # Precipitation factor (0-45 points)
    if precip_mm and precip_mm > 0:
        if precip_mm < 2:
            score += 15   # Light rain: elevated risk
        elif precip_mm < 5:
            score += 25   # Moderate rain
        elif precip_mm < 10:
            score += 35   # Heavy rain
        else:
            score += 45   # Extreme rain

    # Weather code factor (0-35 points)
    category = WMO_CODES.get(code, {}).get("category", "clear")
    if category == "fog":
        score += 20   # Fog severely reduces visibility
    elif category == "storm":
        score += 35   # Thunderstorms = max danger
    elif category == "heavy_rain":
        score += 25
    elif category == "rain":
        score += 10
    elif category == "snow":
        score += 30

    # Wind factor (0-15 points)
    if wind_kmh:
        if wind_kmh > 50:
            score += 15
        elif wind_kmh > 30:
            score += 8
        elif wind_kmh > 20:
            score += 3

    # Humidity / low visibility (0-5 points)
    if humidity_pct and humidity_pct > 90:
        score += 5

    return min(100, score)


def calculate_risk(weather_code, precip_mm, wind_kmh, humidity_pct, baseline_crashes):
    """
    Calculate crash risk for a corridor given weather forecast.

    Returns:
        weather_factor: multiplier applied to baseline (≥ 1.0)
        risk_score: 0-100 composite score
        risk_level: LOW | MODERATE | HIGH | EXTREME
        expected_crashes: projected crash count
        recommendation: action to take
    """
    danger = weather_danger_score(weather_code, precip_mm, wind_kmh, humidity_pct)

    # Weather factor: convert danger score to crash multiplier
    # danger 0-20  → factor 1.0 (normal)
    # danger 20-40 → factor 1.0-1.3 (elevated)
    # danger 40-60 → factor 1.3-1.8 (high)
    # danger 60-80 → factor 1.8-2.5 (very high)
    # danger 80-100→ factor 2.5-3.5 (extreme)

    if danger <= 15:
        weather_factor = 1.0
    elif danger <= 30:
        weather_factor = 1.0 + (danger - 15) / 15 * 0.3  # 1.0-1.3
    elif danger <= 50:
        weather_factor = 1.3 + (danger - 30) / 20 * 0.5  # 1.3-1.8
    elif danger <= 70:
        weather_factor = 1.8 + (danger - 50) / 20 * 0.7  # 1.8-2.5
    else:
        weather_factor = 2.5 + (danger - 70) / 30 * 1.0  # 2.5-3.5

    weather_factor = round(weather_factor, 2)

    # Risk score = weather danger * day factor
    # This represents actual crash risk, not just volume
    risk_score = min(100, round(danger))

    # Risk level
    if risk_score >= 70:
        risk_level = "EXTREME"
    elif risk_score >= 45:
        risk_level = "HIGH"
    elif risk_score >= 25:
        risk_level = "MODERATE"
    else:
        risk_level = "LOW"

    # Expected crashes
    expected = round(baseline_crashes * weather_factor, 1)
    extra = expected - baseline_crashes

    # Recommendation
    if risk_level == "EXTREME":
        recommendation = f"🚨 HIGH IMPACT: {extra:.0f} extra crashes expected. Activate ALL geo-fence ads + Waze + Instagram."
        revenue = f"Est. revenue opportunity: ${extra * 350:,.0f}+ (body shop)"
    elif risk_level == "HIGH":
        recommendation = f"📢 Boost ad spend. {extra:.0f} extra crashes predicted. Activate Meta geo-fence + Waze Local."
        revenue = f"Est. revenue opportunity: ${extra * 250:,.0f}+"
    elif risk_level == "MODERATE":
        recommendation = f"👀 Monitor. Consider light Waze Local campaign."
        revenue = f"Est. revenue opportunity: ${extra * 150:,.0f}+"
    else:
        recommendation = "✅ Normal conditions. No action needed."
        revenue = "Baseline operations."

    return {
        "weather_factor": weather_factor,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "expected_crashes": expected,
        "baseline_crashes": baseline_crashes,
        "weather_danger": danger,
        "recommendation": recommendation,
        "revenue_opportunity": revenue,
    }


# ── Baseline calculator ────────────────────────────────────────────────

def build_crash_baselines(conn=None):
    """Calculate per-corridor crash baselines from 3 years of data."""
    close_conn = False
    if conn is None:
        conn = get_conn()
        close_conn = True

    print("[Weather] Building crash baselines...")

    for corr in TOP_CORRIDORS:
        lat, lon = corr["lat"], corr["lon"]
        radius = 2.0 / 69.0  # 2 miles
        lon_radius = radius / abs(math.cos(math.radians(lat)))

        # Total crashes in radius (3 years)
        total = conn.execute("""
            SELECT COUNT(*) FROM crashes
            WHERE crash_date >= '2023-01-01' AND crash_date < '2026-01-01'
            AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
            AND latitude IS NOT NULL
        """, [lat - radius, lat + radius, lon - lon_radius, lon + lon_radius]).fetchone()[0]

        # By day of week
        dow_rows = conn.execute("""
            SELECT day_of_week, COUNT(*) as n FROM crashes
            WHERE crash_date >= '2023-01-01' AND crash_date < '2026-01-01'
            AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
            AND latitude IS NOT NULL AND day_of_week IS NOT NULL
            GROUP BY day_of_week ORDER BY n DESC
        """, [lat - radius, lat + radius, lon - lon_radius, lon + lon_radius]).fetchall()

        # By hour
        hour_rows = conn.execute("""
            SELECT CAST(SUBSTR(crash_time,1,2) AS INTEGER) as hour, COUNT(*) as n FROM crashes
            WHERE crash_date >= '2023-01-01' AND crash_date < '2026-01-01'
            AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
            AND latitude IS NOT NULL AND crash_time IS NOT NULL
            GROUP BY hour ORDER BY n DESC LIMIT 1
        """, [lat - radius, lat + radius, lon - lon_radius, lon + lon_radius]).fetchone()

        # By weather (using joined weather_daily data)
        rain_total = conn.execute("""
            SELECT COUNT(*) FROM crashes c
            JOIN weather_daily w ON c.crash_date LIKE w.date || '%' AND w.location_name = 'Los Angeles'
            WHERE c.crash_date >= '2023-01-01' AND c.crash_date < '2026-01-01'
            AND c.latitude BETWEEN ? AND ? AND c.longitude BETWEEN ? AND ?
            AND c.latitude IS NOT NULL AND w.is_rain = 1
        """, [lat - radius, lat + radius, lon - lon_radius, lon + lon_radius]).fetchone()[0]

        heavy_rain_total = conn.execute("""
            SELECT COUNT(*) FROM crashes c
            JOIN weather_daily w ON c.crash_date LIKE w.date || '%' AND w.location_name = 'Los Angeles'
            WHERE c.crash_date >= '2023-01-01' AND c.crash_date < '2026-01-01'
            AND c.latitude BETWEEN ? AND ? AND c.longitude BETWEEN ? AND ?
            AND c.latitude IS NOT NULL AND w.is_heavy_rain = 1
        """, [lat - radius, lat + radius, lon - lon_radius, lon + lon_radius]).fetchone()[0]

        # Rain days count
        rain_days = conn.execute("""
            SELECT COUNT(*) FROM weather_daily
            WHERE date >= '2023-01-01' AND date < '2026-01-01'
            AND location_name = 'Los Angeles' AND is_rain = 1
        """).fetchone()[0]

        heavy_rain_days = conn.execute("""
            SELECT COUNT(*) FROM weather_daily
            WHERE date >= '2023-01-01' AND date < '2026-01-01'
            AND location_name = 'Los Angeles' AND is_heavy_rain = 1
        """).fetchone()[0]

        total_days = 365 * 3  # 3 years

        avg_per_day = round(total / total_days, 2)
        avg_weekday = round(total * 0.78 / (total_days * 5/7), 2)  # ~78% crashes on weekdays
        avg_weekend = round(total * 0.22 / (total_days * 2/7), 2)
        avg_rain = round(rain_total / max(rain_days, 1), 2)
        avg_heavy_rain = round(heavy_rain_total / max(heavy_rain_days, 1), 2)

        peak_day = dow_rows[0]["day_of_week"] if dow_rows else "Friday"
        peak_hour = hour_rows["hour"] if hour_rows else 17

        conn.execute("""
            INSERT OR REPLACE INTO corridor_crash_baseline
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, [
            corr["name"], avg_per_day, avg_weekday, avg_weekend,
            avg_rain, avg_heavy_rain, avg_per_day, avg_per_day,  # fog/storm use same baseline
            peak_hour, peak_day, total, total_days
        ])

    conn.commit()
    if close_conn:
        conn.close()
    print("[Weather] Baselines built.")


# ── Current Conditions ─────────────────────────────────────────────────

def refresh_current_conditions():
    """Fetch and store current weather for all regions."""
    init_tables()
    conn = get_conn()
    now = datetime.now(PACIFIC_TZ).isoformat()

    print("[Weather] Refreshing current conditions...")

    # Fetch per region (2 API calls instead of 10)
    for region_name, region in REGIONS.items():
        data = fetch_current_weather(region["lat"], region["lon"])
        if not data or "current" not in data:
            continue

        cur = data["current"]
        code = cur.get("weather_code", 0)
        wmo = WMO_CODES.get(code, {"label": f"Code {code}", "icon": "🌡️", "category": "clear"})

        for corr_name in region["corridors"]:
            corr = next((c for c in TOP_CORRIDORS if c["name"] == corr_name), None)
            if not corr:
                continue

            conn.execute("""
                INSERT INTO weather_current
                (location_name, lat, lon, fetched_at, temp_c, feels_like_c,
                 humidity_pct, wind_speed_kmh, wind_gusts_kmh, wind_direction,
                 weather_code, weather_icon, weather_label, precipitation_mm,
                 cloud_cover_pct, visibility_m, is_day, uv_index, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                corr_name, corr["lat"], corr["lon"], now,
                cur.get("temperature_2m"),
                cur.get("apparent_temperature"),
                cur.get("relative_humidity_2m"),
                cur.get("wind_speed_10m"),
                cur.get("wind_gusts_10m"),
                cur.get("wind_direction_10m"),
                code, wmo["icon"], wmo["label"],
                cur.get("precipitation", 0),
                cur.get("cloud_cover", 0),
                None,  # visibility not in free API
                cur.get("is_day", 1),
                None,  # UV not in free tier
                json.dumps(cur)
            ])

    conn.commit()

    # Also store daily forecast data from the same API response
    # (we'll generate full forecast separately, but capture daily here)

    conn.close()
    print("[Weather] Current conditions refreshed.")


def get_current_conditions():
    """Get latest current conditions for all corridors."""
    conn = get_conn()

    # Get most recent fetch
    latest = conn.execute(
        "SELECT MAX(fetched_at) FROM weather_current"
    ).fetchone()[0]

    if not latest:
        conn.close()
        return {"conditions": [], "fetched_at": None, "stale": True}

    rows = conn.execute("""
        SELECT location_name, lat, lon, fetched_at, temp_c, feels_like_c,
               humidity_pct, wind_speed_kmh, wind_gusts_kmh, wind_direction,
               weather_code, weather_icon, weather_label, precipitation_mm,
               cloud_cover_pct, is_day, uv_index
        FROM weather_current
        WHERE fetched_at = ?
        ORDER BY location_name
    """, [latest]).fetchall()

    # Check staleness (> 3 hours)
    fetched_dt = datetime.fromisoformat(latest)
    if fetched_dt.tzinfo is None:
        fetched_dt = fetched_dt.replace(tzinfo=PACIFIC_TZ)
    age_hours = (datetime.now(timezone.utc) - fetched_dt.astimezone(timezone.utc)).total_seconds() / 3600
    stale = age_hours > 3

    conditions = []
    for r in rows:
        conditions.append({
            "corridor": r["location_name"],
            "lat": r["lat"],
            "lon": r["lon"],
            "temp_c": r["temp_c"],
            "feels_like_c": r["feels_like_c"],
            "humidity_pct": r["humidity_pct"],
            "wind_speed_kmh": r["wind_speed_kmh"],
            "wind_gusts_kmh": r["wind_gusts_kmh"],
            "wind_direction": r["wind_direction"],
            "weather_code": r["weather_code"],
            "weather_icon": r["weather_icon"],
            "weather_label": r["weather_label"],
            "precipitation_mm": r["precipitation_mm"],
            "cloud_cover_pct": r["cloud_cover_pct"],
            "is_day": bool(r["is_day"]),
        })

    conn.close()
    return {
        "conditions": conditions,
        "fetched_at": latest,
        "stale": stale,
        "age_hours": round(age_hours, 1),
    }


# ── Forecast Generator ─────────────────────────────────────────────────

def generate_forecast():
    """Generate 7-day crash forecast for all corridors."""
    init_tables()
    conn = get_conn()

    # Ensure baselines exist
    existing = conn.execute("SELECT COUNT(*) FROM corridor_crash_baseline").fetchone()[0]
    if existing < len(TOP_CORRIDORS):
        build_crash_baselines(conn)

    print("[Weather] Generating 7-day forecast...")

    for region_name, region in REGIONS.items():
        forecast_data = fetch_forecast_daily(region["lat"], region["lon"])
        if not forecast_data or "daily" not in forecast_data:
            print(f"  {region_name}: forecast API failed")
            continue

        daily = forecast_data["daily"]

        for i, date_str in enumerate(daily["time"]):
            code = daily["weather_code"][i] or 0
            precip = daily["precipitation_sum"][i] or 0
            temp_max = daily["temperature_2m_max"][i]
            wind = daily["wind_speed_10m_max"][i] or 0
            humidity = daily.get("relative_humidity_2m_max", [None])[i]
            wmo = WMO_CODES.get(code, {"label": f"Code {code}", "icon": "🌡️", "category": "clear"})

            for corr_name in region["corridors"]:
                corr = next((c for c in TOP_CORRIDORS if c["name"] == corr_name), None)
                if not corr:
                    continue

                # Get baseline for this corridor
                baseline = conn.execute(
                    "SELECT avg_crashes_per_day, peak_day FROM corridor_crash_baseline WHERE corridor_name = ?",
                    [corr_name]
                ).fetchone()

                if not baseline:
                    baseline_crashes = 3.0
                    peak_day = "Friday"
                else:
                    # Use weekday/weekend baseline based on day of week
                    dt = datetime.strptime(date_str, "%Y-%m-%d")
                    is_weekend = dt.weekday() >= 5
                    base_row = baseline
                    baseline_crashes = base_row["avg_crashes_per_day"] or 3.0
                    peak_day = base_row["peak_day"] or "Friday"

                # Apply risk model
                risk = calculate_risk(code, precip, wind, humidity, baseline_crashes)

                conn.execute("""
                    INSERT OR REPLACE INTO daily_forecasts
                    (date, corridor_name, weather_code, weather_icon, weather_label,
                     precipitation_mm, temp_max, wind_speed_max, humidity_pct,
                     risk_level, risk_score, expected_crashes, baseline_crashes,
                     weather_factor, recommendation, revenue_opportunity)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    date_str, corr_name, code, wmo["icon"], wmo["label"],
                    precip, temp_max, wind, humidity,
                    risk["risk_level"], risk["risk_score"], risk["expected_crashes"],
                    baseline_crashes, risk["weather_factor"],
                    risk["recommendation"], risk["revenue_opportunity"],
                ])

    conn.commit()
    conn.close()
    print("[Weather] Forecast generated.")


# ── Forecast API helper ────────────────────────────────────────────────

def get_forecast_data():
    """Get complete forecast data for the API response."""
    conn = get_conn()

    forecast_rows = conn.execute("""
        SELECT * FROM daily_forecasts ORDER BY date, risk_score DESC
    """).fetchall()

    if not forecast_rows:
        conn.close()
        return None

    # Group by date
    by_date = defaultdict(list)
    for r in forecast_rows:
        by_date[r["date"]].append({
            "corridor_name": r["corridor_name"],
            "weather_code": r["weather_code"],
            "weather_icon": r["weather_icon"],
            "weather_label": r["weather_label"],
            "precipitation_mm": r["precipitation_mm"],
            "temp_max": r["temp_max"],
            "wind_speed_max": r["wind_speed_max"],
            "humidity_pct": r["humidity_pct"],
            "risk_level": r["risk_level"],
            "risk_score": r["risk_score"],
            "expected_crashes": r["expected_crashes"],
            "baseline_crashes": r["baseline_crashes"],
            "weather_factor": r["weather_factor"],
            "recommendation": r["recommendation"],
            "revenue_opportunity": r["revenue_opportunity"],
        })

    daily = []
    for date_str in sorted(by_date.keys()):
        zones = by_date[date_str]
        high_risk = [z for z in zones if z["risk_level"] in ("HIGH", "EXTREME")]
        max_score = max(z["risk_score"] for z in zones)
        worst_zone = max(zones, key=lambda z: z["risk_score"])

        # Day summary
        if max_score >= 70:
            overall = "EXTREME"
        elif max_score >= 45:
            overall = "HIGH"
        elif max_score >= 25:
            overall = "MODERATE"
        else:
            overall = "LOW"

        daily.append({
            "date": date_str,
            "day_of_week": datetime.strptime(date_str, "%Y-%m-%d").strftime("%A"),
            "zones_count": len(zones),
            "high_risk_count": len(high_risk),
            "max_risk_score": max_score,
            "overall_risk": overall,
            "weather_summary": worst_zone["weather_label"],
            "weather_icon": worst_zone["weather_icon"],
            "avg_temp": round(sum(z["temp_max"] for z in zones if z["temp_max"]) / max(len([z for z in zones if z["temp_max"]]), 1), 1),
            "total_precip": round(sum(z["precipitation_mm"] or 0 for z in zones), 1),
            "top_alerts": [{
                "corridor": z["corridor_name"],
                "risk": z["risk_level"],
                "score": z["risk_score"],
                "rec": z["recommendation"],
                "revenue": z.get("revenue_opportunity", ""),
            } for z in sorted(high_risk, key=lambda z: z["risk_score"], reverse=True)[:5]],
            "zones": sorted(zones, key=lambda z: z["risk_score"], reverse=True),
        })

    # Summary
    total_high = sum(d["high_risk_count"] for d in daily)
    worst_day = max(daily, key=lambda d: d["max_risk_score"]) if daily else None

    conn.close()

    return {
        "daily": daily,
        "current": get_current_conditions(),
        "summary": {
            "days_with_alerts": len([d for d in daily if d["high_risk_count"] > 0]),
            "total_high_risk_zones": total_high,
            "worst_day": worst_day["date"] if worst_day else None,
            "worst_day_risk": worst_day["overall_risk"] if worst_day else "N/A",
            "worst_day_score": worst_day["max_risk_score"] if worst_day else 0,
        },
        "corridors": [{
            "name": c["name"],
            "lat": c["lat"],
            "lon": c["lon"],
            "city": c.get("city", ""),
        } for c in TOP_CORRIDORS],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Full Sync ──────────────────────────────────────────────────────────

def full_sync():
    """Run complete pipeline."""
    init_tables()
    print("[Weather] Full sync starting...")
    refresh_current_conditions()
    build_crash_baselines()
    generate_forecast()
    print("[Weather] Full sync complete.")


if __name__ == "__main__":
    import sys
    if "--forecast-only" in sys.argv:
        init_tables()
        generate_forecast()
    elif "--current-only" in sys.argv:
        refresh_current_conditions()
    elif "--baselines" in sys.argv:
        build_crash_baselines()
    else:
        full_sync()
