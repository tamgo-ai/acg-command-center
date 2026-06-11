/**
 * Quick import of Google Ads data from Raúl's copy-paste
 */
import { getLocalDb } from '../config/local-db';
import 'dotenv/config';

// Datos copiados: Campaign | Status | Type | Clicks | Impressions | CTR | Avg CPC | Cost | ?% | ?% | Conv | ? | Cost/conv | ?
const RAW = `
ACG Whittier PMax	Enabled	Performance Max	1941	79111	2.45%	$4.26	$8,277.90	0.00%	0.00%	95.00	0	$87.14	0.43%
ACG Gardena 2	Enabled	Search	1756	35484	4.95%	$8.59	$15,091.34	30.93%	61.63%	138.00	0	$109.36	7.86%
ACG Ontario	Enabled	Search	1327	25124	5.28%	$8.13	$10,794.29	35.21%	65.69%	125.00	0	$86.35	9.42%
ACG Victorville	Enabled	Search	1284	20364	6.31%	$7.45	$9,567.09	41.87%	73.66%	131.75	0	$72.62	10.26%
ACG Orange County	Enabled	Search	1183	25893	4.57%	$8.11	$9,592.63	25.06%	56.93%	75.00	0	$127.90	6.34%
ACG Covina	Enabled	Search	1132	19864	5.70%	$8.61	$9,744.54	35.66%	63.82%	80.00	0	$121.81	7.07%
ACG Fresno	Enabled	Performance Max	1035	20889	4.95%	$3.13	$3,238.37	0.00%	0.00%	102.00	0	$31.75	5.66%
ACG Rancho Cucamonga	Enabled	Performance Max	805	57776	1.39%	$4.05	$3,256.61	0.00%	0.00%	22.00	0	$148.03	0.15%
`;

// Mapeo de nombres de campaña a location_id
const LOCATION_MAP: Record<string, string> = {
  'whittier': 'whittier',
  'gardena 2': 'gardena_2',
  'ontario': 'ontario',
  'victorville': 'victorville',
  'orange county': 'santa_ana',
  'covina': 'covina',
  'fresno': 'fresno',
  'rancho cucamonga': 'rancho_cucamonga',
};

function parseData() {
  const db = getLocalDb();

  // Limpiar datos anteriores de prueba
  db.prepare('DELETE FROM ad_spend WHERE spend < 500').run();
  console.log('🧹 Datos de prueba eliminados');

  const lines = RAW.trim().split('\n');
  console.log(`📋 ${lines.length} campañas a procesar\n`);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO ad_spend (channel, location_id, campaign_id, campaign_name, date, spend, impressions, clicks, conversions, calls_reported)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalSpend = 0;
  let totalRows = 0;

  const tx = db.transaction(() => {
    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 8) continue;

      const campaignName = cols[0].trim();
      const impressions = parseInt(cols[4].replace(/,/g, ''));
      const clicks = parseInt(cols[3].replace(/,/g, ''));
      const cost = parseFloat(cols[7].replace(/[$,]/g, ''));
      const conversions = parseFloat(cols[10].replace(/,/g, '')) || 0;

      // Extraer location del nombre
      const shortName = campaignName.replace('ACG ', '').replace(' PMax', '').replace(' Performance Max', '').toLowerCase().trim();
      const locationId = LOCATION_MAP[shortName] || 'unknown';

      // Usar fecha de hoy para datos agregados (no tenemos fechas diarias)
      const today = new Date().toISOString().split('T')[0];

      const r = insert.run(
        'google_ads',
        locationId,
        campaignName,
        campaignName,
        today,
        cost,
        impressions,
        clicks,
        conversions,
        0,
      );

      if (r.changes > 0) {
        totalRows++;
        totalSpend += cost;
        console.log(`  ✅ ${campaignName.padEnd(30)} → ${locationId.padEnd(18)} | $${cost.toLocaleString()} | ${impressions.toLocaleString()} imp | ${clicks} clicks | ${conversions} conv`);
      }
    }
  });
  tx();

  console.log(`\n═══════════════════════════════════════`);
  console.log(`💰 SPEND TOTAL: $${totalSpend.toLocaleString()}`);
  console.log(`📊 ${totalRows} campañas insertadas`);
  console.log(`═══════════════════════════════════════`);

  // Resumen por location
  console.log('\n📍 SPEND POR LOCATION:');
  const summary = db.prepare(`
    SELECT location_id, SUM(spend) as total_spend, SUM(impressions) as imp, SUM(clicks) as clicks, SUM(conversions) as conv
    FROM ad_spend
    GROUP BY location_id
    ORDER BY total_spend DESC
  `).all() as any[];

  for (const s of summary) {
    const cpc = s.clicks > 0 ? (s.total_spend / s.clicks).toFixed(2) : 'N/A';
    console.log(`  ${s.location_id.padEnd(20)} | $${s.total_spend.toLocaleString().padStart(8)} | ${String(s.imp).padStart(6)} imp | ${String(s.clicks).padStart(4)} clicks | CPC $${cpc}`);
  }
}

parseData();
