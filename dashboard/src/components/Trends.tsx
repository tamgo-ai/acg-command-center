import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area
} from 'recharts';

interface TrendsData {
  byChannel: any[];
  dailyTotal: any[];
  weekly: any[];
  dropsMonthly: any[];
  spendMonthly: any[];
}

const CHANNEL_COLORS: Record<string, string> = {
  google_ads: '#3b82f6',
  lsa: '#10b981',
  gmb: '#f59e0b',
  facebook: '#8b5cf6',
  yelp: '#ef4444',
  website: '#06b6d4',
};

export function Trends({ days = 60 }: { days?: number }) {
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadTrends(); }, [days]);

  async function loadTrends() {
    setLoading(true);
    try {
      const res = await fetch(`/api/trends?days=${days}`);
      const d = await res.json();
      setData(d);
    } catch (err) {
      console.error('Error loading trends:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || !data.dailyTotal || data.dailyTotal.length === 0) {
    return (
      <div className="glass-card p-14 text-center">
        <h2 className="text-xl font-semibold text-[#d0d0e0] mb-2">Sin datos de tendencias</h2>
        <p className="text-sm text-[#8a8aa0]">Ejecuta la ingesta de Twilio para ver tendencias temporales.</p>
      </div>
    );
  }

  // Prepare channel data for stacked bars
  const channelNames = [...new Set(data.byChannel.map((r: any) => r.channel))] as string[];

  // Pivot weekly data - convert week numbers to readable dates
  const weeks = [...new Set(data.weekly.map((r: any) => r.week))] as string[];
  const weeklyPivot = weeks.map(week => {
    // Parse "2026-W22" to a readable label
    const parts = week.split('-W');
    const year = parts[0];
    const weekNum = parseInt(parts[1]);
    // Approximate: week 1 = Jan 1, each week = 7 days
    const jan1 = new Date(parseInt(year), 0, 1);
    const date = new Date(jan1.getTime() + (weekNum - 1) * 7 * 86400000);
    const label = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });

    const row: any = { week: label };
    for (const ch of channelNames) {
      const found = data.weekly.find((r: any) => r.week === week && r.channel === ch);
      row[ch] = found ? found.calls : 0;
    }
    return row;
  });

  // Pivot monthly drops for stacked bar
  const months = [...new Set(data.dropsMonthly.map((r: any) => r.month))] as string[];
  const topLocs = ['santa_ana', 'ontario', 'fresno', 'victorville', 'gardena_2'];
  const dropsPivot = months.map(month => {
    const row: any = { month };
    for (const loc of topLocs) {
      const found = data.dropsMonthly.filter((r: any) => r.month === month && r.location_id === loc);
      const total = found.reduce((s: number, r: any) => s + r.drops, 0);
      row[loc] = total;
    }
    return row;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-xl font-semibold text-[#e8e8f0]">Tendencias</h2>
        <p className="text-xs text-[#8a8aa0] mt-1 font-mono uppercase tracking-wider">
          Últimos 60 días — inbound calls only
        </p>
      </div>

      {/* Daily calls trend */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-[#d0d0e0] mb-4">Llamadas Diarias (Inbound)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.dailyTotal}>
            <defs>
              <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }}
              tickFormatter={(v: string) => v.substring(5)} />
            <YAxis stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }} width={40} />
            <Tooltip contentStyle={{
              background: '#0c0c18', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px', color: '#e8e8f0', fontFamily: 'JetBrains Mono', fontSize: '12px'
            }} />
            <Area type="monotone" dataKey="total_calls" stroke="#3b82f6" fill="url(#callGrad)" strokeWidth={2}
              name="Calls" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly by channel */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-[#d0d0e0] mb-4">Llamadas por Canal (Semanal)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weeklyPivot}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="week" stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }} />
            <YAxis stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }} width={30} />
            <Tooltip contentStyle={{
              background: '#0c0c18', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px', color: '#e8e8f0', fontFamily: 'JetBrains Mono', fontSize: '11px'
            }} />
            {channelNames.map(ch => (
              <Bar key={ch} dataKey={ch} stackId="a" fill={CHANNEL_COLORS[ch] || '#8888a0'}
                name={ch.replace(/_/g, ' ')} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-3 justify-center">
          {channelNames.map(ch => (
            <div key={ch} className="flex items-center gap-1.5 text-[10px] text-[#8a8aa0]">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHANNEL_COLORS[ch] || '#888' }} />
              {ch.replace(/_/g, ' ')}
            </div>
          ))}
        </div>
      </div>

      {/* Drop-offs monthly by top locations */}
      {dropsPivot.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-[#d0d0e0] mb-4">Drop-offs Mensuales por Location</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dropsPivot}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }}
                tickFormatter={(v: string) => v.substring(2)} />
              <YAxis stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }} width={30} />
              <Tooltip contentStyle={{
                background: '#0c0c18', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px', color: '#e8e8f0', fontFamily: 'JetBrains Mono', fontSize: '11px'
              }} />
              {topLocs.map((loc, i) => (
                <Bar key={loc} dataKey={loc} fill={['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'][i]}
                  name={loc.replace(/_/g, ' ')} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Spend monthly */}
      {data.spendMonthly && data.spendMonthly.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-[#d0d0e0] mb-4">Ad Spend Mensual</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={(() => {
              const months = [...new Set(data.spendMonthly.map((r: any) => r.month))];
              return months.map(m => {
                const row: any = { month: m };
                for (const ch of ['google_ads', 'facebook', 'lsa']) {
                  const f = data.spendMonthly.find((r: any) => r.month === m && r.channel === ch);
                  row[ch] = f ? Math.round(f.spend) : 0;
                }
                row.total = (row.google_ads || 0) + (row.facebook || 0);
                return row;
              });
            })()}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }}
                tickFormatter={(v: string) => v.substring(2)} />
              <YAxis stroke="#8a8aa0" tick={{ fill: '#8a8aa0', fontSize: 10 }} width={40}
                tickFormatter={(v: number) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
              <Tooltip contentStyle={{
                background: '#0c0c18', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px', color: '#e8e8f0', fontFamily: 'JetBrains Mono', fontSize: '11px'
              }} formatter={(v: any) => '$' + (typeof v === 'number' ? v.toLocaleString() : String(v))} />
              <Bar dataKey="google_ads" fill="#3b82f6" name="Google Ads" />
              <Bar dataKey="facebook" fill="#8b5cf6" name="Facebook" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
