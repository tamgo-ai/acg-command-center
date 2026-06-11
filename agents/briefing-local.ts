/**
 * ACG Command Center — Briefing Agent LOCAL
 * Usa Claude para analizar datos desde SQLite local (77k+ calls, 21k+ msgs)
 * y genera recomendaciones accionables en español.
 * Guarda en recommendations (SQLite) → visibles en el dashboard.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getLocalDb } from '../config/local-db';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const db = getLocalDb();

// ── Build context from local SQLite ────────────────────────────────
function buildContext(): string {
  // Calls by location × channel (last 90 days, INBOUND ONLY)
  const heatmap = db.prepare(`
    SELECT nr.location_id, nr.channel,
           COUNT(*) as total_calls,
           AVG(c.duration_sec) as avg_duration_sec
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-90 days')
      AND nr.channel != 'call_center'
      AND c.direction = 'inbound'
    GROUP BY nr.location_id, nr.channel
    ORDER BY total_calls DESC
  `).all() as any[];

  // Daily call trend (last 30 days)
  const dailyTrend = db.prepare(`
    SELECT date(occurred_at) as day, COUNT(*) as calls
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-30 days') AND c.direction = 'inbound'
    GROUP BY day ORDER BY day
  `).all() as any[];

  // Ad spend data
  const adSpend = db.prepare(`
    SELECT location_id, campaign_name, date, spend, impressions, clicks, conversions, calls_reported
    FROM ad_spend
    ORDER BY date DESC
    LIMIT 200
  `).all() as any[];

  // Spend summary by location
  const spendByLocation = db.prepare(`
    SELECT location_id, SUM(spend) as total_spend, SUM(impressions) as total_imp, SUM(clicks) as total_clicks
    FROM ad_spend
    GROUP BY location_id
    ORDER BY total_spend DESC
  `).all() as any[];

  // Locations
  const locations = db.prepare("SELECT location_id, name, city FROM locations WHERE active = 1 AND location_id != 'all'").all() as any[];

  // Week-over-week trend
  const wowTrend = db.prepare(`
    WITH w1 AS (
      SELECT nr.channel, COUNT(*) as cnt FROM calls c
      JOIN number_registry nr ON c.to_number = nr.twilio_number
      WHERE c.occurred_at > datetime('now', '-14 days') AND c.occurred_at <= datetime('now', '-7 days')
        AND nr.channel != 'call_center' AND c.direction = 'inbound'
      GROUP BY nr.channel
    ),
    w2 AS (
      SELECT nr.channel, COUNT(*) as cnt FROM calls c
      JOIN number_registry nr ON c.to_number = nr.twilio_number
      WHERE c.occurred_at > datetime('now', '-7 days')
        AND nr.channel != 'call_center' AND c.direction = 'inbound'
      GROUP BY nr.channel
    )
    SELECT COALESCE(w2.channel, w1.channel) as channel,
      COALESCE(w1.cnt, 0) as last_week,
      COALESCE(w2.cnt, 0) as this_week,
      CASE WHEN w1.cnt > 0 THEN ROUND((w2.cnt - w1.cnt)*100.0/w1.cnt, 1) ELSE 0 END as change_pct
    FROM w1 FULL OUTER JOIN w2 ON w1.channel = w2.channel
    ORDER BY this_week DESC
  `).all() as any[];

  // Drop-offs this month vs last
  const dropTrend = db.prepare(`
    SELECT
      CASE WHEN scheduled_at > datetime('now', '-30 days') THEN 'Este mes' ELSE 'Mes anterior' END as period,
      COUNT(*) as apps,
      SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) as drops,
      ROUND(SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END)*100.0/COUNT(*),1) as rate
    FROM appointments
    WHERE scheduled_at > datetime('now', '-60 days') AND location_id IS NOT NULL
    GROUP BY period
  `).all() as any[];

  // Total calls
  const totalInbound = (db.prepare("SELECT COUNT(*) as c FROM calls WHERE direction = 'inbound'").get() as any).c;
  const totalMsgs = (db.prepare("SELECT COUNT(*) as c FROM messages").get() as any).c;

  const parts: string[] = [];
  parts.push(`# DATOS DE ACG — ${new Date().toISOString().split('T')[0]}

## Volumen Total
- ${totalInbound.toLocaleString()} llamadas inbound totales
- ${totalMsgs.toLocaleString()} mensajes totales
- ${locations.length} locations activas

## 📈 TENDENCIAS — Semana vs Semana
${wowTrend.map(w => {
  const icon = w.change_pct > 10 ? '📈' : w.change_pct < -10 ? '📉' : '➡️';
  return `${icon} ${w.channel}: ${w.this_week} calls esta semana vs ${w.last_week} anterior (${w.change_pct > 0 ? '+' : ''}${w.change_pct}%)`;
}).join('\n')}

## Drop-offs por periodo
${dropTrend.map((d: any) => `- ${d.period}: ${d.drops} drops / ${d.apps} apps = ${d.rate}%`).join('\n')}

## Llamadas por Location × Canal (últimos 90 días, inbound)
${heatmap.map(h => `- ${h.location_id} | ${h.channel}: ${h.total_calls} llamadas (duración media: ${Math.round(h.avg_duration_sec || 0)}s)`).join('\n')}
`);

  // Cost per drop-off analysis WITH PROPORTIONAL ATTRIBUTION
  const costPerDrop = db.prepare(`
    WITH total_calls AS (
      SELECT nr.location_id, COUNT(*) as total FROM calls c
      JOIN number_registry nr ON c.to_number = nr.twilio_number
      WHERE c.occurred_at > datetime('now','-90 days') AND nr.channel != 'call_center' AND c.direction = 'inbound'
      GROUP BY nr.location_id
    ),
    channel_calls AS (
      SELECT nr.location_id, nr.channel, COUNT(*) as cnt FROM calls c
      JOIN number_registry nr ON c.to_number = nr.twilio_number
      WHERE c.occurred_at > datetime('now','-90 days') AND nr.channel != 'call_center' AND c.direction = 'inbound'
      GROUP BY nr.location_id, nr.channel
    ),
    drops AS (
      SELECT location_id, COUNT(*) as apps, SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) as drops
      FROM appointments WHERE location_id IS NOT NULL GROUP BY location_id
    )
    SELECT cc.location_id, cc.channel, cc.cnt as calls, t.total as total_loc_calls,
      ROUND(cc.cnt*100.0/t.total,1) as call_share,
      COALESCE(d.drops,0) as total_drops,
      ROUND(d.drops * (cc.cnt*1.0/t.total), 0) as estimated_drops,
      (SELECT COALESCE(SUM(spend),0) FROM ad_spend WHERE location_id=cc.location_id AND channel=cc.channel) as spend
    FROM channel_calls cc
    JOIN total_calls t ON cc.location_id=t.location_id
    LEFT JOIN drops d ON cc.location_id=d.location_id
    WHERE spend > 0
    ORDER BY spend DESC
  `).all() as any[];

  // Drop-offs by location from CRM
  const dropsByLocation = db.prepare(`
    SELECT location_id, COUNT(*) as apps, SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) as drops,
           ROUND(SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END)*100.0/COUNT(*),1) as rate
    FROM appointments WHERE location_id IS NOT NULL GROUP BY location_id ORDER BY drops DESC
  `).all() as any[];

  // Total spend
  const totalSpend = (db.prepare("SELECT COALESCE(SUM(spend),0) as total FROM ad_spend").get() as any).total;
  const totalDrops = (db.prepare("SELECT SUM(CASE WHEN drop_off=1 THEN 1 ELSE 0 END) as c FROM appointments").get() as any).c;

  if (totalSpend > 0) {
    parts.push(`## 💰 COSTO POR DROP-OFF (Google Ads) — ANÁLISIS COMPLETO
Total spend: $${totalSpend.toLocaleString()} | Total drop-offs: ${totalDrops} | Costo/drop global: $${totalDrops > 0 ? Math.round(totalSpend/totalDrops) : 'N/A'}

${costPerDrop.map((s: any) => {
    const realCost = s.estimated_drops > 0 ? Math.round(s.spend / s.estimated_drops) : null;
    const icon = realCost && realCost < 100 ? '🟢' : realCost && realCost < 200 ? '🟡' : '🔴';
    return `${icon} ${s.location_id} | ${s.channel}: $${s.spend.toLocaleString()} spend | ${s.calls} calls (${s.call_share}% share) | ${s.total_drops} total drops → ~${s.estimated_drops} drops est. | $${realCost || '∞'}/drop REAL`;
  }).join('\n')}

## Drop-offs por Location (CRM)
${dropsByLocation.map((d: any) => `- ${d.location_id}: ${d.drops} drop-offs / ${d.apps} apps = ${d.rate}%`).join('\n')}

## Ad Spend detalle
${adSpend.map((s: any) => `- ${s.location_id}: "${s.campaign_name}" — $${s.spend} | ${s.impressions} imp | ${s.clicks} clicks | CPC $${s.clicks > 0 ? (s.spend/s.clicks).toFixed(2) : 'N/A'}`).join('\n')}
`);
  } else {
    parts.push(`## Ad Spend
⚠️ No hay datos de Google Ads. Sin spend no se puede calcular costo por drop-off.`);
  }

  return parts.join('\n');
}

// ── Generate briefing ──────────────────────────────────────────────
async function generateBriefing() {
  console.log('🧠 ACG Briefing Agent (Local Mode)\n');

  const context = buildContext();
  console.log(`  📊 Contexto: ${context.length} caracteres\n`);
  console.log(context.slice(0, 500) + '...\n');

  const systemPrompt = `Eres el analista de inteligencia de Auto Collision Group (ACG), 13 talleres de carrocería en California.

Tu trabajo: analizar datos de marketing y generar órdenes ejecutivas CONCISAS.

REGLAS:
1. Cada recomendación: MÁXIMO 2 frases. Una para el diagnóstico, una para la acción.
2. Números clave EN el título. Ej: "Covina: $696/drop — 14x Santa Ana, y bajando 15% esta semana"
3. Analiza TENDENCIAS: ¿está subiendo o bajando cada canal? Si un canal está cayendo, menciónalo.
4. Calls < 10s = spam. Calls > 60s = cliente real.
5. % de drop-off (drops/apps) = tasa de CONVERSIÓN. MÁS ALTO = MEJOR (más apps se convierten en drops). 42% es BUENO, 7% es PÉSIMO.
7. Prioriza por impacto financiero: lo que más dinero quema, primero.
8. Si ves una tendencia negativa acelerándose, severity = critical.
9. Genera ENTRE 8 Y 15 recomendaciones. Cubre TODAS las locations con problemas.
10. Incluye recomendaciones OPERACIONALES (no-show, arrival rate) y de MARKETING (pausar, escalar).
11. Una recomendación por location+cnal problemático. No agrupes.
12. Menciona GMB cuando sea relevante (canal gratuito de alta calidad).`;

  const userPrompt = `DATA DE ACG:

${context}

⚠️ IMPORTANTE: El costo por drop-off usa ATRIBUCIÓN PROPORCIONAL.
- Si un canal genera el X% de las llamadas en una location, se estima que genera ~X% de los drops.
- El "costo/drop REAL" es spend del canal ÷ drops estimados (NO todos los drops de la location).
- Un costo/drop REAL > $200 es MALO. > $400 es QUEMAR DINERO.
- Un costo/drop REAL < $100 es BUENO. < $50 es EXCELENTE.

Genera entre 8 y 15 recomendaciones. Cubre TODAS las locations con problemas.
Cada recomendación debe ser específica: location + canal + acción concreta.
Incluye problemas operacionales (no-show alto, arrival bajo) además de marketing.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      thinking: { type: 'disabled' },
      tool_choice: { type: 'tool', name: 'emitir_recomendaciones' },
      tools: [{
        name: 'emitir_recomendaciones',
        description: 'Emitir recomendaciones accionables basadas en datos de ACG',
        input_schema: {
          type: 'object',
          properties: {
            recomendaciones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['pause_channel', 'increase_budget', 'geo_opportunity', 'script_review', 'keyword_alert', 'funnel_leak', 'general'] },
                  location_id: { type: 'string' },
                  channel: { type: 'string' },
                  severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  supporting_data: {
                    type: 'object',
                    properties: {
                      spend: { type: 'number' },
                      llamadas: { type: 'number' },
                      duracion_media: { type: 'number' },
                      periodo: { type: 'string' },
                      comparacion: { type: 'string' },
                    },
                  },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                },
                required: ['type', 'severity', 'title', 'body', 'supporting_data', 'confidence'],
              },
            },
          },
          required: ['recomendaciones'],
        },
      }],
    });

    // Extract tool use
    const toolCalls = msg.content.filter(block => block.type === 'tool_use');
    let recommendations: any[] = [];

    if (toolCalls.length > 0) {
      const toolResult = toolCalls[0] as any;
      recommendations = toolResult.input?.recomendaciones || [];
    } else {
      // Fallback: extract text and create a general recommendation
      const textBlocks = msg.content.filter(block => block.type === 'text');
      const text = textBlocks.map((b: any) => b.text).join('\n');
      console.log('  📝 Claude respondió en texto (no tool):');
      console.log('  ' + text.slice(0, 500));

      if (text.length > 20) {
        recommendations = [{
          type: 'general',
          location_id: null,
          channel: null,
          severity: 'info',
          title: 'Análisis del Command Center',
          body: text.slice(0, 500),
          supporting_data: { periodo: '90 días' },
          confidence: 0.7,
        }];
      }
    }

    console.log(`  📝 ${recommendations.length} recomendaciones generadas\n`);

    // Guardar en SQLite local
    const insert = db.prepare(`
      INSERT INTO recommendations (generated_at, agent, type, location_id, channel, severity, title, body, supporting_data, confidence, status)
      VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `);

    let saved = 0;
    for (const rec of recommendations) {
      const r = insert.run(
        'briefing_local',
        rec.type,
        rec.location_id || null,
        rec.channel || null,
        rec.severity,
        rec.title,
        rec.body,
        JSON.stringify(rec.supporting_data || {}),
        rec.confidence || 0.5,
      );
      if (r.changes > 0) {
        saved++;
        const sev = rec.severity === 'critical' ? '🔴' : rec.severity === 'warning' ? '🟡' : '🔵';
        console.log(`  ${sev} [${rec.type}] ${rec.title}`);
        console.log(`     ${rec.body.slice(0, 150)}`);
      }
    }

    console.log(`\n✅ ${saved} recomendaciones guardadas en SQLite (dashboard visible)`);
    return recommendations;
  } catch (err: any) {
    console.error('❌ Briefing error:', err.message);
    // Guardar error como recommendation
    db.prepare(`
      INSERT INTO recommendations (agent, type, severity, title, body, supporting_data, confidence, status)
      VALUES ('briefing_local', 'general', 'info', '⚠️ Error del agente', ?, ?, 0, 'new')
    `).run(`El agente de briefing encontró un error: ${err.message}. Reintentar cuando haya más datos.`, '{}');
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('🧠 ACG Briefing Agent — Local Mode\n');
  await generateBriefing();
  console.log('\n🏁 Briefing completo. Revisa https://acg.tamgo.ai');
}

main().catch(console.error);
