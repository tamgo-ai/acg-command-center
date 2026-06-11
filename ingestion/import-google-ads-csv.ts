/**
 * ACG Command Center — Google Ads CSV Importer
 * Importa un CSV exportado de Google Ads (Campaigns report).
 *
 * Columnas esperadas del CSV de Google Ads:
 *   Campaign, Date, Cost, Impressions, Clicks, Conversions, Phone calls, ...
 *
 * Uso:
 *   npx tsx ingestion/import-google-ads-csv.ts [archivo.csv] [--days=90]
 *   Si no se especifica archivo, busca google-ads-export.csv en la raíz
 */
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';
import { getLocalDb } from '../config/local-db';

// ── Mapeo campaña → location ──────────────────────────────────────
function mapCampaignToLocation(campaignName: string): string | null {
  const name = campaignName.toLowerCase().trim();

  const patterns: [string, string][] = [
    ['whittier', 'whittier'],
    ['bakersfield 2', 'bakersfield_2'],
    ['bakersfield #2', 'bakersfield_2'],
    ['bakersfield', 'bakersfield_1'],
    ['covina', 'covina'],
    ['fresno', 'fresno'],
    ['gardena 2', 'gardena_2'],
    ['gardena #2', 'gardena_2'],
    ['gardena', 'gardena_1'],
    ['ontario', 'ontario'],
    ['santa ana', 'santa_ana'],
    ['victorville', 'victorville'],
    ['los angeles', 'los_angeles'],
    ['rancho cucamonga', 'rancho_cucamonga'],
    ['el cajon', 'el_cajon'],
    ['bakersfield 1', 'bakersfield_1'],
    ['bakersfield #1', 'bakersfield_1'],
    ['gardena 1', 'gardena_1'],
    ['gardena #1', 'gardena_1'],
  ];

  for (const [pattern, locationId] of patterns) {
    if (name.includes(pattern)) return locationId;
  }

  return null;
}

// ── Parse CSV (soporta Google Ads y formatos genéricos) ────────────
function parseCSV(filePath: string): any[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    console.error('❌ CSV vacío o sin datos');
    return [];
  }

  // Detectar headers
  const headers = parseCSVLine(lines[0]);
  console.log(`📋 Headers detectados: ${headers.join(', ')}`);

  // Mapear headers a nuestro schema
  const colMap: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h.includes('campaign') || h === 'campaign name') colMap.campaign = i;
    if (h === 'date' || h === 'day') colMap.date = i;
    if (h.includes('cost') || h === 'amount') colMap.cost = i;
    if (h.includes('impression')) colMap.impressions = i;
    if (h.includes('click')) colMap.clicks = i;
    if (h.includes('conversion') && !h.includes('value')) colMap.conversions = i;
    if (h.includes('phone') || h.includes('call')) colMap.calls = i;
    if (h.includes('currency')) colMap.currency = i;
  }

  console.log(`📊 Columnas mapeadas: ${Object.keys(colMap).join(', ')}`);

  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 3) continue;

    const campaign = colMap.campaign !== undefined ? values[colMap.campaign]?.trim() : '';
    const dateStr = colMap.date !== undefined ? values[colMap.date]?.trim() : '';

    if (!campaign || !dateStr) continue;

    // Normalizar fecha
    let date = dateStr;
    if (date.includes('/')) {
      const parts = date.split('/');
      if (parts[0].length === 4) date = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      else if (parts[2].length === 4) date = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
    // Si ya es YYYY-MM-DD, dejarlo igual

    const cost = colMap.cost !== undefined ? parseFloat(values[colMap.cost]?.replace(/[$,]/g, '') || '0') || 0 : 0;
    const impressions = colMap.impressions !== undefined ? parseInt(values[colMap.impressions]?.replace(/,/g, '') || '0') || 0 : 0;
    const clicks = colMap.clicks !== undefined ? parseInt(values[colMap.clicks]?.replace(/,/g, '') || '0') || 0 : 0;
    const conversions = colMap.conversions !== undefined ? parseFloat(values[colMap.conversions]?.replace(/,/g, '') || '0') || 0 : 0;
    const calls = colMap.calls !== undefined ? parseInt(values[colMap.calls]?.replace(/,/g, '') || '0') || 0 : 0;

    const locationId = mapCampaignToLocation(campaign);

    rows.push({
      channel: 'google_ads',
      campaign_name: campaign,
      location_id: locationId || 'unknown',
      date,
      spend: cost,
      impressions,
      clicks,
      conversions,
      calls_reported: calls,
    });
  }

  console.log(`📄 ${rows.length} filas parseadas`);
  return rows;
}

