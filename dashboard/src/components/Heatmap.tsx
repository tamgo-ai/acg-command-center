import { useMemo } from 'react';
import type { LocationChannelStat } from '../App';
import type { Location } from '../api';

interface HeatmapProps {
  stats: LocationChannelStat[];
  locations?: Location[];
}

function getColorByVolume(count: number, maxCount: number): string {
  if (count === 0) return 'bg-[#12121e] text-[#444]';
  const ratio = count / (maxCount || 1);
  if (ratio >= 0.7) return 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/25';
  if (ratio >= 0.4) return 'bg-[#10b981]/10 text-[#34d399] border border-[#10b981]/15';
  if (ratio >= 0.2) return 'bg-[#eab308]/10 text-[#eab308] border border-[#eab308]/15';
  if (ratio >= 0.05) return 'bg-[#f59e0b]/8 text-[#fbbf24] border border-[#f59e0b]/10';
  return 'bg-[#12121e] text-[#555] border border-transparent';
}

function getColorByCost(costo: number): string {
  if (costo < 50) return 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/25';
  if (costo < 100) return 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/25';
  if (costo < 150) return 'bg-[#eab308]/10 text-[#eab308] border border-[#eab308]/20';
  if (costo < 250) return 'bg-[#f59e0b]/12 text-[#f59e0b] border border-[#f59e0b]/20';
  if (costo < 400) return 'bg-[#ef4444]/12 text-[#f87171] border border-[#ef4444]/20';
  return 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30';
}

export function Heatmap({ stats, locations }: HeatmapProps) {
  const hasSpendData = stats.some(s => s.spend > 0);

  const { locs, channels, matrix, maxCalls } = useMemo(() => {
    const orderedLocs = locations?.map(l => l.location_id) || [];
    const locsFromStats = [...new Set(stats.map(s => s.location_id))].sort();
    const locs = [...new Set([...orderedLocs, ...locsFromStats])];

    const orderedChans = ['google_ads', 'lsa', 'gmb', 'facebook', 'yelp', 'website'];
    const allChans = [...new Set(stats.map(s => s.channel))].sort();
    const chans = [...new Set([...orderedChans.filter(c => allChans.includes(c)), ...allChans.filter(c => !orderedChans.includes(c))])];

    const mat = new Map<string, LocationChannelStat>();
    let maxC = 1;
    for (const s of stats) {
      mat.set(`${s.location_id}|${s.channel}`, s);
      if (s.llamadas > maxC) maxC = s.llamadas;
    }

    return { locs, channels: chans, matrix: mat, maxCalls: maxC };
  }, [stats, locations]);

  if (stats.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <h2 className="text-xl font-semibold text-[#d0d0e0] mb-2">Mapa de Calor — Sin datos</h2>
        <p className="text-sm text-[#8a8aa0]">Ejecuta la ingesta de Twilio para ver llamadas por location × canal.</p>
      </div>
    );
  }

  const title = hasSpendData
    ? 'Mapa de Calor: Costo por Drop-Off + Volumen de Llamadas'
    : 'Mapa de Calor: Llamadas por Location × Canal (90 días)';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-[#e8e8f0]">{title}</h2>
        <p className="text-xs text-[#8a8aa0] mt-1 font-mono uppercase tracking-wider">
          {hasSpendData
            ? 'Google Ads = $/drop | resto de canales = volumen de llamadas'
            : 'Verde = más llamadas, rojo = menos'}
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-[#8a8aa0]">
        <span className="text-[#8a8aa0] uppercase tracking-wider">Volumen:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#10b981]/15 border border-[#10b981]/25" /> Alto</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#eab308]/10 border border-[#eab308]/15" /> Medio</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#12121e]" /> Bajo</span>
        {hasSpendData && (
          <>
            <span className="ml-2 text-[#8a8aa0] uppercase tracking-wider">Google Ads $/drop:</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#10b981]/15 border border-[#10b981]/25" /> &lt;$50</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#eab308]/10 border border-[#eab308]/20" /> $50–150</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#ef4444]/12 border border-[#ef4444]/20" /> &gt;$250</span>
          </>
        )}
      </div>

      {/* Grid */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="p-3 text-left text-[10px] font-medium text-[#8a8aa0] uppercase tracking-wider border-b border-[rgba(255,255,255,0.06)] sticky left-0 bg-[#0c0c18]/95 backdrop-blur-md">
                Location
              </th>
              {channels.map(chan => (
                <th key={chan} className={`p-3 text-center text-[10px] font-medium uppercase tracking-wider border-b border-[rgba(255,255,255,0.06)] min-w-[105px] ${
                  chan === 'google_ads' && hasSpendData ? 'text-[#60a5fa]' : 'text-[#8a8aa0]'
                }`}>
                  {chan === 'google_ads' ? 'Google Ads' : chan === 'gmb' ? 'GMB' : chan === 'lsa' ? 'LSA' : chan.replace(/_/g, ' ')}
                  {chan === 'google_ads' && hasSpendData && <span className="block text-[8px] opacity-60">$/drop</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locs.map(loc => (
              <tr key={loc} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <td className="p-3 text-sm font-medium text-[#d0d0e0] capitalize sticky left-0 bg-[#06060c]/95 backdrop-blur-md z-10">
                  {loc.replace(/_/g, ' ')}
                </td>
                {channels.map(chan => {
                  const key = `${loc}|${chan}`;
                  const stat = matrix.get(key);
                  const isGA = chan === 'google_ads';
                  const showCost = hasSpendData && isGA && stat?.costo_por_drop_off != null;

                  const colorClass = showCost
                    ? getColorByCost(stat!.costo_por_drop_off!)
                    : getColorByVolume(stat?.llamadas ?? 0, maxCalls);

                  return (
                    <td key={chan} className="p-1.5 text-center">
                      <div className={`rounded-lg px-2 py-2 ${colorClass} transition-all hover:scale-105 cursor-default min-h-[72px] flex flex-col justify-center`}>
                        {/* Línea 1: Calls (SIEMPRE, número grande) */}
                        {stat && stat.llamadas > 0 ? (
                          <>
                            <div className="text-sm font-bold font-mono leading-tight">
                              {stat.llamadas.toLocaleString()}
                            </div>
                            <div className="text-[9px] opacity-50 font-mono leading-tight">
                              calls
                            </div>
                            {/* Línea 2: Costo/drop si hay spend */}
                            {showCost && (
                              <div className={`text-xs font-bold font-mono leading-tight mt-0.5`}>
                                ${Number(stat!.costo_por_drop_off).toLocaleString()}
                                <span className="text-[8px] opacity-50">/drop</span>
                              </div>
                            )}
                            {/* Línea 3: Drops estimados */}
                            {showCost && (stat as any).estimated_drops > 0 && (
                              <div className="text-[8px] opacity-40 font-mono leading-tight">
                                ~{(stat as any).estimated_drops} drops
                              </div>
                            )}
                            {/* Para celdas sin spend: mostrar avg duration */}
                            {!showCost && (
                              <div className="text-[9px] opacity-40 font-mono leading-tight mt-0.5">
                                {(stat as any).avg_duration || '?'}s
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-xs text-[#333] font-mono">—</div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
