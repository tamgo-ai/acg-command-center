#!/usr/bin/env python3
"""
Decodifica códigos de marca de vehículo (VOLV, TOYT, etc.) usando NHTSA VPIC API.
Genera tabla vehicle_make_lookup en la DB.
"""
import sqlite3
import json
import urllib.request
import time
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "crash_intel.db"

# Cache local de marcas comunes (código → nombre)
# Fuente: NHTSA VPIC API + conocimiento de dominio
COMMON_MAKES = {
    "ACUR": "ACURA",
    "ALFA": "ALFA ROMEO",
    "AMGN": "AM GENERAL",
    "ASTO": "ASTON MARTIN",
    "AUDI": "AUDI",
    "BENT": "BENTLEY",
    "BMW": "BMW",
    "BUIC": "BUICK",
    "CADI": "CADILLAC",
    "CHEV": "CHEVROLET",
    "CHRY": "CHRYSLER",
    "DODG": "DODGE",
    "FERR": "FERRARI",
    "FIAT": "FIAT",
    "FORD": "FORD",
    "FRHT": "FREIGHTLINER",
    "GEO": "GEO",
    "GMC": "GMC",
    "HINO": "HINO",
    "HOND": "HONDA",
    "HYUN": "HYUNDAI",
    "INFI": "INFINITI",
    "ISU": "ISUZU",
    "JAGU": "JAGUAR",
    "JEEP": "JEEP",
    "KIA": "KIA",
    "LAMO": "LAMBORGHINI",
    "LNDR": "LAND ROVER",
    "LEXS": "LEXUS",
    "LINC": "LINCOLN",
    "LOTU": "LOTUS",
    "MAZD": "MAZDA",
    "MERZ": "MERCEDES-BENZ",
    "MINI": "MINI",
    "MITS": "MITSUBISHI",
    "NISS": "NISSAN",
    "OLDS": "OLDSMOBILE",
    "PLYM": "PLYMOUTH",
    "PONT": "PONTIAC",
    "PORS": "PORSCHE",
    "PTRB": "PETERBILT",
    "RAM": "RAM",
    "RROV": "RANGE ROVER",
    "SAAB": "SAAB",
    "SATU": "SATURN",
    "SCIO": "SCION",
    "STRN": "SATURN",
    "SUBA": "SUBARU",
    "SUZU": "SUZUKI",
    "TESL": "TESLA",
    "TOYT": "TOYOTA",
    "VOLK": "VOLKSWAGEN",
    "VOLV": "VOLVO",
    "RIVN": "RIVIAN",
    "LUCID": "LUCID",
    "POLS": "POLESTAR",
    "FISK": "FISKER",
    "GENS": "GENESIS",
    "KENW": "KENWORTH",
    "MACK": "MACK",
    "MCI": "MCI",
    "MERZ": "MERCEDES-BENZ",
    "MNNI": "MINI",
    "MTSU": "MITSUBISHI FUSO",
    "NSAN": "NISSAN",
    "PANA": "PANTHER",
    "PREV": "PREVOST",
    "SPRN": "SPARTAN",
    "STRG": "STERLING",
    "SUZI": "SUZUKI",
    "THMS": "THOMAS BUILT",
    "UTIL": "UTILITY",
    "WSTR": "WESTERN STAR",
    "YAMA": "YAMAHA",
    "HARL": "HARLEY-DAVIDSON",
    "HD": "HARLEY-DAVIDSON",
    "KTM": "KTM",
    "KWSK": "KAWASAKI",
    "DUCA": "DUCATI",
    "TRIU": "TRIUMPH",
    "VICT": "VICTORY",
    "INDI": "INDIAN",
    "OBSV": "OBSERVER",
    "UKN": "UNKNOWN",
    "UNK": "UNKNOWN",
}


