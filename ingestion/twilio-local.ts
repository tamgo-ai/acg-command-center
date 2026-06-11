/**
 * ACG Command Center — Twilio Ingestion (Local Dev Mode)
 * Jala llamadas y SMS desde Twilio → SQLite local.
 * Producción: usa Supabase. Dev: usa SQLite (sin necesidad de password).
 */
import { Twilio } from 'twilio';
import { getConfig } from '../config';
import { getLocalDb, closeLocalDb } from '../config/local-db';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config();

// ── Phone normalization ──────────────────────────────────────────
// Twilio devuelve (XXX) XXX-XXXX o +1XXXXXXXXXX o client:agent_id
// Nosotros normalizamos todo a E.164 (+1XXXXXXXXXX) para que el JOIN funcione
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || phone.startsWith('agent_') || phone.startsWith('client:')) return null;
  // Quitar todo lo que no sea dígito, excepto el + inicial
  let cleaned = phone.replace(/[^\d+]/g, '');
  // Si empieza con 1 y tiene 11 dígitos → +1XXXXXXXXXX
  if (/^1\d{10}$/.test(cleaned)) return `+${cleaned}`;
  // Si tiene 10 dígitos → +1XXXXXXXXXX
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
  // Si ya es E.164
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;
  return null;
}

interface IngestResult {
  source: string;
  fetched: number;
  inserted: number;
  errors: number;
  error_message?: string;
}

