/**
 * ACG Command Center — Local API Server
 * Sirve datos desde SQLite dev.db para el dashboard en modo local.
 * Cuando Supabase esté listo, cambiar DB_MODE=supabase
 */
import express from 'express';
import cors from 'cors';
import { getLocalDb } from '../config/local-db';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));

const db = getLocalDb();
const PORT = 3456;

// ── Helper: days from query ──────────────────────────────────────
function getDays(req: any, def = 90): number {
  const d = parseInt(req.query?.days) || def;
  return Math.min(Math.max(d, 7), 730);
}



// ── GET /api/stats — KPIs principales ────────────────────────────
app.get('/api/stats', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  const callCount = (db.prepare(`SELECT COUNT(*) as c FROM calls WHERE occurred_at > ${since} AND direction = 'inbound'`).get() as any).c;
  const msgCount = (db.prepare(`SELECT COUNT(*) as c FROM messages WHERE occurred_at > ${since}`).get() as any).c;

  const attributed = db.prepare(`
    SELECT COUNT(*) as c FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since} AND c.direction = 'inbound'
  `).get() as any;

  const appointments = db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE scheduled_at > ${since}`).get() as any;
  const dropOffs = db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE drop_off = 1 AND scheduled_at > ${since}`).get() as any;
  const journeys = db.prepare(`SELECT COUNT(*) as c FROM customer_journey WHERE attributed_channel IS NOT NULL AND last_touch_at > ${since}`).get() as any;
  const totalSpend = db.prepare(`SELECT COALESCE(SUM(spend), 0) as total FROM ad_spend WHERE date >= date('now', '-${days} days')`).get() as any;

  res.json({
    total_calls: callCount,
    total_messages: msgCount,
    attributed_calls_30d: attributed.c,
    appointments: appointments.c,
    drop_offs: dropOffs.c,
    journeys_attributed: journeys.c,
    total_spend: totalSpend.total,
    attribution_rate: callCount > 0 ? ((attributed.c / callCount) * 100).toFixed(1) : 0,
  });
});

// ── GET /api/heatmap — Location × Channel (con costo/drop) ─────
app.get('/api/heatmap', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  // Calls by location × channel (90 days)
  const data = db.prepare(`
    SELECT nr.location_id, nr.channel, COUNT(*) as call_count,
           ROUND(AVG(c.duration_sec), 0) as avg_duration
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since}
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY nr.location_id, nr.channel
    ORDER BY call_count DESC
  `).all();

  // Ad spend by location × channel
  const spend = db.prepare(`
    SELECT location_id, channel, SUM(spend) as total_spend, SUM(impressions) as imp, SUM(clicks) as clicks
    FROM ad_spend GROUP BY location_id, channel
  `).all() as any[];

  // Drop-offs by location
  const drops = db.prepare(`
    SELECT location_id, SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) as drop_offs
    FROM appointments WHERE location_id IS NOT NULL GROUP BY location_id
  `).all() as any[];

  // Real attribution from customer_journey (replaces proportional estimation)
  const journeys = db.prepare(`
    SELECT attributed_location as location_id, attributed_channel as channel,
      COUNT(*) as journey_count,
      SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) as real_drops
    FROM customer_journey
    WHERE attributed_channel IS NOT NULL
      AND attributed_location IS NOT NULL AND attributed_location != 'all'
      AND last_touch_at > ${since}
    GROUP BY attributed_location, attributed_channel
  `).all() as any[];
  const journeyMap: Record<string, any> = {};
  for (const j of journeys) journeyMap[`${j.location_id}|${j.channel}`] = j;

  // Merge spend and drops into data
  // ATRIBUCIÓN PROPORCIONAL: % de calls de un canal → % de drops de ese canal
  const spendMap: Record<string, any> = {};
  for (const s of spend) spendMap[`${s.location_id}|${s.channel}`] = s;
  const dropsMap: Record<string, any> = {};
  for (const d of drops) dropsMap[d.location_id] = d;

  // Total calls por location para calcular share
  const callsByLoc: Record<string, number> = {};
  for (const row of data) {
    callsByLoc[row.location_id] = (callsByLoc[row.location_id] || 0) + row.call_count;
  }

  const enriched = data.map((row: any) => {
    const d = dropsMap[row.location_id] || {};
    const s = spendMap[`${row.location_id}|${row.channel}`] || {};
    const j = journeyMap[`${row.location_id}|${row.channel}`] || {};
    const totalLocCalls = callsByLoc[row.location_id] || 1;
    const realDrops = j.real_drops || 0;
    const journeyCount = j.journey_count || 0;
    const hasSpend = (s.total_spend || 0) > 0;
    const costoPorDrop = (hasSpend && realDrops > 0)
      ? Math.round(s.total_spend / realDrops) : null;
    return {
      ...row,
      total_spend: s.total_spend || 0,
      drop_offs: d.drop_offs || 0,
      estimated_drops: realDrops,                   // real, not estimated
      costo_por_drop_off: costoPorDrop,
      journeys: journeyCount,
      conversion_rate: journeyCount > 0 ? Math.round(realDrops / journeyCount * 100) : null,
    };
  });

  const locations = db.prepare("SELECT location_id, name, city FROM locations WHERE active = 1").all() as any[];

  res.json({ data: enriched, locations });
});