// ── Simple CSV line parser ─────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ── Main Import ────────────────────────────────────────────────────
async function importCSV(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Archivo no encontrado: ${filePath}`);
    console.log('   Pásalo con: scp tu-archivo.csv root@31.97.142.91:/root/acg-command-center/');
    return;
  }

  console.log(`\n📥 Importando: ${filePath}\n`);
  console.log('═'.repeat(60));

  const rows = parseCSV(filePath);

  if (rows.length === 0) {
    console.error('❌ No se pudieron parsear filas del CSV');
    return;
  }

  const supabase = getSupabase();
  const localDb = getLocalDb();

  // Stats
  const locationCounts: Record<string, { spend: number; rows: number }> = {};
  let totalSpend = 0;
  let localInserted = 0;
  let supabaseInserted = 0;

  const insertLocal = localDb.prepare(`
    INSERT OR REPLACE INTO ad_spend (channel, location_id, campaign_id, campaign_name, date, spend, impressions, clicks, conversions, calls_reported)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  console.log('\n💾 Insertando...');

  for (const row of rows) {
    totalSpend += row.spend;

    // Stats
    const loc = row.location_id || 'unknown';
    if (!locationCounts[loc]) locationCounts[loc] = { spend: 0, rows: 0 };
    locationCounts[loc].spend += row.spend;
    locationCounts[loc].rows++;

    // Local
    const r = insertLocal.run(
      row.channel,
      row.location_id,
      row.campaign_name, // using campaign_name as campaign_id for CSV imports
      row.campaign_name,
      null,
      row.date,
      row.spend,
      row.impressions,
      row.clicks,
      row.conversions,
      row.calls_reported
    );
    if (r.changes > 0) localInserted++;

    // Supabase
    const { error } = await supabase.from('ad_spend').upsert({
      channel: row.channel,
      location_id: row.location_id,
      campaign_id: row.campaign_name,
      campaign_name: row.campaign_name,
      date: row.date,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      conversions: row.conversions,
      calls_reported: row.calls_reported,
    }, { onConflict: 'channel,campaign_id,location_id,date' });

    if (!error) supabaseInserted++;
  }

  // Log
  await supabase.from('ingestion_log').insert({
    source: 'google_ads_csv',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    records_fetched: rows.length,
    records_new: supabaseInserted,
  });

  // Resumen
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 RESUMEN IMPORTACIÓN:');
  console.log(`   Filas:       ${rows.length}`);
  console.log(`   Local:       ${localInserted} insertadas`);
  console.log(`   Supabase:    ${supabaseInserted} insertadas`);
  console.log(`   Spend total: $${totalSpend.toLocaleString()}`);
  console.log(`\n📍 SPEND POR LOCATION:`);
  for (const [loc, stats] of Object.entries(locationCounts).sort((a, b) => b[1].spend - a[1].spend)) {
    console.log(`   ${loc}: $${stats.spend.toLocaleString()} (${stats.rows} filas)`);
  }

  // Locations sin mapear
  const unmapped = rows.filter(r => !r.location_id || r.location_id === 'unknown');
  if (unmapped.length > 0) {
    const uniqueUnmapped = [...new Set(unmapped.map(r => r.campaign_name))];
    console.log(`\n⚠️  ${unmapped.length} filas sin location mapeada (${uniqueUnmapped.length} campañas):`);
    uniqueUnmapped.slice(0, 10).forEach(c => console.log(`   - "${c}"`));
    if (uniqueUnmapped.length > 10) console.log(`   ... y ${uniqueUnmapped.length - 10} más`);
  }

  console.log('\n✅ Importación completa.');
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0] || path.resolve(__dirname, '..', 'google-ads-export.csv');

  console.log('🚀 ACG Command Center — Importador CSV Google Ads');
  await importCSV(filePath);
}

main().catch(console.error);
