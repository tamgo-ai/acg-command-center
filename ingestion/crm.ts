/**
 * ACG Command Center — CRM Ingestion (m.autoacg.com)
 * Jala appointments desde la API del CRM y los inserta en Supabase.
 *
 * API: X-API-Key auth | 2663 appointments | campos reales mapeados
 * Location se extrae del title: "Estimate - Ivan Arias @ ACG Fresno"
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';

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
// Extrae location slug del título: "Estimate - Ivan Arias @ ACG Fresno" → "fresno"
function parseLocationFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const match = title.match(/@\s*ACG\s+(.+)$/i);
  if (!match) return null;
  const raw = match[1].trim().toLowerCase();

  // Map CRM names to location slugs
  const MAP: Record<string, string> = {
    'whittier': 'whittier',
    'bakersfield': 'bakersfield_1',
    'bakersfield #2': 'bakersfield_2',
    'bakersfield 2': 'bakersfield_2',
    'covina': 'covina',
    'fresno': 'fresno',
    'gardena': 'gardena_1',
    'gardena #2': 'gardena_2',
    'gardena 2': 'gardena_2',
    'ontario': 'ontario',
    'santa ana': 'santa_ana',
    'victorville': 'victorville',
    'los angeles': 'los_angeles',
    'rancho cucamonga': 'rancho_cucamonga',
    'el cajon': 'el_cajon',
  };

  return MAP[raw] || null;
}

// ── Source parser ────────────────────────────────────────────────
// Intenta inferir el canal del título o notas
function parseSource(title: string | null, notes: string | null): string | null {
  const text = `${title || ''} ${notes || ''}`.toLowerCase();
  if (text.includes('facebook') || text.includes('fb ')) return 'facebook';
  if (text.includes('google ads') || text.includes('google ad')) return 'google_ads';
  if (text.includes('google my business') || text.includes('gmb')) return 'gmb';
  if (text.includes('lsa') || text.includes('local service')) return 'lsa';
  if (text.includes('yelp')) return 'yelp';
  if (text.includes('website') || text.includes('web ')) return 'website';
  return null;
}

// ── Tipos reales del CRM ─────────────────────────────────────────
interface CRMAppointment {
  id: string;
  contactId: string;
  calendarId: string;
  title: string | null;
  type: string | null;           // 'estimate' | 'drop-off' | 'inspection' | 'consultation'
  status: string | null;         // 'scheduled' | 'confirmed' | 'cancelled' | 'converted_dropoff' | 'checked_in' | 'no_show' | ...
  appointmentDate: string | null;
  endTime: string | null;
  duration: number | null;
  location: string | null;       // UUID
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  internalNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  [key: string]: any;
}

// ── Ingesta ───────────────────────────────────────────────────────
async function ingestAppointments(fullSync = false): Promise<{
  fetched: number;
  inserted: number;
  errors: number;
  error_message?: string;
}> {
  const config = getConfig();
  const supabase = getSupabase();

  let fetched = 0;
  let inserted = 0;
  let errors = 0;

  try {
    let url = `${config.CRM_API_URL}/api/appointments`;

    if (!fullSync) {
      // Incremental: solo appointments actualizados desde la última ingesta
      const { data: lastLog } = await supabase
        .from('ingestion_log')
        .select('metadata')
        .eq('source', 'crm_appointments')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const lastRun = lastLog?.metadata?.last_run_at;
      if (lastRun) {
        console.log(`📋 CRM Appointments: jalando desde última ingesta (${lastRun})`);
      } else {
        console.log('📋 CRM Appointments: primera ingesta — full sync');
      }
    } else {
      console.log('📋 CRM Appointments: FULL SYNC');
    }

    console.log(`  GET ${url}`);

    const response = await fetch(url, {
      headers: {
        'X-API-Key': config.CRM_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CRM API devolvió ${response.status}: ${response.statusText}`);
    }

    const appointments: CRMAppointment[] = await response.json();
    fetched = appointments.length;
    console.log(`  Recibidos: ${fetched} appointments`);

    let skipped = 0;
    let dropOffs = 0;

    for (const appt of appointments) {
      try {
        const locationId = parseLocationFromTitle(appt.title);
        const phone = normalizePhone(appt.contactPhone);

        // Determinar drop_off (CORREGIDO):
        // 1. status = 'converted_dropoff' → REAL (estimate que convirtió)
        // 2. type = 'drop-off' + status checked_in/completed/walk_in → REAL
        const isDropOff =
          appt.status === 'converted_dropoff' ||
          (appt.type === 'drop-off' && ['checked_in', 'completed', 'walk_in'].includes(appt.status || ''));

        // Determinar arrived
        const arrived =
          ['checked_in', 'completed', 'converted_dropoff'].includes(appt.status || '') ||
          (appt.type === 'drop-off' && ['checked_in', 'completed', 'walk_in'].includes(appt.status || ''));

        // Determinar no_show
        const noShow = appt.status === 'no_show' || appt.status === 'cancelled';

        if (isDropOff) dropOffs++;

        // Saltar appointments sin teléfono (no se pueden atribuir)
        if (!phone) {
          skipped++;
          continue;
        }

        // Saltar appointments sin location (no se pueden atribuir a un taller)
        if (!locationId) {
          skipped++;
          continue;
        }

        const appointmentData = {
          appointment_id: appt.id,
          customer_phone: phone,
          customer_name: [appt.contactFirstName, appt.contactLastName]
            .filter(Boolean).join(' ') || null,
          location_id: locationId,
          source: parseSource(appt.title, appt.notes),
          scheduled_at: appt.appointmentDate,
          arrived,
          no_show: noShow,
          drop_off: isDropOff,
          drop_off_at: isDropOff ? (appt.appointmentDate || appt.updatedAt) : null,
          raw_data: appt,
        };

        const { error } = await supabase
          .from('appointments')
          .upsert(appointmentData, { onConflict: 'appointment_id' });

        if (error) {
          errors++;
        } else {
          inserted++;
        }
      } catch (err: any) {
        errors++;
      }
    }

    // Registrar ingestion log
    await supabase.from('ingestion_log').insert({
      source: 'crm_appointments',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      records_fetched: fetched,
      records_new: inserted,
      records_errors: errors,
      metadata: {
        last_run_at: new Date().toISOString(),
        dropped_skipped: skipped,
        drop_offs_found: dropOffs,
      },
    });

    console.log(`✅ CRM: ${inserted} insertados, ${dropOffs} drop-offs, ${skipped} skip (sin phone/loc), ${errors} errores`);
  } catch (err: any) {
    const error_message = err.message;
    console.error(`❌ CRM falló: ${error_message}`);

    await supabase.from('ingestion_log').insert({
      source: 'crm_appointments',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      records_fetched: fetched,
      records_new: inserted,
      records_errors: errors,
      error_message,
    });

    return { fetched, inserted, errors, error_message };
  }

  return { fetched, inserted, errors };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const fullSync = process.argv.includes('--full');
  console.log('🚀 Ingesta CRM iniciada\n');
  const result = await ingestAppointments(fullSync);
  console.log(`\n📊 CRM: ${result.inserted} nuevos, ${result.errors} errores (de ${result.fetched} total)`);
  if (result.error_message) console.error(`\n⚠️  Error: ${result.error_message}`);
}

main().catch(console.error);