// ── Seed local DB ────────────────────────────────────────────────
function seedLocalDb() {
  const db = getLocalDb();

  // Check if already seeded
  const count = db.prepare('SELECT COUNT(*) as c FROM locations').get() as any;
  if (count.c > 0) {
    console.log(`🌱 DB local ya tiene ${count.c} locations (seed skip)\n`);
    return;
  }

  console.log('🌱 Seedeando DB local...');

  // 13 locations
  const locations = [
    ['whittier', 'ACG Whittier', 'Whittier'],
    ['bakersfield_1', 'ACG Bakersfield #1', 'Bakersfield'],
    ['bakersfield_2', 'ACG Bakersfield #2', 'Bakersfield'],
    ['covina', 'ACG Covina', 'Covina'],
    ['fresno', 'ACG Fresno', 'Fresno'],
    ['gardena_1', 'ACG Gardena #1', 'Gardena'],
    ['gardena_2', 'ACG Gardena #2', 'Gardena'],
    ['ontario', 'ACG Ontario', 'Ontario'],
    ['santa_ana', 'ACG Santa Ana', 'Santa Ana'],
    ['victorville', 'ACG Victorville', 'Victorville'],
    ['los_angeles', 'ACG Los Angeles', 'Los Angeles'],
    ['rancho_cucamonga', 'ACG Rancho Cucamonga', 'Rancho Cucamonga'],
    ['el_cajon', 'ACG El Cajon', 'El Cajon'],
  ];

  const insertLoc = db.prepare(
    'INSERT OR IGNORE INTO locations (location_id, name, city, phone_main) VALUES (?, ?, ?, ?)'
  );
  for (const [id, name, city] of locations) {
    insertLoc.run(id, name, city, '833-333-4224');
  }
  console.log(`   ✅ ${locations.length} locations`);

  // Number registry desde CSV generado
  try {
    const csvPath = resolve(__dirname, '..', 'db', 'number_registry.csv');
    const csv = readFileSync(csvPath, 'utf-8');
    const lines = csv.split('\n').slice(1); // skip header
    const insertNum = db.prepare(
      'INSERT OR IGNORE INTO number_registry (twilio_number, location_id, channel, display_name, notes) VALUES (?, ?, ?, ?, ?)'
    );
    let numCount = 0;
    for (const line of lines) {
      // Simple CSV parse: "phone","location","channel","display","friendly","sid"
      const match = line.match(/"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
      if (match) {
        const [, phone, loc, chan, display, friendly] = match;
        insertNum.run(phone, loc, chan, display, `Auto-mapped from Twilio: ${friendly}`);
        numCount++;
      }
    }
    console.log(`   ✅ ${numCount} números de tracking\n`);
  } catch (err: any) {
    console.log(`   ⚠️  number_registry.csv no encontrado: ${err.message}\n`);
  }
}

// ── Ingest calls ─────────────────────────────────────────────────
async function ingestCalls(client: Twilio, db: ReturnType<typeof getLocalDb>): Promise<IngestResult> {
  const result: IngestResult = { source: 'twilio_calls', fetched: 0, inserted: 0, errors: 0 };

  try {
    // Última fecha ingerida
    const lastLog = db.prepare(
      "SELECT metadata FROM ingestion_log WHERE source = 'twilio_calls' ORDER BY created_at DESC LIMIT 1"
    ).get() as any;

    const lastDate = lastLog?.metadata
      ? new Date(JSON.parse(lastLog.metadata).last_occurred_at)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    console.log(`📞 Twilio Calls: jalando desde ${lastDate.toISOString()}`);

    const calls = await client.calls.list({ startTimeAfter: lastDate, limit: 500 });
    result.fetched = calls.length;
    let lastOccurredAt = lastDate;

    const insertCall = db.prepare(`
      INSERT OR IGNORE INTO calls (call_sid, to_number, from_number, direction, duration_sec, status, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const call of calls) {
        try {
          const occurred = call.startTime?.toISOString() || call.dateCreated?.toISOString();
          const toNum = normalizePhone(call.toFormatted) || normalizePhone(call.to);
          const fromNum = normalizePhone(call.fromFormatted) || normalizePhone(call.from);
          const result = insertCall.run(
            call.sid,
            toNum,
            fromNum,
            call.direction,
            call.duration ? parseInt(call.duration) : null,
            call.status,
            occurred,
          );
          if (result.changes > 0) result.inserted++;

          if (call.startTime && call.startTime > lastOccurredAt) {
            lastOccurredAt = call.startTime;
          }
        } catch (err: any) {
          result.errors++;
        }
      }
    });
    tx();

    // Log ingestion
    db.prepare(`
      INSERT INTO ingestion_log (source, started_at, finished_at, records_fetched, records_new, records_errors, metadata)
      VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)
    `).run('twilio_calls', result.fetched, result.inserted, result.errors,
      JSON.stringify({ last_occurred_at: lastOccurredAt.toISOString() }));

    console.log(`✅ Calls: ${result.inserted} nuevas, ${result.errors} errores (de ${result.fetched} total)`);
  } catch (err: any) {
    result.error_message = err.message;
    console.error(`❌ Calls falló: ${err.message}`);
  }
  return result;
}

// ── Ingest messages ──────────────────────────────────────────────
async function ingestMessages(client: Twilio, db: ReturnType<typeof getLocalDb>): Promise<IngestResult> {
  const result: IngestResult = { source: 'twilio_messages', fetched: 0, inserted: 0, errors: 0 };

  try {
    const lastLog = db.prepare(
      "SELECT metadata FROM ingestion_log WHERE source = 'twilio_messages' ORDER BY created_at DESC LIMIT 1"
    ).get() as any;

    const lastDate = lastLog?.metadata
      ? new Date(JSON.parse(lastLog.metadata).last_occurred_at)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    console.log(`💬 Twilio Messages: jalando desde ${lastDate.toISOString()}`);

    const messages = await client.messages.list({ dateSentAfter: lastDate, limit: 500 });
    result.fetched = messages.length;
    let lastOccurredAt = lastDate;

    const insertMsg = db.prepare(`
      INSERT OR IGNORE INTO messages (message_sid, to_number, from_number, direction, body, num_segments, status, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const msg of messages) {
        try {
          const direction = msg.direction === 'outbound-api' || msg.direction === 'outbound-reply' ? 'outbound' : 'inbound';
          const occurred = msg.dateSent?.toISOString() || msg.dateCreated?.toISOString();
          const toNorm = normalizePhone(msg.to);
          const fromNorm = normalizePhone(msg.from);
          const r = insertMsg.run(
            msg.sid, toNorm, fromNorm, direction, msg.body || null,
            parseInt(msg.numSegments || '1'), msg.status, occurred,
          );
          if (r.changes > 0) result.inserted++;

          if (msg.dateSent && msg.dateSent > lastOccurredAt) {
            lastOccurredAt = msg.dateSent;
          }
        } catch (err: any) { result.errors++; }
      }
    });
    tx();

    db.prepare(`
      INSERT INTO ingestion_log (source, started_at, finished_at, records_fetched, records_new, records_errors, metadata)
      VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)
    `).run('twilio_messages', result.fetched, result.inserted, result.errors,
      JSON.stringify({ last_occurred_at: lastOccurredAt.toISOString() }));

    console.log(`✅ Messages: ${result.inserted} nuevos, ${result.errors} errores (de ${result.fetched} total)`);
  } catch (err: any) {
    result.error_message = err.message;
    console.error(`❌ Messages falló: ${err.message}`);
  }
  return result;
}

