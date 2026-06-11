/**
 * ACG Command Center — CRM Ingestion LOCAL
 * Jala appointments desde m.autoacg.com → SQLite local (dev.db)
 *
 * A diferencia de crm.ts (Supabase), este escribe a la DB local
 * y extrae TODOS los campos: contactSource, contactPhone, status, type, etc.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getConfig } from '../config';
import { getLocalDb, closeLocalDb } from '../config/local-db';

// ── Normalización E.164 ───────────────────────────────────────────
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10 && raw.startsWith('+')) return raw;
  return null;
}

// ── Location parser ──────────────────────────────────────────────
function parseLocationFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const match = title.match(/@\s*ACG\s+(.+)$/i);
  if (!match) return null;
  const raw = match[1].trim().toLowerCase();
  const MAP: Record<string, string> = {
    'whittier': 'whittier', 'bakersfield': 'bakersfield_1',
    'bakersfield #2': 'bakersfield_2', 'bakersfield 2': 'bakersfield_2',
    'covina': 'covina', 'fresno': 'fresno',
    'gardena': 'gardena_1', 'gardena #2': 'gardena_2', 'gardena 2': 'gardena_2',
    'ontario': 'ontario', 'santa ana': 'santa_ana',
    'victorville': 'victorville', 'los angeles': 'los_angeles',
    'rancho cucamonga': 'rancho_cucamonga', 'el cajon': 'el_cajon',
  };
  return MAP[raw] || null;
}

interface CRMAppointment {
  id: string;
  contactId: string;
  title: string | null;
  type: string | null;
  status: string | null;
  appointmentDate: string | null;
  endTime: string | null;
  location: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactSource: string | null;
  contactTrackingSourceId: string | null;
  contactUtmSource: string | null;
  contactUtmMedium: string | null;
  contactUtmCampaign: string | null;
  notes: string | null;
  internalNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  [key: string]: any;
}

async function main() {
  console.log('🚀 CRM Local Ingestion iniciado\n');
  const config = getConfig();
  const db = getLocalDb();

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalDropOffs = 0;

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO appointments
      (appointment_id, customer_phone, customer_name, location_id,
       source, scheduled_at, arrived, no_show, drop_off, drop_off_at,
       estimated_value, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // CRM API returns all appointments (no pagination). Single fetch.
  const url = `${config.CRM_API_URL}/api/appointments`;
  console.log(`  📡 GET ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': config.CRM_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`  ❌ CRM API returned ${response.status}: ${response.statusText}`);
      closeLocalDb();
      process.exit(1);
    }

    const appointments: CRMAppointment[] = await response.json();
    totalFetched = appointments.length;
    console.log(`  📋 ${totalFetched} appointments recibidos`);

      const tx = db.transaction(() => {
        for (const appt of appointments) {
          try {
            const phone = normalizePhone(appt.contactPhone);
            const locationId = parseLocationFromTitle(appt.title);

            // Skip sin phone (no se puede atribuir)
            if (!phone) { totalSkipped++; continue; }
            if (!locationId) { totalSkipped++; continue; }

            // Status logic
            const isDropOff =
              appt.status === 'converted_dropoff' ||
              (appt.type === 'drop-off' && ['checked_in', 'completed', 'walk_in'].includes(appt.status || ''));

            const arrived =
              ['checked_in', 'completed', 'converted_dropoff'].includes(appt.status || '') ||
              (appt.type === 'drop-off' && ['checked_in', 'completed', 'walk_in'].includes(appt.status || ''));

            const noShow = appt.status === 'no_show' || appt.status === 'cancelled';

            if (isDropOff) totalDropOffs++;

            // Source mapping: unified names
            const rawSource = (appt.contactSource || '').toLowerCase().trim();
            const SOURCE_MAP: Record<string, string> = {
              'external_call': 'call_center',
              'web_estimate': 'website',
              'admin panel': 'manual',
              'facebook': 'facebook',
              'google_ads': 'google_ads',
              'gmb': 'gmb',
              'lsa': 'lsa',
              'yelp': 'yelp',
              'walk_in': 'walk_in',
              'referral': 'referral',
            };
            const source = SOURCE_MAP[rawSource] || rawSource || null;

            // Customer name
            const customerName = [appt.contactFirstName, appt.contactLastName]
              .filter(Boolean).join(' ') || null;

            // Estimated value: try to extract from notes or leave null
            let estimatedValue: number | null = null;

            const result = insertStmt.run(
              appt.id,
              phone,
              customerName,
              locationId,
              source,
              appt.appointmentDate || null,
              arrived ? 1 : 0,
              noShow ? 1 : 0,
              isDropOff ? 1 : 0,
              isDropOff ? (appt.appointmentDate || appt.updatedAt || null) : null,
              estimatedValue,
              JSON.stringify({
                ...appt,
                _source_raw: rawSource,
                _source_mapped: source,
              })
            );
            totalInserted++;
          } catch (err: any) {
            totalErrors++;
          }
        }
      });
      tx();

  } catch (err: any) {
    console.error(`  ❌ Error: ${err.message}`);
    closeLocalDb();
    process.exit(1);
  }

  // Log ingestion
  db.prepare(`
    INSERT INTO ingestion_log (source, started_at, finished_at, records_fetched, records_new, records_errors, metadata)
    VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)
  `).run('crm_appointments', totalFetched, totalInserted, totalErrors,
    JSON.stringify({ last_run_at: new Date().toISOString(), drop_offs_found: totalDropOffs, skipped: totalSkipped }));

  console.log(`\n📊 CRM Local: ${totalInserted} insertados, ${totalDropOffs} drop-offs, ${totalSkipped} skip, ${totalErrors} errores (de ${totalFetched} total)`);

  // ── Show source distribution ──────────────────────────────────
  console.log('\n📊 DISTRIBUCIÓN DE SOURCES:');
  const sourceDist = db.prepare(`
    SELECT source, COUNT(*) as cnt,
      COUNT(CASE WHEN drop_off=1 THEN 1 END) as drop_offs
    FROM appointments
    GROUP BY source
    ORDER BY cnt DESC
  `).all() as any[];
  for (const row of sourceDist) {
    console.log(`  ${row.source || 'null'}: ${row.cnt} appts, ${row.drop_offs} drop-offs`);
  }

  closeLocalDb();
  console.log('\n✅ CRM Local ingestion completa');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
