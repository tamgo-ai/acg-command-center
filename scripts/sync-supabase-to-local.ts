/**
 * ACG Command Center — Sync Supabase → SQLite Local
 */
import { getSupabase } from '../config/supabase';
import { getLocalDb } from '../config/local-db';
import 'dotenv/config';

async function sync() {
  console.log('🔄 Sincronizando Supabase → SQLite Local...\n');

  const supabase = getSupabase();
  const local = getLocalDb();

  local.pragma('foreign_keys = OFF');

  // ── 1. Appointments ──────────────────────────────────────────────
  console.log('📋 Appointments...');

  const allAppointments: any[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .range(from, from + PAGE - 1)
      .order('scheduled_at', { ascending: false });

    if (error) { console.error(`  ❌ ${error.message}`); break; }
    if (!data || data.length === 0) break;
    allAppointments.push(...data);
    console.log(`   fetched ${data.length} (total: ${allAppointments.length})`);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`  Total: ${allAppointments.length} appointments`);

  if (allAppointments.length > 0) {
    const insert = local.prepare(`
      INSERT OR REPLACE INTO appointments
      (appointment_id, customer_phone, customer_name, location_id, source,
       scheduled_at, arrived, no_show, drop_off, drop_off_at,
       vehicle_make, vehicle_model, vehicle_year, estimated_value, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const tx = local.transaction(() => {
      for (const a of allAppointments) {
        const r = insert.run(
          a.appointment_id, a.customer_phone, a.customer_name,
          a.location_id, a.source, a.scheduled_at,
          a.arrived ? 1 : 0, a.no_show ? 1 : 0,
          a.drop_off ? 1 : 0, a.drop_off_at,
          a.vehicle_make, a.vehicle_model, a.vehicle_year,
          a.estimated_value, JSON.stringify(a.raw_data || {}),
        );
        if (r.changes > 0) inserted++;
      }
    });
    tx();
    console.log(`  ✅ ${inserted} appointments en SQLite\n`);
  }

  // ── 2. Customer Journeys ─────────────────────────────────────────
  console.log('🗺️  Customer Journeys...');

  const allJourneys: any[] = [];
  from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('customer_journey')
      .select('*')
      .range(from, from + PAGE - 1)
      .order('last_touch_at', { ascending: false });

    if (error) { console.error(`  ❌ ${error.message}`); break; }
    if (!data || data.length === 0) break;
    allJourneys.push(...data);
    console.log(`   fetched ${data.length} (total: ${allJourneys.length})`);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`  Total: ${allJourneys.length} journeys`);

  if (allJourneys.length > 0) {
    const insert = local.prepare(`
      INSERT OR REPLACE INTO customer_journey
      (journey_id, customer_phone, normalized_phone, attributed_channel, attributed_location,
       first_touch_at, last_touch_at, appointment_id, drop_off, drop_off_at,
       attribution_method, confidence, touchpoints, lookback_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const tx = local.transaction(() => {
      for (const j of allJourneys) {
        if (!j.customer_phone) continue;
        const r = insert.run(
          j.journey_id, j.customer_phone, j.normalized_phone,
          j.attributed_channel, j.attributed_location,
          j.first_touch_at, j.last_touch_at, j.appointment_id,
          j.drop_off ? 1 : 0, j.drop_off_at,
          j.attribution_method, j.confidence,
          JSON.stringify(j.touchpoints || []),
          j.lookback_days || 90,
        );
        if (r.changes > 0) inserted++;
      }
    });
    tx();
    console.log(`  ✅ ${inserted} journeys en SQLite\n`);
  }

  local.pragma('foreign_keys = ON');

  // ── 3. Resumen ───────────────────────────────────────────────────
  const appCount = (local.prepare('SELECT COUNT(*) as c FROM appointments').get() as any).c;
  const dropCount = (local.prepare("SELECT COUNT(*) as c FROM appointments WHERE drop_off = 1").get() as any).c;
  const journeyCount = (local.prepare('SELECT COUNT(*) as c FROM customer_journey').get() as any).c;

  console.log('═'.repeat(50));
  console.log('📊 SQLITE LOCAL — POST-SYNC:');
  console.log(`   Appointments: ${appCount}`);
  console.log(`   Drop Offs:    ${dropCount}`);
  console.log(`   Journeys:     ${journeyCount}`);
  console.log('═'.repeat(50));
  console.log('\n✅ Sync completo.');
}

sync().catch(console.error);
