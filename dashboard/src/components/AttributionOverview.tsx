import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AttributionOverview as AO, ChannelPerformance as CP, LocationLeader as LL, SourceGroup } from '../api';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface Props {
  days: number;
  onRefresh?: () => void;
}

// Channel colors consistent with the rest of the dashboard
const CHAN_COLORS: Record<string, string> = {
  google_ads: '#3b82f6', lsa: '#10b981', gmb: '#f59e0b',
  facebook: '#8b5cf6', call_center: '#ef4444', website: '#06b6d4',
  yelp: '#ef4444', manual: '#8a8aa0', twilio_voice: '#f59e0b',
  manual_dial: '#6b7280', gohighlevel: '#ec4899',
  'public booking': '#14b8a6', 'claim page intake': '#6366f1',
  'conversations - manual entry': '#a855f7',
  'service funnel': '#84cc16', 'ai_voice_call': '#06b6d4',
  twilio_sms: '#f97316', walk_in: '#78716c',
  liaison: '#d946ef', referral: '#22d3ee',
};

const SOURCE_COLORS: Record<string, string> = {
  'Manual Entry': '#8a8aa0',
  'Call Center': '#f59e0b',
  'LSA': '#10b981',
  'Google Ads': '#3b82f6',
  'Orgánico': '#8b5cf6',
  'Social': '#ec4899',
  'Otros': '#6366f1',
};

function formatCurrency(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function AttributionOverview({ days }: Props) {
  const [overview, setOverview] = useState<AO | null>(null);
  const [channels, setChannels] = useState<CP[]>([]);
  const [locations, setLocations] = useState<LL[]>([]);
  const [sources, setSources] = useState<SourceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'journeys' | 'drop_rate' | 'cost_per_drop'>('journeys');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getAttributionOverview(days),
      api.getChannelPerformance(days),
      api.getLocationLeaderboard(days),
      api.getAttributionSources(days),
    ]).then(([o, c, l, s]) => {
      setOverview(o);
      setChannels(c);
      setLocations(l);
      setSources(s);
    }).catch(console.error)
    .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#3b82f6', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const sortedLocs = [...locations].sort((a, b) => {
    if (sortKey === 'journeys') return b.journeys - a.journeys;
    if (sortKey === 'drop_rate') return b.drop_rate - a.drop_rate;
    return b.cost_per_drop - a.cost_per_drop;
  });

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Two-column layout: Channel Performance | Source Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Channel Performance */}
        <div className="lg:col-span-2 glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#e8e8f0' }}>Rendimiento por Canal</h3>
          <div className="space-y-2">
            {channels.map((ch) => {
              const maxJourneys = channels[0]?.journeys || 1;
              const barW = (ch.journeys / maxJourneys) * 100;
              const color = CHAN_COLORS[ch.channel] || '#6b7280';
              return (
                <div key={ch.channel} className="group">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium capitalize" style={{ color: '#d0d0e0' }}>{ch.channel.replace(/_/g, ' ')}</span>
                    <span className="font-mono" style={{ color: '#8a8aa0' }}>
                      {ch.journeys} leads · {ch.drop_offs} drops ·
                      <span style={{ color: ch.drop_rate > 35 ? '#10b981' : ch.drop_rate > 15 ? '#f59e0b' : '#ef4444' }}> {ch.drop_rate}%</span>
                    </span>
                  </div>
                  <div className="h-5 rounded-md overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2" style={{ width: `${Math.max(barW, 2)}%`, background: `linear-gradient(90deg, ${color}dd, ${color}88)` }}>
                      {barW > 15 && <span className="text-[9px] font-mono font-bold text-white/90">{ch.journeys}</span>}
                    </div>
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] font-mono" style={{ color: '#6a6a80' }}>
                    {ch.cost_per_drop > 0 && <span>💲{formatCurrency(ch.cost_per_drop)}/drop</span>}
                    {ch.cost_per_lead > 0 && <span>📊 {formatCurrency(ch.cost_per_lead)}/lead</span>}
                    {ch.total_spend > 0 && <span>💰 {formatCurrency(ch.total_spend)} spent</span>}
                  </div>
                </div>
              );
            })}
            {channels.length === 0 && <p className="text-xs text-center py-8" style={{ color: '#6a6a80' }}>Sin datos de canales para este período</p>}
          </div>
        </div>

        {/* Source Distribution */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#e8e8f0' }}>Origen de Leads</h3>
          <div className="space-y-3">
            {sources.map((s) => {
              const color = SOURCE_COLORS[s.source_group] || '#6b7280';
              return (
                <div key={s.source_group}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      <span style={{ color: '#d0d0e0' }}>{s.source_group}</span>
                    </div>
                    <span className="font-mono" style={{ color: '#8a8aa0' }}>{s.count} <span className="text-[10px]">({s.pct}%)</span></span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(s.pct, 2)}%`, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Location Leaderboard */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>📍 Leaderboard por Location</h3>
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.06)' }}>
            {(['journeys', 'drop_rate', 'cost_per_drop'] as const).map(k => (
              <button key={k} onClick={() => setSortKey(k)}
                className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-all"
                style={sortKey === k ? { background: 'rgba(59,130,246,0.15)', color: '#3b82f6' } : { color: '#6a6a80' }}
              >
                {k === 'journeys' ? 'Volumen' : k === 'drop_rate' ? '% Conv' : '$/Drop'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Location', 'Journeys', 'Drops', 'Conv %', 'Calls', 'Spend', 'Cost/Drop'].map(h => (
                  <th key={h} className="text-left py-2 px-3 font-medium uppercase tracking-wider" style={{ color: '#6a6a80' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedLocs.map((loc, i) => (
                <tr key={loc.location_id} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold w-5 h-5 rounded flex items-center justify-center" style={{ color: i < 3 ? '#f59e0b' : '#6a6a80', background: i < 3 ? 'rgba(245,158,11,0.1)' : 'transparent' }}>
                        {i + 1}
                      </span>
                      <span style={{ color: '#e8e8f0' }} className="font-medium">{loc.name || loc.location_id}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono" style={{ color: '#d0d0e0' }}>{loc.journeys}</td>
                  <td className="py-2.5 px-3 font-mono font-medium" style={{ color: '#e8e8f0' }}>{loc.drop_offs}</td>
                  <td className="py-2.5 px-3 font-mono">
                    <span style={{ color: loc.drop_rate > 35 ? '#10b981' : loc.drop_rate > 20 ? '#f59e0b' : '#ef4444' }}>
                      {loc.drop_rate}%
                      {loc.drop_rate > 35 ? <ArrowUpRight className="inline w-3 h-3 ml-0.5" /> : loc.drop_rate < 20 ? <ArrowDownRight className="inline w-3 h-3 ml-0.5" /> : null}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono" style={{ color: '#8a8aa0' }}>{loc.total_calls}</td>
                  <td className="py-2.5 px-3 font-mono" style={{ color: '#8a8aa0' }}>{formatCurrency(loc.total_spend)}</td>
                  <td className="py-2.5 px-3 font-mono font-semibold" style={{ color: loc.cost_per_drop > 500 ? '#ef4444' : '#10b981' }}>
                    {loc.cost_per_drop > 0 ? `$${loc.cost_per_drop.toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
