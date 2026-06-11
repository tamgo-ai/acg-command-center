// ACG Command Center — Twilio Ingestion
// Jala llamadas y SMS desde Twilio API y los inserta en Supabase.
// Atribuye automáticamente vía number_registry.

import { Twilio } from 'twilio';
import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';

// ── Phone normalization ──────────────────────────────────────────
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || phone.startsWith('agent_') || phone.startsWith('client:')) return null;
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (/^1\d{10}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
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

async function ingestCalls(client: Twilio, supabase: ReturnType<typeof getSupabase>): Promise<IngestResult> {
  const result: IngestResult = { source: 'twilio_calls', fetched: 0, inserted: 0, errors: 0 };

  try {
    // Buscar última llamada ingerida para solo traer lo nuevo
    const { data: lastLog } = await supabase
      .from('ingestion_log')
      .select('metadata')
      .eq('source', 'twilio_calls')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const lastDate = lastLog?.metadata?.last_occurred_at
      ? new Date(lastLog.metadata.last_occurred_at)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default 30 días atrás

    console.log(`📞 Twilio Calls: jalando desde ${lastDate.toISOString()}`);

    const calls = await client.calls.list({
      startTimeAfter: lastDate,
      limit: 500,
    });

    result.fetched = calls.length;
    let lastOccurredAt = lastDate;

    for (const call of calls) {
      try {
        const callData = {
          call_sid: call.sid,
          to_number: normalizePhone(call.toFormatted) || normalizePhone(call.to),
          from_number: normalizePhone(call.fromFormatted) || normalizePhone(call.from),
          direction: call.direction,
          duration_sec: call.duration ? parseInt(call.duration) : null,
          status: call.status,
          recording_url: null,
          transcript: null,
          occurred_at: call.startTime?.toISOString() || call.dateCreated?.toISOString(),
        };

        const { error } = await supabase
          .from('calls')
          .upsert(callData, { onConflict: 'call_sid' });

        if (error) {
          console.error(`  ⚠️  Error insertando call ${call.sid}: ${error.message}`);
          result.errors++;
        } else {
          result.inserted++;
        }

        if (call.startTime && call.startTime > lastOccurredAt) {
          lastOccurredAt = call.startTime;
        }
      } catch (err: any) {
        console.error(`  ⚠️  Error procesando call ${call.sid}: ${err.message}`);
        result.errors++;
      }
    }

    // Registrar ingestion log
    await supabase.from('ingestion_log').insert({
      source: 'twilio_calls',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      records_fetched: result.fetched,
      records_new: result.inserted,
      records_errors: result.errors,
      metadata: { last_occurred_at: lastOccurredAt.toISOString() },
    });

    console.log(`✅ Twilio Calls: ${result.inserted} nuevas, ${result.errors} errores (de ${result.fetched} total)`);
  } catch (err: any) {
    result.error_message = err.message;
    console.error(`❌ Twilio Calls falló: ${err.message}`);
  }

  return result;
}

async function ingestMessages(client: Twilio, supabase: ReturnType<typeof getSupabase>): Promise<IngestResult> {
  const result: IngestResult = { source: 'twilio_messages', fetched: 0, inserted: 0, errors: 0 };

  try {
    const { data: lastLog } = await supabase
      .from('ingestion_log')
      .select('metadata')
      .eq('source', 'twilio_messages')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const lastDate = lastLog?.metadata?.last_occurred_at
      ? new Date(lastLog.metadata.last_occurred_at)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    console.log(`💬 Twilio Messages: jalando desde ${lastDate.toISOString()}`);

    const messages = await client.messages.list({
      dateSentAfter: lastDate,
      limit: 500,
    });

    result.fetched = messages.length;
    let lastOccurredAt = lastDate;

    for (const msg of messages) {
      try {
        const msgData = {
          message_sid: msg.sid,
          to_number: normalizePhone(msg.to),
          from_number: normalizePhone(msg.from),
          direction: msg.direction === 'outbound-api' || msg.direction === 'outbound-reply' ? 'outbound' : 'inbound',
          body: msg.body,
          num_segments: parseInt(msg.numSegments || '1'),
          status: msg.status,
          occurred_at: msg.dateSent?.toISOString() || msg.dateCreated?.toISOString(),
        };

        const { error } = await supabase
          .from('messages')
          .upsert(msgData, { onConflict: 'message_sid' });

        if (error) {
          result.errors++;
        } else {
          result.inserted++;
        }

        if (msg.dateSent && msg.dateSent > lastOccurredAt) {
          lastOccurredAt = msg.dateSent;
        }
      } catch (err: any) {
        result.errors++;
      }
    }

    await supabase.from('ingestion_log').insert({
      source: 'twilio_messages',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      records_fetched: result.fetched,
      records_new: result.inserted,
      records_errors: result.errors,
      metadata: { last_occurred_at: lastOccurredAt.toISOString() },
    });

    console.log(`✅ Twilio Messages: ${result.inserted} nuevos, ${result.errors} errores (de ${result.fetched} total)`);
  } catch (err: any) {
    result.error_message = err.message;
    console.error(`❌ Twilio Messages falló: ${err.message}`);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const config = getConfig();
  const supabase = getSupabase();
  const client = new Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

  console.log('🚀 Ingesta Twilio iniciada\n');

  const [callsResult, messagesResult] = await Promise.all([
    ingestCalls(client, supabase),
    ingestMessages(client, supabase),
  ]);

  console.log('\n📊 Resumen:');
  console.log(`  Calls:    ${callsResult.inserted} nuevas / ${callsResult.errors} errores`);
  console.log(`  Messages: ${messagesResult.inserted} nuevos / ${messagesResult.errors} errores`);

  if (callsResult.error_message) {
    console.error(`\n⚠️  Calls error: ${callsResult.error_message}`);
  }
  if (messagesResult.error_message) {
    console.error(`\n⚠️  Messages error: ${messagesResult.error_message}`);
  }
}

main().catch(console.error);
