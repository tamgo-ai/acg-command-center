// ACG Command Center — Identity Resolver
// Resuelve la identidad del cliente usando el teléfono como llave maestra.
// Atribución last-touch: la última interacción antes del appointment determina el canal.
// Output: customer_journey (tabla resuelta que los agentes consultan).

import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';
import { normalizePhone } from '../ingestion/crm';

interface Touchpoint {
  type: 'call' | 'message';
  to_number: string;
  channel: string | null;
  location: string | null;
  occurred_at: string;
  duration_sec?: number;
  body?: string;
}

interface ResolvedJourney {
  customer_phone: string;
  normalized_phone: string;
  attributed_channel: string | null;
  attributed_location: string | null;
  first_touch_at: string;
  last_touch_at: string;
  appointment_id: string;
  drop_off: boolean;
  drop_off_at: string | null;
  attribution_method: 'phone_match' | 'source_field' | 'time_location_tiebreak' | 'unattributed';
  confidence: number;
  touchpoints: Touchpoint[];
}

async function resolveIdentity(): Promise<{
  total_appointments: number;
  resolved: number;
  phone_matched: number;
  source_fallback: number;
  unattributed: number;
}> {
  const config = getConfig();
  const supabase = getSupabase();
  const lookbackDays = config.ATTRIBUTION_LOOKBACK_DAYS;

  console.log(`🔑 Identity Resolver iniciado (lookback: ${lookbackDays} días)`);

  // 1. Cargar number_registry en memoria (es pequeño)
  const { data: numberReg } = await supabase
    .from('number_registry')
    .select('twilio_number, location_id, channel')
    .eq('active', true);

  if (!numberReg || numberReg.length === 0) {
    console.error('❌ number_registry está vacío. Sin esto no puedo atribuir nada.');
    console.error('   Carga los números en number_registry antes de correr el resolver.');
    return { total_appointments: 0, resolved: 0, phone_matched: 0, source_fallback: 0, unattributed: 0 };
  }

  const numberMap = new Map<string, { location: string; channel: string }>();
  for (const nr of numberReg) {
    numberMap.set(nr.twilio_number, { location: nr.location_id, channel: nr.channel });
  }
  console.log(`  📞 ${numberMap.size} números en registry`);

  // 2. Obtener appointments que no se han resuelto aún
  const { data: appointments } = await supabase
    .from('appointments')
    .select('*')
    .order('scheduled_at', { ascending: false })
    .limit(1000); // procesar en batches si hay más

  if (!appointments || appointments.length === 0) {
    console.log('  ℹ️  No hay appointments nuevos para resolver');
    return { total_appointments: 0, resolved: 0, phone_matched: 0, source_fallback: 0, unattributed: 0 };
  }

  console.log(`  📋 ${appointments.length} appointments a resolver`);

  let phoneMatched = 0;
  let sourceFallback = 0;
  let unattributed = 0;

  // 3. Para cada appointment, buscar interacciones en calls y messages
  for (const appt of appointments) {
    const normalizedPhone = appt.customer_phone; // ya normalizado en ingestion
    const scheduledAt = appt.scheduled_at ? new Date(appt.scheduled_at) : new Date();
    const windowStart = new Date(scheduledAt.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const windowEnd = scheduledAt;

    let touchpoints: Touchpoint[] = [];

    if (normalizedPhone) {
      // Buscar calls en la ventana
      const { data: calls } = await supabase
        .from('calls')
        .select('call_sid, to_number, from_number, occurred_at, duration_sec, status')
        .eq('from_number', normalizedPhone)
        .gte('occurred_at', windowStart.toISOString())
        .lte('occurred_at', windowEnd.toISOString())
        .eq('status', 'completed')
        .order('occurred_at', { ascending: false });

      if (calls) {
        for (const c of calls) {
          const mapped = numberMap.get(c.to_number);
          touchpoints.push({
            type: 'call',
            to_number: c.to_number,
            channel: mapped?.channel || null,
            location: mapped?.location || null,
            occurred_at: c.occurred_at,
            duration_sec: c.duration_sec,
          });
        }
      }

      // Buscar messages en la ventana
      const { data: msgs } = await supabase
        .from('messages')
        .select('message_sid, to_number, from_number, occurred_at, body')
        .eq('from_number', normalizedPhone)
        .gte('occurred_at', windowStart.toISOString())
        .lte('occurred_at', windowEnd.toISOString())
        .order('occurred_at', { ascending: false });

      if (msgs) {
        for (const m of msgs) {
          const mapped = numberMap.get(m.to_number);
          touchpoints.push({
            type: 'message',
            to_number: m.to_number,
            channel: mapped?.channel || null,
            location: mapped?.location || null,
            occurred_at: m.occurred_at,
            body: m.body,
          });
        }
      }
    }

    // 4. Determinar atribución
    let attributedChannel: string | null = null;
    let attributedLocation: string | null = null;
    let attributionMethod: ResolvedJourney['attribution_method'] = 'unattributed';
    let confidence = 0;

    // Ordenar touchpoints por fecha descendente
    touchpoints.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

    // 4a. Last-touch: touchpoint más reciente con canal mapeado
    const lastMappedTouch = touchpoints.find(t => t.channel && t.location);
    if (lastMappedTouch) {
      attributedChannel = lastMappedTouch.channel;
      attributedLocation = lastMappedTouch.location;
      attributionMethod = 'phone_match';
      confidence = 0.9;

      // Boost: si hay múltiples touchpoints del mismo canal, subir confianza
      const sameChannelCount = touchpoints.filter(
        t => t.channel === attributedChannel && t.location === attributedLocation
      ).length;
      if (sameChannelCount >= 2) confidence = 0.95;
      if (sameChannelCount >= 3) confidence = 1.0;

      phoneMatched++;
    }
    // 4b. Fallback: campo source del CRM
    else if (appt.source) {
      attributedChannel = appt.source.toLowerCase().replace(/\s+/g, '_');
      attributedLocation = appt.location_id;
      attributionMethod = 'source_field';
      confidence = 0.5;

      // Si el teléfono existe pero no hay touchpoints, bajar confianza
      if (normalizedPhone && touchpoints.length === 0) {
        confidence = 0.3; // teléfono existe pero cero interacciones = raro
      }

      sourceFallback++;
    }
    // 4c. Sin atribución
    else {
      attributedChannel = null;
      attributedLocation = appt.location_id;
      attributionMethod = 'unattributed';
      confidence = 0;
      unattributed++;
    }

    // 5. Insertar/actualizar customer_journey
    const journey: ResolvedJourney = {
      customer_phone: appt.customer_phone || 'unknown',
      normalized_phone: normalizedPhone || 'unknown',
      attributed_channel: attributedChannel,
      attributed_location: attributedLocation,
      first_touch_at: touchpoints.length > 0
        ? touchpoints[touchpoints.length - 1].occurred_at
        : appt.scheduled_at || new Date().toISOString(),
      last_touch_at: touchpoints.length > 0
        ? touchpoints[0].occurred_at
        : appt.scheduled_at || new Date().toISOString(),
      appointment_id: appt.appointment_id,
      drop_off: appt.drop_off || false,
      drop_off_at: appt.drop_off_at || null,
      attribution_method: attributionMethod,
      confidence,
      touchpoints,
    };

    const { error } = await supabase
      .from('customer_journey')
      .upsert({
        customer_phone: journey.customer_phone,
        normalized_phone: journey.normalized_phone,
        attributed_channel: journey.attributed_channel,
        attributed_location: journey.attributed_location,
        first_touch_at: journey.first_touch_at,
        last_touch_at: journey.last_touch_at,
        appointment_id: journey.appointment_id,
        drop_off: journey.drop_off,
        drop_off_at: journey.drop_off_at,
        attribution_method: journey.attribution_method,
        confidence: journey.confidence,
        touchpoints: journey.touchpoints,
        lookback_days: lookbackDays,
      }, { onConflict: 'appointment_id' });

    if (error) {
      console.error(`  ⚠️  Error guardando journey para ${appt.appointment_id}: ${error.message}`);
    }
  }

  console.log('\n📊 Resultados Identity Resolution:');
  console.log(`  📱 Phone match:      ${phoneMatched} (${((phoneMatched / appointments.length) * 100).toFixed(1)}%)`);
  console.log(`  📋 Source fallback:  ${sourceFallback} (${((sourceFallback / appointments.length) * 100).toFixed(1)}%)`);
  console.log(`  ❓ Sin atribuir:     ${unattributed} (${((unattributed / appointments.length) * 100).toFixed(1)}%)`);

  if (unattributed > appointments.length * 0.3) {
    console.warn('\n⚠️  Más del 30% sin atribuir. Revisa:');
    console.warn('   - ¿El number_registry está completo?');
    console.warn('   - ¿Los teléfonos del CRM están normalizados a E.164?');
    console.warn('   - ¿Las llamadas entrantes usan los números correctos de tracking?');
  }

  return {
    total_appointments: appointments.length,
    resolved: phoneMatched + sourceFallback,
    phone_matched: phoneMatched,
    source_fallback: sourceFallback,
    unattributed,
  };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Identity Resolver iniciado\n');
  const result = await resolveIdentity();
  console.log(`\n✅ Resuelto: ${result.resolved}/${result.total_appointments}`);
}

main().catch(console.error);