def get_makes_from_vpic():
    """Fetch all vehicle makes from NHTSA VPIC API for cars + trucks + motorcycles."""
    makes = {}
    vehicle_types = ["car", "truck", "mpv", "motorcycle", "low speed vehicle (lsv)"]

    for vtype in vehicle_types:
        try:
            url = f"https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/{vtype.replace(' ', '%20')}?format=json"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                for r in data.get("Results", []):
                    name = r.get("MakeName", "").upper().strip()
                    if name:
                        # Generate 4-char code (first 4 letters, no vowels if possible)
                        code = name[:4].replace(" ", "")
                        makes[code] = name
        except Exception as e:
            print(f"  ⚠️  VPIC API error for {vtype}: {e}")
        time.sleep(0.5)

    return makes


def main():
    print("🔧 Decodificador de marcas de vehículo")
    print("=" * 50)

    conn = sqlite3.connect(str(DB_PATH))

    # 1. Insert common makes from local cache
    print(f"📋 Insertando {len(COMMON_MAKES)} marcas locales...")
    for code, name in COMMON_MAKES.items():
        conn.execute(
            "INSERT OR REPLACE INTO vehicle_make_lookup (make_code, make_name, source) VALUES (?, ?, 'local')",
            (code, name)
        )
    conn.commit()

    # 2. Try to supplement from VPIC API
    print("🌐 Consultando NHTSA VPIC API...")
    vpic_makes = get_makes_from_vpic()
    print(f"   Recibidos: {len(vpic_makes)} tipos de vehículo")

    for code, name in vpic_makes.items():
        try:
            conn.execute(
                "INSERT OR REPLACE INTO vehicle_make_lookup (make_code, make_name, source) VALUES (?, ?, 'vpic_api')",
                (code, name)
            )
        except Exception:
            pass
    conn.commit()

    # 3. Auto-discover codes from parties data and match
    print("🔍 Buscando códigos no decodificados en la base de datos...")
    unknown = conn.execute("""
        SELECT DISTINCT vehicle_make_code
        FROM parties
        WHERE vehicle_make_code IS NOT NULL
          AND vehicle_make_code != ''
          AND vehicle_make_code NOT IN (SELECT make_code FROM vehicle_make_lookup)
        UNION
        SELECT DISTINCT vehicle2_make_code
        FROM parties
        WHERE vehicle2_make_code IS NOT NULL
          AND vehicle2_make_code != ''
          AND vehicle2_make_code NOT IN (SELECT make_code FROM vehicle_make_lookup)
    """).fetchall()

    if unknown:
        print(f"   {len(unknown)} códigos sin decodificar: {[r[0] for r in unknown[:20]]}")

        # Try to match each unknown code via VPIC API
        for (code,) in unknown:
            if not code or len(code) < 2:
                continue
            try:
                url = f"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/{code}?format=json"
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read())
                    results = data.get("Results", [])
                    if results:
                        name = results[0].get("Make", results[0].get("MakeName", ""))
                        if name:
                            conn.execute(
                                "INSERT OR REPLACE INTO vehicle_make_lookup (make_code, make_name, source) VALUES (?, ?, 'vpic_wmi')",
                                (code, name.upper())
                            )
                            print(f"   ✅ {code} → {name.upper()}")
                time.sleep(0.3)
            except Exception as e:
                pass
        conn.commit()

    # 4. Stats
    total = conn.execute("SELECT COUNT(*) FROM vehicle_make_lookup").fetchone()[0]
    print(f"\n{'=' * 50}")
    print(f"✅ Total marcas en lookup: {total}")

    # Show top makes in crashes
    print("\n🚗 Marcas más comunes en accidentes:")
    top = conn.execute("""
        SELECT UPPER(COALESCE(l.make_name, p.vehicle_make_code)) as make,
               COUNT(*) as n
        FROM parties p
        LEFT JOIN vehicle_make_lookup l ON p.vehicle_make_code = l.make_code
        WHERE p.vehicle_make_code IS NOT NULL AND p.vehicle_make_code != ''
        GROUP BY 1
        ORDER BY n DESC
        LIMIT 15
    """).fetchall()

    for make, n in top:
        bar = "█" * (n * 30 // top[0][1])
        print(f"  {make:25s} {n:>8,}  {bar}")

    conn.close()


if __name__ == "__main__":
    main()
