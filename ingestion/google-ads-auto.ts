/**
 * ACG Command Center — Google Ads AUTO Ingestion
 * Service Account → JWT → Access Token → Google Ads REST API
 * Jala Google Ads + Performance Max + LSA automáticamente.
 */
import { readFileSync } from 'fs';
import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';
import { getLocalDb } from '../config/local-db';
import * as crypto from 'crypto';

// ── JWT + Access Token ─────────────────────────────────────────────
async function getAccessToken(saPath: string): Promise<string> {
  const sa = JSON.parse(readFileSync(saPath, 'utf-8'));

  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const jwtClaim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const signInput = `${jwtHeader}.${jwtClaim}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = `${signInput}.${signature}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return data.access_token;
}

// ── Google Ads API Query ───────────────────────────────────────────
async function queryGoogleAds(
  accessToken: string,
  customerId: string,
  developerToken: string,
  query: string
): Promise<any[]> {
  const res = await fetch(
    `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': developerToken,
      },
      body: JSON.stringify({ query, pageSize: 10000 }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GAQL error: ${res.status} — ${err.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  return data.results || [];
}

// ── Obtener cuentas hijas ──────────────────────────────────────────
async function getChildAccounts(accessToken: string, managerId: string, devToken: string) {
  const rows = await queryGoogleAds(accessToken, managerId, devToken, `
    SELECT customer_client.id, customer_client.descriptive_name
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
  `);
  return rows.map(r => ({
    id: r.customerClient?.id,
    name: r.customerClient?.descriptiveName,
  }));
}

// ── Mapeo campaña → location ──────────────────────────────────────
function mapToLocation(campaignName: string): string | null {
  const n = campaignName.toLowerCase();
  const map: [string, string][] = [
    ['whittier', 'whittier'], ['bakersfield 2', 'bakersfield_2'], ['bakersfield #2', 'bakersfield_2'],
    ['bakersfield', 'bakersfield_1'], ['covina', 'covina'], ['fresno', 'fresno'],
    ['gardena 2', 'gardena_2'], ['gardena #2', 'gardena_2'], ['gardena', 'gardena_1'],
    ['ontario', 'ontario'], ['orange county', 'santa_ana'], ['santa ana', 'santa_ana'],
    ['victorville', 'victorville'], ['los angeles', 'los_angeles'],
    ['rancho cucamonga', 'rancho_cucamonga'], ['el cajon', 'el_cajon'],
  ];
  for (const [p, loc] of map) if (n.includes(p)) return loc;
  return null;
}

function detectChannel(campaignName: string, campaignType?: string): string {
  const n = campaignName.toLowerCase();
  // LSA campaigns
  if (n.includes('lsa') || n.includes('local service')) return 'lsa';
  // Performance Max
  if (campaignType === 'PERFORMANCE_MAX' || n.includes('pmax')) return 'google_ads';
  // Search, Display, etc.
  return 'google_ads';
}

// ── Ingesta principal ──────────────────────────────────────────────
async function ingestGoogleAdsAuto(daysBack = 90) {
  const config = getConfig();
  const supabase = getSupabase();
  const localDb = getLocalDb();

  const saPath = process.env.GOOGLE_ADS_SERVICE_ACCOUNT || '/root/acg-command-center/credentials.json';
  const devToken = config.GOOGLE_ADS_DEVELOPER_TOKEN;
  const managerId = config.GOOGLE_ADS_MANAGER_ID;

  if (!devToken || !managerId) {
    console.error('❌ Faltan GOOGLE_ADS_DEVELOPER_TOKEN o GOOGLE_ADS_MANAGER_ID');
    return;
  }

  console.log('🔑 Autenticando con Service Account...');
  const accessToken = await getAccessToken(saPath);
  console.log('✅ Autenticado\n');

  // Obtener cuentas hijas
  console.log('📋 Buscando cuentas...');
  const accounts = await getChildAccounts(accessToken, managerId, devToken);
  console.log(`   ${accounts.length} cuentas: ${accounts.map(a => a.name).join(', ')}\n`);

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  console.log(`📅 Ventana: ${startDate} → ${endDate}\n`);

  const insertLocal = localDb.prepare(`
    INSERT OR REPLACE INTO ad_spend (channel, location_id, campaign_id, campaign_name, date, spend, impressions, clicks, conversions, calls_reported)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalRows = 0;
  let totalSpend = 0;

  for (const account of accounts) {
    console.log(`📊 ${account.name} (${account.id})`);

    try {
      // Query: campaign performance by day
      const rows = await queryGoogleAds(accessToken, account.id, devToken, `
        SELECT
          campaign.id,
          campaign.name,
          campaign.advertising_channel_type,
          segments.date,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.phone_calls
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        ORDER BY segments.date DESC
      `);

      let localInserted = 0;
      let supabaseInserted = 0;

      for (const row of rows) {
        const campaignId = row.campaign?.id;
        const campaignName = row.campaign?.name || 'Unknown';
        const campaignType = row.campaign?.advertisingChannelType;
        const date = row.segments?.date;
        const spend = parseInt(row.metrics?.costMicros || '0') / 1_000_000;
        const impressions = parseInt(row.metrics?.impressions || '0');
        const clicks = parseInt(row.metrics?.clicks || '0');
        const conversions = parseInt(row.metrics?.conversions || '0') || 0;
        const calls = parseInt(row.metrics?.phoneCalls || '0') || 0;

        const locationId = mapToLocation(campaignName) || 'unknown';
        const channel = detectChannel(campaignName, campaignType);

        // Local insert
        const r = insertLocal.run(
          channel, locationId, String(campaignId), campaignName, date,
          spend, impressions, clicks, conversions, calls
        );
        if (r.changes > 0) localInserted++;

        // Supabase
        const { error } = await supabase.from('ad_spend').upsert({
          channel, location_id: locationId, campaign_id: String(campaignId),
          campaign_name: campaignName, date, spend, impressions, clicks,
          conversions, calls_reported: calls,
        }, { onConflict: 'channel,campaign_id,location_id,date' });
        if (!error) supabaseInserted++;

        totalSpend += spend;
        totalRows++;
      }

      console.log(`   ${rows.length} filas | local: ${localInserted} | supabase: ${supabaseInserted}`);

    } catch (err: any) {
      console.error(`   ❌ ${err.message}`);
    }
  }

  // Log
  await supabase.from('ingestion_log').insert({
    source: 'google_ads_auto',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    records_fetched: totalRows,
    records_new: totalRows,
    metadata: { start_date: startDate, end_date: endDate, accounts: accounts.length },
  });

  console.log(`\n═════════════════════════════════════`);
  console.log(`✅ GOOGLE ADS AUTO: ${totalRows} filas | $${totalSpend.toLocaleString()} spend`);
  console.log(`═════════════════════════════════════`);
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 ACG Command Center — Google Ads AUTO Ingestion\n');
  console.log('═'.repeat(60));

  const days = parseInt(process.argv[2]) || 90;
  await ingestGoogleAdsAuto(days);
}

main().catch(console.error);