// ── GET /api/funnel — Embudo de conversión ────────────────────────
app.get('/api/funnel', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  // Calls by location (30d)
  const callsByLoc = db.prepare(`
    SELECT nr.location_id, COUNT(*) as calls
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since}
    GROUP BY nr.location_id
  `).all() as any[];

  // Appointments by location (placeholder)
  const appsByLoc = db.prepare(`
    SELECT location_id, COUNT(*) as appointments,
           SUM(CASE WHEN arrived = 1 THEN 1 ELSE 0 END) as arrived,
           SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) as drop_offs
    FROM appointments
    WHERE scheduled_at > datetime('now', '-30 days')
    GROUP BY location_id
  `).all() as any[];

  res.json({ calls: callsByLoc, appointments: appsByLoc });
});

// ── GET /api/recommendations — Recomendaciones AI ─────────────────
app.get('/api/recommendations', (_req, res) => {
  const recs = db.prepare(`
    SELECT * FROM recommendations
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  // If no recommendations yet, return empty
  res.json(recs);
});

// ── GET /api/trends — Tendencias temporales completas ──────────
app.get('/api/trends', (req, res) => {
  const days = getDays(req, 60);
  const since = `datetime('now', '-${days} days')`;
  const byChannel = db.prepare(`
    SELECT date(occurred_at) as day, nr.channel, COUNT(*) as calls,
           ROUND(AVG(c.duration_sec), 0) as avg_dur
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since}
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY day, nr.channel ORDER BY day
  `).all();
  const dailyTotal = db.prepare(`
    SELECT date(occurred_at) as day, COUNT(*) as total_calls,
           ROUND(AVG(duration_sec), 0) as avg_dur
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since}
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY day ORDER BY day
  `).all();
  const weekly = db.prepare(`
    SELECT strftime('%Y-W%W', occurred_at) as week, nr.channel, COUNT(*) as calls
    FROM calls c JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since}
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY week, nr.channel ORDER BY week
  `).all();
  const dropsMonthly = db.prepare(`
    SELECT strftime('%Y-%m', scheduled_at) as month, location_id,
           COUNT(*) as apps,
           SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) as drops
    FROM appointments
    WHERE scheduled_at > datetime('now', '-6 months') AND location_id IS NOT NULL
    GROUP BY month, location_id ORDER BY month
  `).all();
  const spendMonthly = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, channel, SUM(spend) as spend
    FROM ad_spend GROUP BY month, channel ORDER BY month
  `).all();
  // Journeys by channel (from customer_journey — the attribution truth)
  const journeysByChannel = db.prepare(`
    SELECT date(last_touch_at) as day, attributed_channel as channel,
           COUNT(*) as journeys,
           SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) as drops
    FROM customer_journey
    WHERE attributed_channel IS NOT NULL AND last_touch_at > ${since}
    GROUP BY day, attributed_channel ORDER BY day
  `).all();
  res.json({ byChannel, dailyTotal, weekly, dropsMonthly, spendMonthly, journeysByChannel });
});

