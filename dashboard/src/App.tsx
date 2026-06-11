import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { RecommendationFeed } from './components/RecommendationFeed';
import { Heatmap } from './components/Heatmap';
import { Funnel } from './components/Funnel';
import { Trends } from './components/Trends';
import { Sidebar } from './components/Sidebar';
import { LegalAIView } from './components/LegalAIView';
import AttributionOverview from './components/AttributionOverview';
import { api, type Recommendation, type Location } from './api';

export interface LocationChannelStat {
  location_id: string;
  channel: string;
  spend: number;
  drop_offs: number;
  estimated_drops: number;
  costo_por_drop_off: number | null;
  llamadas: number;
  avg_duration: number;
  appointments: number;
  conversion_rate: number | null;
}

type View = 'feed' | 'attribution' | 'heatmap' | 'funnel' | 'trends' | 'crashintel' | 'legalai';
type Period = { label: string; days: number };

const PERIODS: Period[] = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'TODO', days: 730 },
];

function App() {
  const [activeView, setActiveView] = useState<View>('feed');
  const [period, setPeriod] = useState<Period>(PERIODS[1]); // default 90D
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [stats, setStats] = useState<LocationChannelStat[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [kpis, setKpis] = useState<{
    journeys: number; attrRate: number; spend: number; dropRate: number; drops: number; costDrop: number;
    calls: number; msgs: number;
  }>({ journeys: 0, attrRate: 0, spend: 0, dropRate: 0, drops: 0, costDrop: 0, calls: 0, msgs: 0 });
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLocal, setIsLocal] = useState(true);

  useEffect(() => { loadData(); }, [period]);

  async function loadData() {
    setLoading(true);
    const d = period.days;
    try {
      setIsLocal(api.isLocal);

      const [recs, heatmap, locs, attrOverview] = await Promise.all([
        api.getRecommendations(),
        api.getHeatmap(d),
        api.getLocations(),
        api.getAttributionOverview(d),
      ]);

      setRecommendations(recs);
      setLocations(locs);

      // KPI totals
      let totalCalls = 0;
      const statsArr: LocationChannelStat[] = (heatmap.data || []).map((h: any) => {
        totalCalls += (h.call_count || 0);
        return {
          location_id: h.location_id,
          channel: h.channel,
          spend: h.total_spend || 0,
          drop_offs: h.drop_offs || 0,
          estimated_drops: h.estimated_drops || 0,
          costo_por_drop_off: h.costo_por_drop_off || null,
          llamadas: h.call_count || 0,
          avg_duration: h.avg_duration || 0,
          appointments: h.appointments || 0,
          conversion_rate: null,
        };
      });
      setStats(statsArr);

      // Unified KPIs from attribution overview (single source of truth)
      try {
        const statsRes = await fetch(`/api/stats?days=${d}`);
        const statsData = await statsRes.json();
        setKpis({
          journeys: attrOverview.total_journeys,
          attrRate: attrOverview.attribution_rate,
          spend: attrOverview.total_spend,
          dropRate: attrOverview.drop_rate,
          drops: statsData.drop_offs || 0,
          costDrop: Number(attrOverview.cost_per_drop) || 0,
          calls: totalCalls,
          msgs: statsData.total_messages || 0,
        });
      } catch {
        setKpis({ journeys: 0, attrRate: 0, spend: 0, dropRate: 0, drops: 0, costDrop: 0, calls: 0, msgs: 0 });
      }

      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(id: number, status: Recommendation['status']) {
    setRecommendations(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  }

  return (
    <div className="flex h-screen bg-[#06060c] text-[#e8e8f0] overflow-hidden relative">
      {/* Background Layers */}
      <div className="grid-bg" />
      <div className="particle-layer">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 7}s`,
              animationDuration: `${5 + Math.random() * 7}s`,
            }}
          />
        ))}
      </div>

      {/* Sidebar */}
      <Sidebar activeView={activeView} onNavigate={setActiveView} onDataImported={loadData} />

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        <Header lastUpdate={lastUpdate} onRefresh={loadData} loading={loading} isLocal={isLocal}
          period={period} periods={PERIODS} onPeriodChange={setPeriod} />

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* KPI Bar — Unified from customer_journey */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Journeys" value={kpis.journeys.toLocaleString()} icon="🔑" delay={0} color="#3b82f6" />
            <KpiCard label="Atribución" value={`${kpis.attrRate}%`} icon="🎯" delay={0.05} color="#10b981" />
            <KpiCard label="Ad Spend" value={`$${Number(kpis.spend).toLocaleString()}`} icon="💰" delay={0.1} color="#f59e0b" />
            <KpiCard label="Conversión" value={`${kpis.dropRate}%`} icon="📈" delay={0.15} color={kpis.dropRate > 30 ? '#10b981' : '#ef4444'} />
            <KpiCard label="Drop Offs" value={kpis.drops.toLocaleString()} icon="🚗" delay={0.2} color="#8b5cf6" />
            <KpiCard label="Cost/Drop" value={`$${Number(kpis.costDrop).toLocaleString()}`} icon="💎" delay={0.25} color="#06b6d4" />
          </div>

          {/* Content Area */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-[#8a8aa0] text-sm">Cargando Centro de Comando...</p>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in space-y-6">
              {activeView === 'feed' && (
                <RecommendationFeed recommendations={recommendations} onStatusChange={handleStatusChange} />
              )}
              {activeView === 'attribution' && (
                <AttributionOverview days={period.days} />
              )}
              {activeView === 'heatmap' && (
                <Heatmap stats={stats} locations={locations} />
              )}
              {activeView === 'funnel' && <Funnel days={period.days} />}
              {activeView === 'trends' && <Trends days={period.days} />}
              {activeView === 'crashintel' && <CrashIntelView />}
              {activeView === 'legalai' && <LegalAIView />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, delay, color }: { label: string; value: string; icon: string; delay: number; color: string }) {
  return (
    <div className="kpi-card count-in rounded-xl p-3.5 relative overflow-hidden transition-all duration-300 hover:scale-[1.02]" style={{ animationDelay: `${delay}s`, background: `${color}11`, border: `1px solid ${color}22` }}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[#8a8aa0]">{label}</span>
        <span className="text-sm">{icon}</span>
      </div>
      <div className="text-xl font-bold font-mono text-[#e8e8f0]">{value}</div>
    </div>
  );
}

function CrashIntelView() {
  return (
    <div className="rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[#080812]/60" style={{ height: 'calc(100vh - 200px)' }}>
      <iframe
        src="/crash-intel/index.html"
        className="w-full h-full border-0"
        title="Crash Intelligence"
        style={{ minHeight: '700px' }}
      />
    </div>
  );
}

export default App;
