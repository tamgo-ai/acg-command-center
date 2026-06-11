// ACG Command Center — Briefing Agent (Orquestador)
// Junta las señales de todos los agentes y redacta el briefing diario/semanal
// en español, en la voz de Raúl. Cada recomendación cita sus números.
// Usa Claude para razonar, pero siempre con grounding estricto.

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';
import { z } from 'zod';

// ── Structured Output Schema ──────────────────────────────────────
const RecommendationSchema = z.object({
  type: z.enum([
    'pause_channel',
    'increase_budget',
    'geo_opportunity',
    'script_review',
    'keyword_alert',
    'funnel_leak',
    'general',
  ]),
  location_id: z.string().nullable(),
  channel: z.string().nullable(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  body: z.string(),           // en español, estilo directo de Raúl
  supporting_data: z.object({
    spend: z.number().optional(),
    drop_offs: z.number().optional(),
    costo_por_drop_off: z.number().optional(),
    llamadas: z.number().optional(),
    appointments: z.number().optional(),
    tasa_conversion: z.number().optional(),
    comparacion: z.string().optional(),  // contexto: "30% más caro que el promedio"
    periodo: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
});

type Recommendation = z.infer<typeof RecommendationSchema>;

// ── Builder ───────────────────────────────────────────────────────
async function buildContext(supabase: ReturnType<typeof getSupabase>): Promise<string> {
  // Recolectar toda la data que el agente necesita para razonar

  // Métricas
  const { data: metrics } = await supabase
    .from('metric_cache')
    .select('*')
    .order('computed_at', { ascending: false })
    .limit(200);

  // Journeys recientes
  const { data: journeys } = await supabase
    .from('customer_journey')
    .select('*')
    .gte('last_touch_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order('last_touch_at', { ascending: false })
    .limit(500);

  // Ad spend reciente
  const { data: adSpend } = await supabase
    .from('ad_spend')
    .select('*')
    .gte('date', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(200);

  // Locations
  const { data: locations } = await supabase
    .from('locations')
    .select('*')
    .eq('active', true);

  // Agregaciones calculadas
  const locationChannelStats: Record<string, any> = {};

  if (journeys && adSpend) {
    // Agrupar journeys por location × channel
    const journeyGroups = new Map<string, { dropOffs: number; appointments: number; calls: number }>();
    for (const j of journeys) {
      const key = `${j.attributed_location || '?'}|${j.attributed_channel || '?'}`;
      if (!journeyGroups.has(key)) journeyGroups.set(key, { dropOffs: 0, appointments: 0, calls: 0 });
      const g = journeyGroups.get(key)!;
      if (j.drop_off) g.dropOffs++;
      if (j.appointment_id) g.appointments++;
      if (j.touchpoints?.length) g.calls += j.touchpoints.filter((t: any) => t.type === 'call').length;
    }

    // Cruzar con spend
    for (const [key, stats] of journeyGroups) {
      const [loc, chan] = key.split('|');
      const spendTotal = adSpend
        .filter(s => s.location_id === loc && s.channel === chan)
        .reduce((sum, s) => sum + Number(s.spend || 0), 0);

      locationChannelStats[key] = {
        location: loc,
        channel: chan,
        spend: spendTotal,
        dropOffs: stats.dropOffs,
        appointments: stats.appointments,
        calls: stats.calls,
        costoPorDropOff: stats.dropOffs > 0 ? spendTotal / stats.dropOffs : null,
        conversionRate: stats.calls > 0 ? stats.dropOffs / stats.calls : null,
      };
    }
  }

  // Construir el contexto para Claude
  const contextParts: string[] = [];

  contextParts.push(`# DATA PARA BRIEFING — ACG Command Center

## Locations activas (${locations?.length || 0})
${locations?.map(l => `- ${l.location_id}: ${l.name} (${l.city})`).join('\n') || 'No data'}

## Métricas por Location × Canal (últimos 90 días)
${Object.entries(locationChannelStats).map(([key, s]: [string, any]) => {
    const emoji = s.costoPorDropOff === null ? '⚪' :
      s.costoPorDropOff < 100 ? '🟢' :
      s.costoPorDropOff < 200 ? '🟡' : '🔴';
    return `${emoji} ${key}: $${s.spend.toFixed(0)} spend → ${s.dropOffs} Drop Offs → $${s.costoPorDropOff?.toFixed(0) || 'N/A'}/Drop Off | ${s.calls} llamadas | ${s.appointments} citas`;
  }).join('\n') || 'No data'}

## Ad Spend reciente
${adSpend?.slice(0, 20).map(s => `- ${s.date} | ${s.channel} | ${s.location_id} | $${s.spend} spend | ${s.impressions} imp | ${s.clicks} clicks`).join('\n') || 'No data'}

## Journeys recientes (muestra)
${journeys?.slice(0, 10).map(j => `- ${j.customer_phone} | ${j.attributed_channel} → ${j.attributed_location} | Drop Off: ${j.drop_off ? 'SÍ' : 'NO'} | Confianza: ${(j.confidence * 100).toFixed(0)}%`).join('\n') || 'No data'}
`);

  return contextParts.join('\n');
}

// ── Briefing Agent ─────────────────────────────────────────────────
async function generateBriefing(): Promise<Recommendation[]> {
  const config = getConfig();
  const supabase = getSupabase();
  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  console.log('🧠 Generando briefing...\n');

  // 1. Construir contexto
  const context = await buildContext(supabase);
  console.log(`  📊 Contexto: ${context.length} caracteres\n`);

  // 2. Llamar a Claude
  const systemPrompt = `Eres el Agente Orquestador del Centro de Comando de Auto Collision Group (ACG).
Tu trabajo es analizar la data del negocio y generar recomendaciones accionables,
en español, con el estilo directo y sin rodeos de Raúl Domínguez.

REGLAS DE ORO:
1. Toda recomendación DEBE citar números exactos en supporting_data. Si no hay números, no emitas la recomendación.
2. No uses métricas de vanidad. La única métrica que importa es Drop Offs y costo por Drop Off. Un canal con 100 llamadas y 2 Drop Offs vale MENOS que uno con 20 llamadas y 8 Drop Offs.
3. Si la data es insuficiente (< 30 días o < 5 interacciones), dilo: "Data insuficiente para concluir".
4. Sé prescriptivo: no digas qué pasó, di qué HACER.
5. Voz de Raúl: directo, en español, sin rodeos. "Pausa esto", "Sube aquí", "Revisa aquello".
6. Prioriza por plata: lo que más dinero está quemando primero.
7. Máximo 8 recomendaciones. Calidad sobre cantidad.

TIPOS DE RECOMENDACIONES:
- pause_channel: canal quemando plata sin Drop Offs
- increase_budget: canal eficiente con espacio para crecer
- geo_opportunity: location/zona con potencial no explotado
- script_review: muchas llamadas, pocos Drop Offs → posible problema de guión
- funnel_leak: caída anormal en alguna etapa del embudo
- keyword_alert: keyword costosa que la competencia domina orgánico (v2)
- general: insight importante que no encaja en las anteriores

SEVERIDAD:
- critical: está quemando >$500/mes sin Drop Offs, o tendencia negativa fuerte
- warning: ineficiencia notable, requiere atención pronto
- info: oportunidad u observación

CONFIDENCE: 0.0 a 1.0. Si los números son sólidos (match por teléfono, múltiples touchpoints, volumen suficiente), confianza alta. Si es source_field o hay pocos datos, confianza baja.`;

  const userPrompt = `Analiza esta data de ACG y genera recomendaciones accionables.

${context}

Genera máximo 8 recomendaciones. Cada una debe tener números de respaldo en supporting_data.
Si un canal tiene $0 de spend es porque no hemos ingerido esa data — ignóralo.
Concéntrate en los canales con spend > 0 Y drop_offs registrados.`;

  // 3. Structured output con tool use
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{
      name: 'emitir_recomendaciones',
      description: 'Emitir recomendaciones accionables basadas en la data analizada',
      input_schema: {
        type: 'object',
        properties: {
          recomendaciones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['pause_channel', 'increase_budget', 'geo_opportunity', 'script_review', 'keyword_alert', 'funnel_leak', 'general'] },
                location_id: { type: 'string', nullable: true },
                channel: { type: 'string', nullable: true },
                severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                title: { type: 'string' },
                body: { type: 'string' },
                supporting_data: {
                  type: 'object',
                  properties: {
                    spend: { type: 'number' },
                    drop_offs: { type: 'number' },
                    costo_por_drop_off: { type: 'number' },
                    llamadas: { type: 'number' },
                    appointments: { type: 'number' },
                    tasa_conversion: { type: 'number' },
                    comparacion: { type: 'string' },
                    periodo: { type: 'string' },
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

  // 4. Extraer y validar
  const toolCalls = msg.content.filter(block => block.type === 'tool_use');
  if (toolCalls.length === 0) {
    console.log('  ⚠️  Claude no devolvió recomendaciones estructuradas');
    console.log('  Respuesta:', msg.content[0]?.type === 'text' ? msg.content[0].text : 'N/A');
    return [];
  }

  const toolResult = toolCalls[0] as any;
  const recommendations: Recommendation[] = toolResult.input?.recomendaciones || [];

  console.log(`  📝 ${recommendations.length} recomendaciones generadas\n`);

  // 5. Guardar en Supabase
  let saved = 0;
  for (const rec of recommendations) {
    const { error } = await supabase.from('recommendations').insert({
      agent: 'briefing_orchestrator',
      type: rec.type,
      location_id: rec.location_id,
      channel: rec.channel,
      severity: rec.severity,
      title: rec.title,
      body: rec.body,
      supporting_data: rec.supporting_data,
      confidence: rec.confidence,
      status: 'new',
    });

    if (error) {
      console.error(`  ⚠️  Error guardando recomendación: ${error.message}`);
    } else {
      saved++;
      const sev = rec.severity === 'critical' ? '🔴' : rec.severity === 'warning' ? '🟡' : '🔵';
      console.log(`  ${sev} [${rec.type}] ${rec.title}`);
      console.log(`     ${rec.body}`);
      if (rec.supporting_data.costo_por_drop_off) {
        console.log(`     $${rec.supporting_data.costo_por_drop_off.toFixed(0)}/Drop Off | ${rec.supporting_data.drop_offs} Drops | Confianza: ${(rec.confidence * 100).toFixed(0)}%`);
      }
      console.log();
    }
  }

  console.log(`✅ ${saved} recomendaciones guardadas en recommendations`);
  return recommendations;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('🧠 ACG Briefing Agent\n');
  try {
    await generateBriefing();
  } catch (err: any) {
    console.error(`❌ Briefing falló: ${err.message}`);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
