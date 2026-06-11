/**
 * ACG Command Center — Identity Resolver LOCAL
 * Atribución last-touch contra SQLite local.
 *
 * Lógica:
 * 1. Para cada appointment con teléfono, buscar calls en la ventana de lookback
 * 2. Si hay llamadas → mapear to_number → number_registry → canal/location
 * 3. Si no hay llamadas → fallback al campo source del appointment (del CRM)
 * 4. Guardar en customer_journey
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getConfig } from '../config';
import { getLocalDb, closeLocalDb } from '../config/local-db';

interface Touchpoint {
  type: 'call' | 'message';
  to_number: string;
  channel: string | null;
  location: string | null;
  occurred_at: string;
  duration_sec?: number;
}

interface ResolvedJourney {
  customer_phone: string;
  attributed_channel: string | null;
  attributed_location: string | null;
  first_touch_at: string;
  last_touch_at: string;
  appointment_id: string;
  drop_off: number;
  drop_off_at: string | null;
  attribution_method: 'phone_match' | 'phone_match_any_status' | 'source_field' | 'unattributed';
  confidence: number;
  touchpoints: Touchpoint[];
}

async function main() {
  console.log('🔑 Identity Resolver LOCAL iniciado\n');
  const config = getConfig();
  const db = getLocalDb();
  const lookbackDays = config.ATTRIBUTION_LOOKBACK_DAYS;

  // 1. Cargar number_registry en memoria
  const numberReg = db.prepare(
    `SELECT twilio_number, location_id, channel FROM number_registry WHERE active = 1`
  ).all() as Array<{ twilio_number: string; location_id: string; channel: string }>;

  if (numberReg.length === 0) {
    console.error('❌ number_registry vacío. Sin esto no se puede atribuir.');
    return;
  }

  const numberMap = new Map<string, { location: string; channel: string }>();
  for (const nr of numberReg) {
    numberMap.set(nr.twilio_number, { location: nr.location_id, channel: nr.channel });
  }
  console.log(`  📞 ${numberMap.size} números en registry`);

  // 2. Obtener appointments que NO estén unattributed (o todos)
  const appointments = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM customer_journey cj WHERE cj.appointment_id = a.appointment_id) as has_journey
    FROM appointments a
    WHERE a.customer_phone IS NOT NULL AND a.customer_phone != ''
    ORDER BY a.scheduled_at DESC
  `).all() as any[];

  console.log(`  📋 ${appointments.length} appointments a resolver\n`);

  let phoneMatched = 0;
  let phoneMatchedAny = 0;
  let sourceFallback = 0;
  let unattributed = 0;
  let skipped = 0;

  const deleteOld = db.prepare(`DELETE FROM customer_journey WHERE appointment_id = ?`);
  const insertJourney = db.prepare(`
    INSERT INTO customer_journey
      (customer_phone, normalized_phone, attributed_channel, attributed_location,
       first_touch_at, last_touch_at, appointment_id, drop_off, drop_off_at,
       attribution_method, confidence, touchpoints, lookback_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const appt of appointments) {
      const phone = appt.customer_phone;
      if (!phone) { skipped++; continue; }

      const scheduledAt = appt.scheduled_at ? new Date(appt.scheduled_at) : new Date();
      const windowStart = new Date(scheduledAt.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      const windowEnd = scheduledAt;

      let touchpoints: Touchpoint[] = [];

      // ── Buscar CALLS (TODOS los status, no solo completed) ──
      const calls = db.prepare(`
        SELECT call_sid, to_number, from_number, occurred_at, duration_sec, status
        FROM calls
        WHERE from_number = ?
          AND occurred_at >= ?
          AND occurred_at <= ?
          AND to_number IS NOT NULL AND to_number != ''
        ORDER BY occurred_at DESC
      `).all(phone, windowStart.toISOString(), windowEnd.toISOString()) as any[];

      for (const c of calls) {
        const mapped = numberMap.get(c.to_number);
        if (mapped) {
          touchpoints.push({
            type: 'call',
            to_number: c.to_number,
            channel: mapped.channel,
            location: mapped.location,
            occurred_at: c.occurred_at,
            duration_sec: c.duration_sec,
          });
        }
      }

      // ── Buscar MESSAGES ──
      const msgs = db.prepare(`
        SELECT message_sid, to_number, from_number, occurred_at, body
        FROM messages
        WHERE from_number = ?
          AND occurred_at >= ?
          AND occurred_at <= ?
        ORDER BY occurred_at DESC
      `).all(phone, windowStart.toISOString(), windowEnd.toISOString()) as any[];

      for (const m of msgs) {
        const mapped = numberMap.get(m.to_number);
        if (mapped) {
          touchpoints.push({
            type: 'message',
            to_number: m.to_number,
            channel: mapped.channel,
            location: mapped.location,
            occurred_at: m.occurred_at,
          });
        }
      }

      // ── Atribución ──
      let attributedChannel: string | null = null;
      let attributedLocation: string | null = null;
      let attributionMethod: ResolvedJourney['attribution_method'] = 'unattributed';
      let confidence = 0;

      // Ordenar touchpoints por fecha descendente (last-touch)
      touchpoints.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

      // Last-touch: primer touchpoint mapeado
      const lastMapped = touchpoints.find(t => t.channel && t.location);
      if (lastMapped) {
        attributedChannel = lastMapped.channel;
        attributedLocation = lastMapped.location;
        attributionMethod = 'phone_match';
        confidence = 0.9;

        const sameCount = touchpoints.filter(
          t => t.channel === attributedChannel && t.location === attributedLocation
        ).length;
        if (sameCount >= 2) confidence = 0.95;
        if (sameCount >= 3) confidence = 1.0;
        phoneMatched++;
      } else if (appt.source) {
        // Fallback al source del CRM
        attributedChannel = appt.source;
        attributedLocation = appt.location_id;
        attributionMethod = 'source_field';
        confidence = phone ? 0.6 : 0.4;
        sourceFallback++;
      } else {
        unattributed++;
      }

      // Guardar journey
      const firstTouch = touchpoints.length > 0 ? touchpoints[touchpoints.length - 1].occurred_at : appt.scheduled_at || new Date().toISOString();
      const lastTouch = touchpoints.length > 0 ? touchpoints[0].occurred_at : appt.scheduled_at || new Date().toISOString();

      deleteOld.run(appt.appointment_id);
      insertJourney.run(
        phone,
        phone,
        attributedChannel,
        attributedLocation,
        firstTouch,
        lastTouch,
        appt.appointment_id,
        appt.drop_off || 0,
        appt.drop_off_at || null,
        attributionMethod,
        confidence,
        JSON.stringify(touchpoints),
        lookbackDays
      );
    }
  });
  tx();

  const total = appointments.length;
  console.log('📊 RESULTADOS:');
  console.log(`  📱 Phone match:      ${phoneMatched} (${(phoneMatched/total*100).toFixed(1)}%)`);
  console.log(`  📋 Source fallback:  ${sourceFallback} (${(sourceFallback/total*100).toFixed(1)}%)`);
  console.log(`  ❓ Unattributed:     ${unattributed} (${(unattributed/total*100).toFixed(1)}%)`);
  console.log(`  ⏭️  Skipped (no phone): ${skipped}`);

  // ── Breakdown por canal atribuido ──
  console.log('\n📡 ATRIBUCIÓN POR CANAL:');
  const byChannel = db.prepare(`
    SELECT attributed_channel,
      COUNT(*) as total,
      SUM(drop_off) as drop_offs,
      ROUND(CAST(SUM(drop_off) AS REAL) / COUNT(*) * 100, 1) as conv_rate
    FROM customer_journey
    WHERE attributed_channel IS NOT NULL
    GROUP BY attributed_channel
    ORDER BY total DESC
  `).all() as any[];
  for (const row of byChannel) {
    console.log(`  ${row.attributed_channel}: ${row.total} leads, ${row.drop_offs} drop-offs (${row.conv_rate}%)`);
  }

  // ── Breakdown por location ──
  console.log('\n📍 TOP LOCATIONS POR DROP-OFF:');
  const byLoc = db.prepare(`
    SELECT cj.attributed_location, l.name,
      COUNT(*) as total,
      SUM(cj.drop_off) as drop_offs
    FROM customer_journey cj
    LEFT JOIN locations l ON cj.attributed_location = l.location_id
    WHERE cj.attributed_location IS NOT NULL
    GROUP BY cj.attributed_location
    ORDER BY drop_offs DESC
    LIMIT 10
  `).all() as any[];
  for (const row of byLoc) {
    console.log(`  ${row.attributed_location}: ${row.total} leads, ${row.drop_offs} drop-offs`);
  }

  closeLocalDb();
  console.log('\n✅ Identity Resolver LOCAL completo');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
