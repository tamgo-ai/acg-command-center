// ACG Command Center — Métricas Canónicas
// Capa semántica: calcula las métricas UNA SOLA VEZ.
// Todos los agentes beben de metric_cache, no calculan por su cuenta.
// Esto evita que dos agentes den números diferentes para lo mismo.

import { getConfig } from '../config';
import { getSupabase } from '../config/supabase';

interface MetricDef {
  name: string;
  description: string;
  compute: (supabase: ReturnType<typeof getSupabase>) => Promise<void>;
}

// ── Definiciones Canónicas ────────────────────────────────────────

const METRICS: MetricDef[] = [
  {
    name: 'costo_por_drop_off',
    description: 'Costo por Drop Off segmentado por location y canal',
    compute: async (supabase) => {
      // Por location × canal: total spend / total drop offs
      const { data, error } = await supabase.rpc('compute_costo_por_drop_off');

      if (error) {
        // Si la RPC no existe, calcular directo con SQL
        const { data: raw } = await supabase.from('customer_journey').select(`
          attributed_location,
          attributed_channel,
          drop_off
        `);

        if (!raw) return;

        // Agrupar manualmente
        const groups = new Map<string, { dropOffs: number; spend: number }>();
        for (const r of raw) {
          if (!r.attributed_location || !r.attributed_channel) continue;
          const key = `${r.attributed_location}|${r.attributed_channel}`;
          if (!groups.has(key)) groups.set(key, { dropOffs: 0, spend: 0 });
          const g = groups.get(key)!;
          if (r.drop_off) g.dropOffs++;
        }

        // Obtener spend de ad_spend
        const { data: spendData } = await supabase.from('ad_spend').select('*');

        if (spendData) {
          for (const s of spendData) {
            const key = `${s.location_id}|${s.channel}`;
            const g = groups.get(key);
            if (g) g.spend += Number(s.spend || 0);
          }
        }

        // Insertar en metric_cache
        for (const [key, val] of groups) {
          const [locationId, channel] = key.split('|');
          const costoPorDropOff = val.dropOffs > 0 ? val.spend / val.dropOffs : null;

          await supabase.from('metric_cache').upsert({
            metric_name: 'costo_por_drop_off',
            location_id: locationId,
            channel,
            period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            period_end: new Date().toISOString().split('T')[0],
            metric_value: costoPorDropOff,
            numerator: val.spend,
            denominator: val.dropOffs,
            computed_at: new Date().toISOString(),
          }, { onConflict: 'metric_name,location_id,channel,period_start,period_end' });
        }
      }
    },
  },

  {
    name: 'tasa_conversion',
    description: 'Tasa de conversión por etapa del embudo — por location',
    compute: async (supabase) => {
      const { data: journeys } = await supabase.from('customer_journey').select('*');

      if (!journeys) return;

      const byLocation = new Map<string, { total: number; dropOffs: number; appointments: number }>();
      for (const j of journeys) {
        const loc = j.attributed_location || 'unknown';
        if (!byLocation.has(loc)) byLocation.set(loc, { total: 0, dropOffs: 0, appointments: 0 });
        const g = byLocation.get(loc)!;
        g.total++;
        if (j.appointment_id) g.appointments++;
        if (j.drop_off) g.dropOffs++;
      }

      for (const [loc, val] of byLocation) {
        const conversionRate = val.appointments > 0 ? val.dropOffs / val.appointments : 0;

        await supabase.from('metric_cache').upsert({
          metric_name: 'tasa_conversion',
          location_id: loc,
          channel: null,
          period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          period_end: new Date().toISOString().split('T')[0],
          metric_value: conversionRate,
          numerator: val.dropOffs,
          denominator: val.appointments,
          computed_at: new Date().toISOString(),
        }, { onConflict: 'metric_name,location_id,channel,period_start,period_end' });
      }
    },
  },
];

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('📐 Calculando métricas canónicas...\n');
  const supabase = getSupabase();

  for (const metric of METRICS) {
    console.log(`  📏 ${metric.name}: ${metric.description}`);
    try {
      await metric.compute(supabase);
      console.log(`  ✅ ${metric.name} — OK`);
    } catch (err: any) {
      console.error(`  ❌ ${metric.name} — ${err.message}`);
    }
  }

  console.log('\n✅ Métricas actualizadas');
}

main().catch(console.error);