// ── Show some stats ──────────────────────────────────────────────
function showStats(db: ReturnType<typeof getLocalDb>) {
  console.log('\n📊 ESTADO ACTUAL DE LA DB LOCAL:');

  const calls = db.prepare('SELECT COUNT(*) as c FROM calls').get() as any;
  const msgs = db.prepare('SELECT COUNT(*) as c FROM messages').get() as any;
  const numbers = db.prepare('SELECT COUNT(*) as c FROM number_registry').get() as any;

  console.log(`   📞 ${calls.c} llamadas`);
  console.log(`   💬 ${msgs.c} mensajes`);
  console.log(`   🔢 ${numbers.c} números de tracking`);

  // Calls by location (via number_registry join)
  console.log('\n📞 LLAMADAS POR LOCATION (últimos 30 días):');
  const byLoc = db.prepare(`
    SELECT nr.location_id, COUNT(*) as total
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-30 days')
    GROUP BY nr.location_id
    ORDER BY total DESC
  `).all() as any[];
  for (const row of byLoc) {
    console.log(`   ${row.location_id}: ${row.total} llamadas`);
  }

  // Calls by channel
  console.log('\n📡 LLAMADAS POR CANAL (últimos 30 días):');
  const byChan = db.prepare(`
    SELECT nr.channel, COUNT(*) as total
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-30 days')
    GROUP BY nr.channel
    ORDER BY total DESC
  `).all() as any[];
  for (const row of byChan) {
    console.log(`   ${row.channel}: ${row.total} llamadas`);
  }
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 ACG Command Center — Ingesta Twilio (Local Dev Mode)\n');

  // Seed
  seedLocalDb();

  const config = getConfig();
  const client = new Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  const db = getLocalDb();

  // Run
  const [callsResult, messagesResult] = await Promise.all([
    ingestCalls(client, db),
    ingestMessages(client, db),
  ]);

  console.log('\n📊 RESUMEN FINAL:');
  console.log(`   📞 Calls:    ${callsResult.inserted} nuevas / ${callsResult.errors} errores / ${callsResult.fetched} fetched`);
  console.log(`   💬 Messages: ${messagesResult.inserted} nuevos / ${messagesResult.errors} errores / ${messagesResult.fetched} fetched`);

  if (callsResult.error_message) console.error(`\n⚠️  Calls error: ${callsResult.error_message}`);
  if (messagesResult.error_message) console.error(`\n⚠️  Messages error: ${messagesResult.error_message}`);

  showStats(db);

  closeLocalDb();
  console.log('\n🏁 Ingesta completa. DB local: dev.db');
}

main().catch(console.error);
