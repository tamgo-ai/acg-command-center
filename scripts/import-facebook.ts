import { getLocalDb } from '../config/local-db';

const db = getLocalDb();

const insert = db.prepare(`
  INSERT OR REPLACE INTO ad_spend
  (channel, location_id, campaign_id, campaign_name, date, spend, impressions, clicks, conversions, calls_reported)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Facebook: WHITTIER - 8MI - CALLS
// Total: $8,905.31 | 934,326 imp | 72 calls (20s+ phone calls)
// Period: Jan-May 2026
const spend = 8905.31;
const impressions = 934326;
const results = 72;
const months = ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15'];

for (const month of months) {
  insert.run(
    'facebook',
    'whittier',
    'WHITTIER - 8MI - CALLS',
    'WHITTIER - 8MI - CALLS',
    month,
    +(spend / 5).toFixed(2),
    Math.round(impressions / 5),
    0,
    0,
    Math.round(results / 5)
  );
}

console.log('✅ Facebook importado');

// Verificar
const fb = db.prepare(`
  SELECT location_id, channel,
    ROUND(SUM(spend),0) as spend,
    SUM(impressions) as imp,
    SUM(calls_reported) as calls
  FROM ad_spend
  WHERE channel = 'facebook'
  GROUP BY location_id, channel
`).all();
console.log('\n📊 Facebook:');
for (const r of fb as any[]) {
  console.log(`  ${r.location_id} | facebook | $${r.spend.toLocaleString()} | ${r.imp.toLocaleString()} imp | ${r.calls} calls`);
}

// Total por canal
const total = db.prepare(`
  SELECT channel, ROUND(SUM(spend),0) as total
  FROM ad_spend
  GROUP BY channel
  ORDER BY total DESC
`).all();
console.log('\n💰 SPEND TOTAL POR CANAL:');
for (const t of total as any[]) {
  console.log(`  ${t.channel}: $${t.total.toLocaleString()}`);
}

// Ahora: Costo por drop-off con datos de Facebook incluidos
console.log('\n═══════════════════════════════════════');
console.log('🎯 COSTO POR DROP-OFF (CON FACEBOOK)');
console.log('═══════════════════════════════════════\n');

const analysis = db.prepare(`
  WITH spend_data AS (
    SELECT location_id, channel, SUM(spend) as total_spend, SUM(impressions) as imp
    FROM ad_spend GROUP BY location_id, channel
  ),
  drops AS (
    SELECT location_id, COUNT(*) as apps, SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) as drops
    FROM appointments WHERE location_id IS NOT NULL GROUP BY location_id
  )
  SELECT s.location_id, s.channel,
    ROUND(s.total_spend,0) as spend,
    COALESCE(d.drops, 0) as drops,
    CASE WHEN COALESCE(d.drops,0) > 0 THEN ROUND(s.total_spend / d.drops, 0) ELSE NULL END as cost_per_drop
  FROM spend_data s
  LEFT JOIN drops d ON s.location_id = d.location_id
  ORDER BY s.total_spend DESC
`).all() as any[];

console.log('Location          | Canal       | Spend      | Drops | Costo/Drop');
console.log('-'.repeat(75));
for (const a of analysis) {
  const costStr = a.cost_per_drop ? `$${a.cost_per_drop}/drop` : 'N/A';
  const icon = a.cost_per_drop && a.cost_per_drop < 100 ? '🟢' : a.cost_per_drop && a.cost_per_drop < 200 ? '🟡' : '🔴';
  console.log(`${icon} ${a.location_id.padEnd(16)} | ${a.channel.padEnd(11)} | $${String(a.spend).padStart(8)} | ${String(a.drops).padStart(5)} | ${costStr}`);
}
