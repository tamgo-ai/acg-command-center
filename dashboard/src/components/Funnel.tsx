import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

interface FunnelStage {
  stage: string;
  count: number;
  pct: number;
  drop: string;
}

interface LocationFunnel {
  location_id: string;
  stages: FunnelStage[];
}

const STAGE_COLORS: Record<string, string> = {
  'Llamadas': '#3b82f6',
  'Citas': '#8b5cf6',
  'Llegaron': '#eab308',
  'Drop Offs': '#22c55e',
};

export function Funnel({ days = 90 }: { days?: number }) {
  const [funnels, setFunnels] = useState<LocationFunnel[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFunnelData();
  }, [days]);

  async function loadFunnelData() {
    setLoading(true);
    try {
      const funnelData = await api.getFunnel(days);

      if (!funnelData.calls || funnelData.calls.length === 0) {
        setLoading(false);
        return;
      }

      // Agrupar por location usando calls y appointments
      const byLocation = new Map<string, {
        calls: number;
        appointments: number;
        arrived: number;
        dropOffs: number;
      }>();

      for (const c of funnelData.calls) {
        const loc = c.location_id || 'unknown';
        if (!byLocation.has(loc)) {
          byLocation.set(loc, { calls: 0, appointments: 0, arrived: 0, dropOffs: 0 });
        }
        byLocation.get(loc)!.calls += c.calls;
      }

      for (const a of funnelData.appointments) {
        const loc = a.location_id || 'unknown';
        if (!byLocation.has(loc)) {
          byLocation.set(loc, { calls: 0, appointments: 0, arrived: 0, dropOffs: 0 });
        }
        const g = byLocation.get(loc)!;
        g.appointments += a.appointments;
        g.arrived += a.arrived;
        g.dropOffs += a.drop_offs;
      }

      const funnelsArr: LocationFunnel[] = [];
      for (const [loc, g] of byLocation) {
        const calls = g.calls;
        const apps = g.appointments;
        const arrived = g.arrived;
        const drops = g.dropOffs;

        funnelsArr.push({
          location_id: loc,
          stages: [
            { stage: 'Llamadas', count: calls, pct: 100, drop: '—' },
            {
              stage: 'Citas',
              count: apps,
              pct: calls > 0 ? (apps / calls) * 100 : 0,
              drop: calls > 0 ? `${((1 - apps / calls) * 100).toFixed(0)}%` : '—',
            },
            {
              stage: 'Llegaron',
              count: arrived,
              pct: apps > 0 ? (arrived / apps) * 100 : 0,
              drop: apps > 0 ? `${((1 - arrived / apps) * 100).toFixed(0)}%` : '—',
            },
            {
              stage: 'Drop Offs',
              count: drops,
              pct: arrived > 0 ? (drops / arrived) * 100 : 0,
              drop: arrived > 0 ? `${((1 - drops / arrived) * 100).toFixed(0)}%` : '—',
            },
          ],
        });
      }

      setFunnels(funnelsArr);
    } catch (err) {
      console.error('Error loading funnel:', err);
    } finally {
      setLoading(false);
    }
  }

  // Datos para el gráfico de barras (funnel de la location seleccionada o todas)
  const chartData = useMemo(() => {
    if (selectedLocation === 'all') {
      // Agregar todas
      const totals: Record<string, number> = { 'Llamadas': 0, 'Citas': 0, 'Llegaron': 0, 'Drop Offs': 0 };
      for (const f of funnels) {
        for (const s of f.stages) {
          totals[s.stage] += s.count;
        }
      }
      return Object.entries(totals).map(([stage, count]) => ({
        stage,
        count,
        fill: STAGE_COLORS[stage] || '#8888a0',
      }));
    }

    const funnel = funnels.find(f => f.location_id === selectedLocation);
    if (!funnel) return [];
    return funnel.stages.map(s => ({
      stage: s.stage,
      count: s.count,
      fill: STAGE_COLORS[s.stage] || '#8888a0',
    }));
  }, [selectedLocation, funnels]);

  const selectedFunnel = selectedLocation === 'all'
    ? null
    : funnels.find(f => f.location_id === selectedLocation);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Embudo de Conversión</h2>
          <p className="text-sm text-[#8888a0] mt-1">
            Impresión → Llamada → Cita → Llegó → Drop Off
          </p>
        </div>
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="bg-[#1a1a2e] border border-[#2a2a3e] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#3b82f6]"
        >
          <option value="all">Todas las locations</option>
          {funnels.map(f => (
            <option key={f.location_id} value={f.location_id}>
              {f.location_id.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Gráfico de barras */}
      <div className="glass-card p-6">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" horizontal={false} />
              <XAxis type="number" stroke="#8888a0" tick={{ fill: '#8888a0', fontSize: 12 }} />
              <YAxis type="category" dataKey="stage" stroke="#8888a0" tick={{ fill: '#e8e8ed', fontSize: 13 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #2a2a3e',
                  borderRadius: '8px',
                  color: '#e8e8ed',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [String(value), 'Cantidad']}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={32}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-12 text-[#8888a0]">Sin datos para mostrar</div>
        )}
      </div>

      {/* Tabla de detalle por etapa */}
      {selectedFunnel && (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2a2a3e]">
                <th className="p-3 text-left text-xs font-medium text-[#8888a0] uppercase">Etapa</th>
                <th className="p-3 text-right text-xs font-medium text-[#8888a0] uppercase">Cantidad</th>
                <th className="p-3 text-right text-xs font-medium text-[#8888a0] uppercase">% de anterior</th>
                <th className="p-3 text-right text-xs font-medium text-[#8888a0] uppercase">Caída</th>
              </tr>
            </thead>
            <tbody>
              {selectedFunnel.stages.map((s, i) => (
                <tr key={s.stage} className="border-b border-[#2a2a3e]/50">
                  <td className="p-3 text-sm text-white">{s.stage}</td>
                  <td className="p-3 text-sm text-right font-mono text-[#e8e8ed]">{s.count}</td>
                  <td className="p-3 text-sm text-right font-mono text-[#8888a0]">
                    {i === 0 ? '—' : `${s.pct.toFixed(1)}%`}
                  </td>
                  <td className={`p-3 text-sm text-right font-mono ${
                    i === 0 ? 'text-[#8888a0]' :
                    parseFloat(s.drop) > 50 ? 'text-[#ef4444]' :
                    parseFloat(s.drop) > 30 ? 'text-[#eab308]' :
                    'text-[#22c55e]'
                  }`}>
                    {s.drop}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
