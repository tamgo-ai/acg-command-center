/**
 * Local dev database — SQLite mirror of Supabase schema.
 * Permite probar todo el pipeline sin necesidad de la password de Supabase.
 * Cuando la DB de Supabase esté lista, cambiar DB_MODE=supabase en .env
 */
import Database from 'better-sqlite3';
import { resolve } from 'path';

const DB_PATH = resolve(__dirname, '..', 'dev.db');

let db: Database.Database;

export function getLocalDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Crear schema localmente
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      location_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      phone_main TEXT,
      timezone TEXT DEFAULT 'America/Los_Angeles',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS number_registry (
      twilio_number TEXT PRIMARY KEY,
      location_id TEXT NOT NULL REFERENCES locations(location_id),
      channel TEXT NOT NULL,
      display_name TEXT,
      active INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calls (
      call_sid TEXT PRIMARY KEY,
      to_number TEXT,
      from_number TEXT,
      direction TEXT,
      duration_sec INTEGER,
      status TEXT,
      recording_url TEXT,
      transcript TEXT,
      occurred_at TEXT,
      ingested_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      message_sid TEXT PRIMARY KEY,
      to_number TEXT,
      from_number TEXT,
      direction TEXT,
      body TEXT,
      num_segments INTEGER,
      status TEXT,
      occurred_at TEXT,
      ingested_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS appointments (
      appointment_id TEXT PRIMARY KEY,
      customer_phone TEXT,
      customer_name TEXT,
      location_id TEXT,
      source TEXT,
      scheduled_at TEXT,
      arrived INTEGER DEFAULT 0,
      no_show INTEGER DEFAULT 0,
      drop_off INTEGER DEFAULT 0,
      drop_off_at TEXT,
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_year INTEGER,
      estimated_value REAL,
      raw_data TEXT,
      ingested_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_journey (
      journey_id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT NOT NULL,
      normalized_phone TEXT,
      attributed_channel TEXT,
      attributed_location TEXT,
      first_touch_at TEXT,
      last_touch_at TEXT,
      appointment_id TEXT REFERENCES appointments(appointment_id),
      drop_off INTEGER DEFAULT 0,
      drop_off_at TEXT,
      attribution_method TEXT DEFAULT 'pending',
      confidence REAL DEFAULT 0,
      touchpoints TEXT,
      lookback_days INTEGER DEFAULT 90,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT DEFAULT (datetime('now')),
      agent TEXT NOT NULL,
      type TEXT,
      location_id TEXT,
      channel TEXT,
      severity TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      supporting_data TEXT,
      confidence REAL DEFAULT 0,
      status TEXT DEFAULT 'new',
      actioned_at TEXT,
      actioned_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingestion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      records_fetched INTEGER DEFAULT 0,
      records_new INTEGER DEFAULT 0,
      records_errors INTEGER DEFAULT 0,
      error_message TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS metric_cache (
      metric_name TEXT NOT NULL,
      location_id TEXT,
      channel TEXT,
      period_start TEXT,
      period_end TEXT,
      metric_value REAL,
      numerator REAL,
      denominator REAL,
      supporting_data TEXT,
      computed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (metric_name, location_id, channel, period_start, period_end)
    );

    CREATE TABLE IF NOT EXISTS ad_spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      location_id TEXT REFERENCES locations(location_id),
      campaign_id TEXT,
      campaign_name TEXT,
      ad_set_name TEXT,
      date TEXT NOT NULL,
      spend REAL DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      calls_reported INTEGER DEFAULT 0,
      raw_data TEXT,
      ingested_at TEXT DEFAULT (datetime('now')),
      UNIQUE(channel, campaign_id, location_id, date)
    );
  `);

  return db;
}

export function closeLocalDb() {
  if (db) db.close();
}
