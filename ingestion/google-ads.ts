/**
 * ACG Command Center — Google Ads Ingestion
 * Usa la Google Ads REST API (v17) para jalar:
 *   - Spend, impressions, clicks, conversions, calls por campaña/día
 *   - Mapea campañas → locations de ACG por nombre
 *
 * Requiere credenciales OAuth 2.0 en .env:
 *   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_MANAGER_ID,
 *   GOOGLE_ADS_REFRESH_TOKEN
 */
import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';
import { getLocalDb } from '../config/local-db';

// ── OAuth 2.0 ──────────────────────────────────────────────────────
async function getAccessToken(config: ReturnType<typeof getConfig>): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.GOOGLE_ADS_CLIENT_ID!,
      client_secret: config.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: config.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OAuth error: ${response.status} — ${err}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// ── Obtener cuentas hijas del MCC ──────────────────────────────────
async function getChildAccounts(accessToken: string, managerId: string) {
  const response = await fetch(
    `https://googleads.googleapis.com/v17/customers/${managerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      },
      body: JSON.stringify({
        query: `
          SELECT
            customer_client.id,
            customer_client.descriptive_name
          FROM customer_client
          WHERE customer_client.status = 'ENABLED'
        `,
        pageSize: 100,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error(`  ⚠️ Error obteniendo cuentas: ${response.status} — ${err}`);
    return [];
  }

  const data = await response.json() as any;
  return (data.results || []).map((r: any) => ({
    id: r.customerClient?.id,
    name: r.customerClient?.descriptiveName,
  }));
}

// ── GAQL Query: performance por campaña y día ──────────────────────
async function getCampaignPerformance(
  accessToken: string,
  customerId: string,
  startDate: string,
  endDate: string
) {
  const response = await fetch(
    `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      },
      body: JSON.stringify({
        query: `
          SELECT
            campaign.id,
            campaign.name,
            segments.date,
            metrics.cost_micros,
            metrics.impressions,
            metrics.clicks,
            metrics.conversions,
            metrics.phone_calls
          FROM campaign
          WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          ORDER BY segments.date DESC
        `,
        pageSize: 1000,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error(`  ⚠️ Error en GAQL: ${response.status} — ${err}`);
    return [];
  }

  const data = await response.json() as any;
  return (data.results || []).map((r: any) => ({
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    date: r.segments?.date,
    spendMicros: parseInt(r.metrics?.costMicros || '0'),
    spend: parseInt(r.metrics?.costMicros || '0') / 1_000_000,
    impressions: parseInt(r.metrics?.impressions || '0'),
    clicks: parseInt(r.metrics?.clicks || '0'),
    conversions: parseInt(r.metrics?.conversions || '0') || 0,
    phoneCalls: parseInt(r.metrics?.phoneCalls || '0'),
  }));
}

// ── Mapeo: nombre de campaña → location_id ─────────────────────────
function mapCampaignToLocation(campaignName: string): string | null {
  const name = campaignName.toLowerCase();

  // Patrones: "ACG Whittier", "Whittier - Search", etc.
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
  ];

  for (const [pattern, locationId] of patterns) {
    if (name.includes(pattern)) return locationId;
  }

  return null;
}

// ── Ingesta principal ──────────────────────────────────────────────
async function ingestGoogleAds(startDate: string, endDate: string) {
  const config = getConfig();
  const supabase = getSupabase();
  const localDb = getLocalDb();

  // Validar credenciales
  if (!config.GOOGLE_ADS_CLIENT_ID || !config.GOOGLE_ADS_REFRESH_TOKEN) {
    console.error('❌ Faltan credenciales de Google Ads en .env');
    console.error('   Necesitas: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,');
    console.error('             GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_MANAGER_ID,');
    console.error('             GOOGLE_ADS_REFRESH_TOKEN');
    return { fetched: 0, inserted: 0, errors: 0 };
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let errors = 0;

  try {
    console.log(`🔑 Obteniendo access token OAuth...`);
    const accessToken = await getAccessToken(config);
    console.log('✅ Autenticado');

    // Obtener cuentas
    console.log(`📋 Obteniendo cuentas del MCC ${config.GOOGLE_ADS_MANAGER_ID}...`);
    const accounts = await getChildAccounts(accessToken, config.GOOGLE_ADS_MANAGER_ID!);
    console.log(`   ${accounts.length} cuentas encontradas`);

    if (accounts.length === 0) {
      console.log('   ℹ️  Probando con la cuenta manager directamente...');
      accounts.push({ id: config.GOOGLE_ADS_MANAGER_ID!, name: 'MCC Direct' });
    }

    const insertSupabase = async (row: any) => {
      const { error } = await supabase.from('ad_spend').upsert(row, {
        onConflict: 'channel,campaign_id,location_id,date',
      });
      if (error) {
        console.error(`  ⚠️ Supabase upsert error: ${error.message}`);
        return 0;
      }
      return 1;
    };

    const insertLocal = localDb.prepare(`
      INSERT OR REPLACE INTO ad_spend (channel, location_id, campaign_id, campaign_name, ad_set_name, date, spend, impressions, clicks, conversions, calls_reported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const account of accounts) {
      console.log(`\n📊 Cuenta: ${account.name} (${account.id})`);

      const rows = await getCampaignPerformance(accessToken, account.id, startDate, endDate);
      totalFetched += rows.length;

      let localInserted = 0;
      let supabaseInserted = 0;

      for (const row of rows) {
        const locationId = mapCampaignToLocation(row.campaignName);

        const spendRow = {
          channel: 'google_ads',
          location_id: locationId || 'unknown',
          campaign_id: row.campaignId,
          campaign_name: row.campaignName,
          ad_set_name: null,
          date: row.date,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
          calls_reported: row.phoneCalls,
        };

        // Local
        const r = insertLocal.run(
          spendRow.channel, spendRow.location_id, spendRow.campaign_id,
          spendRow.campaign_name, spendRow.ad_set_name, spendRow.date,
          spendRow.spend, spendRow.impressions, spendRow.clicks,
          spendRow.conversions, spendRow.calls_reported
        );
        if (r.changes > 0) localInserted++;

        // Supabase
        const s = await insertSupabase(spendRow);
        supabaseInserted += s;
      }

      totalInserted += supabaseInserted;
      console.log(`   ${rows.length} filas | local: ${localInserted} | supabase: ${supabaseInserted}`);
    }

    // Log ingestion
    await supabase.from('ingestion_log').insert({
      source: 'google_ads',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      records_fetched: totalFetched,
      records_new: totalInserted,
      records_errors: errors,
      metadata: { start_date: startDate, end_date: endDate, accounts: accounts.length },
    });

    console.log(`\n✅ GOOGLE ADS: ${totalFetched} filas, ${totalInserted} insertadas, ${errors} errores`);

  } catch (err: any) {
    console.error(`❌ Google Ads ingesta falló: ${err.message}`);
    errors = totalFetched;
  }

  return { fetched: totalFetched, inserted: totalInserted, errors };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 ACG Command Center — Google Ads Ingestion\n');
  console.log('═'.repeat(60));

  const args = process.argv.slice(2);
  const days = parseInt(args[0]) || 90;
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`📅 Ventana: ${startDate} → ${endDate} (${days} días)\n`);

  const result = await ingestGoogleAds(startDate, endDate);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 Google Ads: ${result.inserted} insertados, ${result.errors} errores (de ${result.fetched} total)`);
}

main().catch(console.error);
