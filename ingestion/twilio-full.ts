/**
 * ACG Command Center — Twilio FULL Ingestion
 * Jala TODAS las llamadas y mensajes usando paginación real de Twilio SDK.
 * Sin límites artificiales. Itera hasta que no hay más páginas.
 */
import { Twilio } from 'twilio';
import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';
import { getLocalDb } from '../config/local-db';

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || phone.startsWith('agent_') || phone.startsWith('client:')) return null;
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (/^1\d{10}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;
  return null;
}

async function ingestAllCalls(client: Twilio, startDate: Date) {
  console.log(`\n📞 JALANDO TODAS LAS LLAMADAS (desde ${startDate.toISOString().split('T')[0]})...`);

  const supabase = getSupabase();
  const localDb = getLocalDb();

  let totalFetched = 0;
  let totalSupabase = 0;
  let totalLocal = 0;

  const insertLocal = localDb.prepare(`
    INSERT OR IGNORE INTO calls (call_sid, to_number, from_number, direction, duration_sec, status, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // page() devuelve {instances, nextPageUrl, nextPage()}
  let page = 0;
  let pageResult = await client.calls.page({
    startTimeAfter: startDate,
    pageSize: 1000,
  });

  while (pageResult && pageResult.instances && pageResult.instances.length > 0) {
    page++;
    const calls = pageResult.instances;
    totalFetched += calls.length;
    const batch: any[] = [];

    for (const call of calls) {
      batch.push({
        call_sid: call.sid,
        to_number: normalizePhone(call.toFormatted) || normalizePhone(call.to),
        from_number: normalizePhone(call.fromFormatted) || normalizePhone(call.from),
        direction: call.direction,
        duration_sec: call.duration ? parseInt(call.duration) : null,
        status: call.status,
        occurred_at: call.startTime?.toISOString() || call.dateCreated?.toISOString(),
      });
    }

    // Local insert (en transaction para velocidad)
    const tx = localDb.transaction(() => {
      for (const c of batch) {
        const r = insertLocal.run(c.call_sid, c.to_number, c.from_number, c.direction, c.duration_sec, c.status, c.occurred_at);
        if (r.changes > 0) totalLocal++;
      }
    });
    tx();

    // Supabase upsert en paralelo
    const results = await Promise.all(batch.map(c =>
      supabase.from('calls').upsert(c, { onConflict: 'call_sid' }).then(r => r.error ? 0 : 1)
    ));
    totalSupabase += results.reduce((a, b) => a + b, 0);

    console.log(`  📄 Pág ${page}: ${calls.length} calls | total: ${totalFetched} | local: ${totalLocal} | supabase: ${totalSupabase}`);

    // Next page
    if (typeof pageResult.nextPage === 'function') {
      pageResult = await pageResult.nextPage();
    } else {
      break;
    }
  }

  console.log(`✅ LLAMADAS: ${totalFetched} total | ${totalLocal} local | ${totalSupabase} supabase`);
  return { totalFetched, totalSupabase, totalLocal };
}

async function ingestAllMessages(client: Twilio, startDate: Date) {
  console.log(`\n💬 JALANDO TODOS LOS MENSAJES (desde ${startDate.toISOString().split('T')[0]})...`);

  const supabase = getSupabase();
  const localDb = getLocalDb();

  let totalFetched = 0;
  let totalSupabase = 0;
  let totalLocal = 0;

  const insertLocal = localDb.prepare(`
    INSERT OR IGNORE INTO messages (message_sid, to_number, from_number, direction, body, num_segments, status, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let page = 0;
  let pageResult = await client.messages.page({
    dateSentAfter: startDate,
    pageSize: 1000,
  });

  while (pageResult && pageResult.instances && pageResult.instances.length > 0) {
    page++;
    const msgs = pageResult.instances;
    totalFetched += msgs.length;
    const batch: any[] = [];

    for (const msg of msgs) {
      batch.push({
        message_sid: msg.sid,
        to_number: normalizePhone(msg.to),
        from_number: normalizePhone(msg.from),
        direction: msg.direction === 'outbound-api' || msg.direction === 'outbound-reply' ? 'outbound' : 'inbound',
        body: msg.body || null,
        num_segments: parseInt(msg.numSegments || '1'),
        status: msg.status,
        occurred_at: msg.dateSent?.toISOString() || msg.dateCreated?.toISOString(),
      });
    }

    const tx = localDb.transaction(() => {
      for (const m of batch) {
        const r = insertLocal.run(m.message_sid, m.to_number, m.from_number, m.direction, m.body, m.num_segments, m.status, m.occurred_at);
        if (r.changes > 0) totalLocal++;
      }
    });
    tx();

    const results = await Promise.all(batch.map(m =>
      supabase.from('messages').upsert(m, { onConflict: 'message_sid' }).then(r => r.error ? 0 : 1)
    ));
    totalSupabase += results.reduce((a, b) => a + b, 0);

    console.log(`  📄 Pág ${page}: ${msgs.length} msgs | total: ${totalFetched} | local: ${totalLocal} | supabase: ${totalSupabase}`);

    if (typeof pageResult.nextPage === 'function') {
      pageResult = await pageResult.nextPage();
    } else {
      break;
    }
  }

  console.log(`✅ MENSAJES: ${totalFetched} total | ${totalLocal} local | ${totalSupabase} supabase`);
  return { totalFetched, totalSupabase, totalLocal };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 ACG Command Center — INGESTA MASIVA TWILIO\n');
  console.log('═'.repeat(60));

  const config = getConfig();
  const client = new Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  console.log(`📅 Ventana: ${startDate.toISOString().split('T')[0]} → hoy\n`);

  const [calls, msgs] = await Promise.all([
    ingestAllCalls(client, startDate),
    ingestAllMessages(client, startDate),
  ]);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 RESUMEN FINAL TWILIO:');
  console.log(`   📞 ${calls.totalFetched} llamadas (${calls.totalLocal} local, ${calls.totalSupabase} supabase)`);
  console.log(`   💬 ${msgs.totalFetched} mensajes (${msgs.totalLocal} local, ${msgs.totalSupabase} supabase)`);
  console.log(`\n🏁 Ingesta masiva completa.`);
}

main().catch(console.error);