// ── GET /api/calls/recent — Últimas llamadas ──────────────────────
app.get('/api/calls/recent', (_req, res) => {
  const calls = db.prepare(`
    SELECT c.call_sid, c.to_number, c.from_number, c.direction, c.duration_sec, c.status, c.occurred_at,
           nr.location_id, nr.channel, nr.display_name
    FROM calls c
    LEFT JOIN number_registry nr ON c.to_number = nr.twilio_number
    ORDER BY c.occurred_at DESC
    LIMIT 100
  `).all();
  res.json(calls);
});

// ── GET /api/locations — Todas las locations ──────────────────────
app.get('/api/locations', (_req, res) => {
  const locs = db.prepare("SELECT * FROM locations WHERE active = 1").all();
  res.json(locs);
});

// ── GET /api/oauth/google-ads — OAuth redirect para Google Ads ─────
app.get('/api/oauth/google-ads', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('Falta el parámetro ?code=');
  }

  const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send('Faltan GOOGLE_ADS_CLIENT_ID o CLIENT_SECRET en .env');
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: 'https://acg.tamgo.ai/api/oauth/google-ads',
        grant_type: 'authorization_code',
      }),
    });

    const data = await tokenRes.json() as any;

    if (data.error) {
      return res.status(400).json({ error: data.error, description: data.error_description });
    }

    // Guardar refresh token en .env
    if (data.refresh_token) {
      const fs = require('fs');
      const envPath = '/root/acg-command-center/.env';
      let env = fs.readFileSync(envPath, 'utf-8');
      env = env.replace(
        /GOOGLE_ADS_REFRESH_TOKEN=.*/,
        `GOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}`
      );
      fs.writeFileSync(envPath, env);
      console.log('✅ Google Ads Refresh Token guardado en .env');
    }

    res.send(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><title>ACG — Google Ads Auth</title>
      <style>body{background:#0a0a0f;color:#e8e8ed;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}</style></head>
      <body><div style="text-align:center">
        <h1 style="color:#22c55e">✅ Google Ads Conectado</h1>
        <p>Refresh token guardado. Ya puedes cerrar esta ventana.</p>
        <p style="color:#8888a0;font-size:0.8rem">ACG Command Center — ${new Date().toISOString()}</p>
      </div></body></html>
    `);
  } catch (err: any) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// ── POST /api/upload/google-ads — Upload CSV de Google Ads ────────
// ── POST /api/upload/ads — Upload CSV (Google Ads, LSA, Facebook) ──
// Auto-detecta el tipo de CSV por los headers y lo procesa
app.post('/api/upload/google-ads', async (req, res) => {
  await uploadAdsCsv(req, res);
});
app.post('/api/upload/ads', async (req, res) => {
  await uploadAdsCsv(req, res);
});

async function uploadAdsCsv(req: any, res: any) {
  try {
    const csv = typeof req.body === 'string' ? req.body : '';
    if (!csv || csv.length < 10) {
      return res.status(400).json({ error: 'CSV vacío o inválido' });
    }

    console.log(`📥 Upload Google Ads CSV: ${csv.length} bytes`);

    // Parse CSV
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV sin datos (necesita header + al menos 1 fila)' });
    }

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());

    // Mapear columnas
    const idx: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h.includes('campaign')) idx.campaign = i;
      if (h === 'date' || h === 'day') idx.date = i;
      if (h.includes('cost') || h === 'amount' || h.includes('spend')) idx.cost = i;
      if (h.includes('impression')) idx.impressions = i;
      if (h.includes('click')) idx.clicks = i;
      if (h.includes('conversion') && !h.includes('value')) idx.conversions = i;
      if (h.includes('phone') || h.includes('call')) idx.calls = i;
    }

    console.log(`  Columnas mapeadas: ${Object.keys(idx).join(', ')}`);

    // Mapeo location
    const locationMap: Record<string, string> = {
      'whittier': 'whittier', 'bakersfield': 'bakersfield_1', 'covina': 'covina',
      'fresno': 'fresno', 'gardena': 'gardena_1', 'ontario': 'ontario',
      'santa ana': 'santa_ana', 'victorville': 'victorville', 'los angeles': 'los_angeles',
      'rancho cucamonga': 'rancho_cucamonga', 'el cajon': 'el_cajon',
    };

    // Auto-detectar canal
    function detectChannel(headers: string[], campaignName: string): string {
      const name = campaignName.toLowerCase();
      const headStr = headers.join(' ').toLowerCase();
      
      // LSA indicators
      if (headStr.includes('lead') || headStr.includes('charged') || 
          name.includes('lsa') || name.includes('local service') || name.includes('gls')) {
        return 'lsa';
      }
      // Facebook indicators  
      if (name.includes('fb ') || name.includes('facebook') || name.includes('ig ') || 
          name.includes('instagram') || headStr.includes('facebook') || headStr.includes('fb')) {
        return 'facebook';
      }
      // GMB indicators
      if (name.includes('gmb') || name.includes('google my business') || name.includes('maps') || name.includes('perfil')) {
        return 'gmb';
      }
      // Default: Google Ads
      return 'google_ads';
    }

    function mapLocation(campaign: string): string {
      const c = campaign.toLowerCase();
      if (c.includes('bakersfield 2') || c.includes('bakersfield #2')) return 'bakersfield_2';
      if (c.includes('gardena 2') || c.includes('gardena #2')) return 'gardena_2';
      for (const [key, loc] of Object.entries(locationMap)) {
        if (c.includes(key)) return loc;
      }
      return 'unknown';
    }

    // Parse rows
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
      const campaign = idx.campaign !== undefined ? cols[idx.campaign] : '';
      const dateStr = idx.date !== undefined ? cols[idx.date] : '';
      if (!campaign || !dateStr) continue;

      // Normalizar fecha
      let date = dateStr;
      if (date.includes('/')) {
        const parts = date.split('/');
        if (parts[0].length === 4) date = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
        else if (parts[2].length === 4) date = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
      }

      rows.push({
        channel: detectChannel(headers, campaign),
        location_id: mapLocation(campaign),
        campaign_name: campaign,
        date,
        spend: idx.cost !== undefined ? parseFloat(cols[idx.cost]?.replace(/[$,]/g,'') || '0') || 0 : 0,
        impressions: idx.impressions !== undefined ? parseInt(cols[idx.impressions]?.replace(/,/g,'') || '0') || 0 : 0,
        clicks: idx.clicks !== undefined ? parseInt(cols[idx.clicks]?.replace(/,/g,'') || '0') || 0 : 0,
        conversions: idx.conversions !== undefined ? parseFloat(cols[idx.conversions]?.replace(/,/g,'') || '0') || 0 : 0,
        calls_reported: idx.calls !== undefined ? parseInt(cols[idx.calls]?.replace(/,/g,'') || '0') || 0 : 0,
      });
    }

    // Insertar en local
    const insertLocal = db.prepare(`
      INSERT OR REPLACE INTO ad_spend (channel, location_id, campaign_id, campaign_name, ad_set_name, date, spend, impressions, clicks, conversions, calls_reported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let localInserted = 0;
    let totalSpend = 0;
    const locSpend: Record<string, number> = {};

    const tx = db.transaction(() => {
      for (const row of rows) {
        const r = insertLocal.run(
          row.channel, row.location_id, row.campaign_name, row.campaign_name,
          null, row.date, row.spend, row.impressions, row.clicks, row.conversions, row.calls_reported
        );
        if (r.changes > 0) localInserted++;
        totalSpend += row.spend;
        locSpend[row.location_id] = (locSpend[row.location_id] || 0) + row.spend;
      }
    });
    tx();

    // También subir a Supabase si está configurado
    let supabaseInserted = 0;
    try {
      const { getSupabase } = await import('../config/supabase');
      const supabase = getSupabase();
      for (const row of rows) {
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
    } catch (err: any) {
      console.log('  ⚠️ Supabase no disponible:', err.message);
    }

    console.log(`✅ CSV importado: ${rows.length} filas, $${totalSpend.toFixed(0)} spend`);

    res.json({
      ok: true,
      rows: rows.length,
      local_inserted: localInserted,
      supabase_inserted: supabaseInserted,
      total_spend: totalSpend,
      by_location: locSpend,
    });
  } catch (err: any) {
    console.error('❌ Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/ad-spend — Spend por location × canal (con filtro días) ─
app.get('/api/ad-spend', (req, res) => {
  const days = getDays(req);
  const since = `date('now', '-${days} days')`;
  const spend = db.prepare(`
    SELECT location_id, channel, SUM(spend) as total_spend, SUM(impressions) as impressions, SUM(clicks) as clicks
    FROM ad_spend
    WHERE date >= ${since}
    GROUP BY location_id, channel
    ORDER BY total_spend DESC
  `).all();
  res.json(spend);
});

// ── GET /api/attribution/overview ─────────────────────────────────
app.get('/api/attribution/overview', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  const data = db.prepare(`
    SELECT
      COUNT(*) AS total_journeys,
      COUNT(CASE WHEN attributed_channel IS NOT NULL THEN 1 END) AS attributed,
      COUNT(DISTINCT customer_phone) AS unique_phones,
      COUNT(DISTINCT attributed_channel) AS channels_detected,
      COUNT(DISTINCT attributed_location) AS locations_detected,
      ROUND(100.0 * SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS drop_rate,
      ROUND(100.0 * COUNT(CASE WHEN attributed_channel IS NOT NULL THEN 1 END) / MAX(COUNT(*),1), 1) AS attribution_rate,
      COALESCE(ROUND(AVG(CASE WHEN attributed_channel IS NOT NULL THEN confidence END), 2), 0) AS avg_confidence
    FROM customer_journey
    WHERE last_touch_at > ${since}
  `).get() as any;

  // Merge ad_spend for cost metrics
  const spend = db.prepare(`SELECT COALESCE(SUM(spend),0) as total FROM ad_spend WHERE date >= date('now','-${days} days')`).get() as any;
  const dropsTotal = db.prepare(`SELECT COUNT(*) as c FROM customer_journey WHERE drop_off=1 AND last_touch_at > ${since}`).get() as any;

  res.json({
    ...data,
    total_spend: spend.total,
    cost_per_drop: dropsTotal.c > 0 ? (spend.total / dropsTotal.c).toFixed(2) : 0,
  });
});

// ── GET /api/attribution/channels ─────────────────────────────────
app.get('/api/attribution/channels', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  const channels = db.prepare(`
    SELECT
      COALESCE(attributed_channel, 'unattributed') as channel,
      COUNT(*) AS journeys,
      SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) AS drop_offs,
      COUNT(DISTINCT customer_phone) AS unique_phones,
      ROUND(100.0 * SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS drop_rate,
      ROUND(AVG(confidence), 2) AS avg_confidence,
      COUNT(DISTINCT appointment_id) AS appointments
    FROM customer_journey
    WHERE last_touch_at > ${since}
    GROUP BY attributed_channel
    HAVING journeys >= 3
    ORDER BY
      CASE WHEN attributed_channel IS NULL THEN 999 ELSE journeys END DESC
  `).all() as any[];

  // Merge spend per channel
  const spendByChannel = db.prepare(`
    SELECT channel, SUM(spend) as total_spend, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(conversions) as conversions
    FROM ad_spend WHERE date >= date('now','-${days} days') GROUP BY channel
  `).all() as any[];
  const spendMap = new Map(spendByChannel.map((s: any) => [s.channel, s]));

  // Raw calls per channel (from number_registry — the telephony truth)
  const callsByChannel = db.prepare(`
    SELECT nr.channel, COUNT(*) as total_calls
    FROM calls c JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > ${since} AND c.direction = 'inbound'
    GROUP BY nr.channel
  `).all() as any[];
  const callsMap = new Map(callsByChannel.map((c: any) => [c.channel, c.total_calls]));

  const enriched = channels.map((ch: any) => {
    const sp = spendMap.get(ch.channel) || {};
    const cpl = ch.journeys > 0 ? ((sp.total_spend || 0) / ch.journeys) : 0;
    const cpd = ch.drop_offs > 0 ? ((sp.total_spend || 0) / ch.drop_offs) : 0;
    return { ...ch, ...sp, total_calls: callsMap.get(ch.channel) || 0, cost_per_lead: Math.round(cpl), cost_per_drop: Math.round(cpd) };
  });

  res.json(enriched);
});

// ── GET /api/attribution/locations ────────────────────────────────
app.get('/api/attribution/locations', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  const locs = db.prepare(`
    SELECT
      cj.attributed_location as location_id,
      l.name,
      COUNT(*) AS journeys,
      SUM(CASE WHEN cj.drop_off = 1 THEN 1 ELSE 0 END) AS drop_offs,
      ROUND(100.0 * SUM(CASE WHEN cj.drop_off = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS drop_rate,
      COUNT(DISTINCT cj.attributed_channel) AS channels,
      COUNT(DISTINCT cj.customer_phone) AS unique_phones
    FROM customer_journey cj
    LEFT JOIN locations l ON cj.attributed_location = l.location_id
    WHERE cj.attributed_location IS NOT NULL AND cj.attributed_location != 'all'
      AND cj.last_touch_at > ${since}
    GROUP BY cj.attributed_location
    HAVING journeys >= 5
    ORDER BY journeys DESC
  `).all() as any[];

  // Merge calls and spend
  const calls30d = db.prepare(`
    SELECT nr.location_id, COUNT(*) as total_calls
    FROM calls c JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now','-${days} days') AND c.direction='inbound'
    GROUP BY nr.location_id
  `).all() as any[];
  const callsMap = new Map(calls30d.map((c: any) => [c.location_id, c.total_calls]));

  const spend = db.prepare(`SELECT location_id, SUM(spend) as total_spend FROM ad_spend WHERE date >= date('now','-${days} days') GROUP BY location_id`).all() as any[];
  const spendMap = new Map(spend.map((s: any) => [s.location_id, s.total_spend]));

  const enriched = locs.map((loc: any) => ({
    ...loc,
    total_calls: callsMap.get(loc.location_id) || 0,
    total_spend: spendMap.get(loc.location_id) || 0,
    cost_per_drop: loc.drop_offs > 0 ? Math.round((spendMap.get(loc.location_id) || 0) / loc.drop_offs) : 0,
  }));

  res.json(enriched);
});

// ── GET /api/attribution/sources ──────────────────────────────────
app.get('/api/attribution/sources', (req, res) => {
  const days = getDays(req);
  const since = `datetime('now', '-${days} days')`;
  const sources = db.prepare(`
    SELECT
      CASE
        WHEN attributed_channel IN ('manual','manual_dial','gohighlevel','conversations - manual entry') THEN 'Manual Entry'
        WHEN attributed_channel IN ('call_center','twilio_voice','ai_voice_call','twilio_sms') THEN 'Call Center'
        WHEN attributed_channel = 'lsa' THEN 'LSA'
        WHEN attributed_channel = 'google_ads' THEN 'Google Ads'
        WHEN attributed_channel IN ('gmb','public booking','website','gardena landing page','rancho cucamonga landing page') THEN 'Orgánico'
        WHEN attributed_channel = 'facebook' THEN 'Social'
        WHEN attributed_channel IN ('claim page intake','service funnel','liaison','walk_in','referral') THEN 'Otros'
        ELSE 'Otros'
      END AS source_group,
      COUNT(*) AS count,
      SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) as drop_offs,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM customer_journey WHERE attributed_channel IS NOT NULL AND last_touch_at > ${since}), 1) AS pct
    FROM customer_journey
    WHERE attributed_channel IS NOT NULL AND last_touch_at > ${since}
    GROUP BY source_group
    ORDER BY count DESC
  `).all();

  res.json(sources);
});

// ── GET /api/attribution/trends ───────────────────────────────────
app.get('/api/attribution/trends', (req, res) => {
  const days = getDays(req, 60);
  const since = `datetime('now', '-${days} days')`;
  const daily = db.prepare(`
    SELECT date(last_touch_at) as day, attributed_channel as channel,
      COUNT(*) AS journeys, SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) AS drop_offs
    FROM customer_journey
    WHERE attributed_channel IS NOT NULL AND last_touch_at > ${since}
    GROUP BY day, channel ORDER BY day
  `).all();
  res.json({ daily });
});

// ── Legal AI — Knowledge Base + Chat ───────────────────────────
import { legalAiRoutes } from './legal-ai';
app.use('/api/legal-ai', legalAiRoutes);
console.log('   /api/legal-ai → Legal AI chat + search + admin');

// ── Crash Intel — Proxy API + Static ──────────────────────────
const CRASH_INTEL_API = process.env.CRASH_INTEL_API_URL || 'http://127.0.0.1:5100';

// Proxy /crash-intel/api/* → Flask server
app.use('/crash-intel/api', async (req, res) => {
  try {
    const url = `${CRASH_INTEL_API}/api${req.url}`;
    const method = req.method;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = JSON.stringify(req.body);
    }
    const flaskRes = await fetch(url, { method, headers, body });
    const data = await flaskRes.json();
    res.status(flaskRes.status).json(data);
  } catch (err: any) {
    console.error('[CrashIntel proxy]', err.message);
    res.status(502).json({ error: 'Crash Intel API unreachable' });
  }
});

// Serve crash-intel dashboard build
app.use('/crash-intel', express.static('/root/acg-command-center/crash-intel/dashboard-vite/dist'));

// ── GET /api/recordings/:callSid — Proxy de grabaciones Twilio ──
app.get('/api/recordings/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // 1. Buscar el call para ver si tiene parent_call_sid (grabaciones viven en el parent)
    const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`;
    const callRes = await fetch(callUrl, { headers: { 'Authorization': `Basic ${auth}` } });
    const callData = await callRes.json();
    const parentSid = callData.parent_call_sid || callSid;

    // 2. Buscar recordings en el parent call
    const recUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${parentSid}/Recordings.json`;
    const recRes = await fetch(recUrl, { headers: { 'Authorization': `Basic ${auth}` } });
    const recData = await recRes.json();

    // Helper: stream MP3 through server (Twilio requires auth, browser can't do it directly)
    async function streamRecording(recordingSid: string) {
      const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
      const mp3Res = await fetch(mp3Url, { headers: { 'Authorization': `Basic ${auth}` } });
      if (!mp3Res.ok) return false;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mp3Res.headers.get('content-length') || '');
      res.setHeader('Accept-Ranges', 'bytes');
      const buffer = await mp3Res.arrayBuffer();
      res.send(Buffer.from(buffer));
      return true;
    }

    if (recData.recordings && recData.recordings.length > 0) {
      const best = recData.recordings.sort((a: any, b: any) => parseInt(b.duration || '0') - parseInt(a.duration || '0'))[0];
      const ok = await streamRecording(best.sid);
      if (!ok) res.status(500).json({ error: 'Failed to fetch MP3' });
    } else {
      const recUrl2 = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings.json`;
      const recRes2 = await fetch(recUrl2, { headers: { 'Authorization': `Basic ${auth}` } });
      const recData2 = await recRes2.json();
      if (recData2.recordings && recData2.recordings.length > 0) {
        const best = recData2.recordings.sort((a: any, b: any) => parseInt(b.duration || '0') - parseInt(a.duration || '0'))[0];
        const ok = await streamRecording(best.sid);
        if (!ok) res.status(500).json({ error: 'Failed to fetch MP3' });
      } else {
        res.status(404).json({ error: 'No recording found', callSid, parentSid });
      }
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔌 ACG Command Center Local API → http://0.0.0.0:${PORT}`);
  console.log(`   /api/stats`);
  console.log(`   /api/heatmap`);
  console.log(`   /api/funnel`);
  console.log(`   /api/recommendations`);
  console.log(`   /api/trends`);
  console.log(`   /api/calls/recent`);
  console.log(`   /api/locations`);
  console.log(`   /crash-intel   → static dashboard + API proxy → ${CRASH_INTEL_API}`);
});
