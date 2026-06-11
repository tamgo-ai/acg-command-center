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
  const [kpis, setKpis] = useState<{ calls: number; msgs: number; spend: number; drops: number }>({ calls: 0, msgs: 0, spend: 0, drops: 0 });
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLocal, setIsLocal] = useState(true);

  useEffect(() => { loadData(); }, [period]);

  async function loadData() {
    setLoading(true);
    const d = period.days;
    try {
      setIsLocal(api.isLocal);

      const [recs, heatmap, locs] = await Promise.all([
        api.getRecommendations(),
        api.getHeatmap(d),
        api.getLocations(),
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

      // KPI data from stats endpoint (respects days filter)
      try {
        const statsRes = await fetch(`/api/stats?days=${d}`);
        const statsData = await statsRes.json();
        const spendRes = await fetch(`/api/ad-spend?days=${d}`);
        const spendData = await spendRes.json();
        const totalSpend = (spendData || []).reduce((s: number, r: any) => s + (r.total_spend || 0), 0);
        setKpis({
          calls: totalCalls,
          msgs: statsData.total_messages || 0,
          spend: totalSpend,
          drops: statsData.drop_offs || 0,
        });
      } catch {
        setKpis({ calls: totalCalls, msgs: 0, spend: 0, drops: 0 });
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
          {/* KPI Bar */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard label="Llamadas Totales" value={kpis.calls.toLocaleString()} icon="📞" delay={0} />
            <KpiCard label="Mensajes" value={kpis.msgs.toLocaleString()} icon="💬" delay={0.1} />
            <KpiCard label="Ad Spend" value={`$${kpis.spend.toLocaleString()}`} icon="💰" delay={0.2} />
            <KpiCard label="Drop Offs" value={kpis.drops.toLocaleString()} icon="🚗" delay={0.3} />
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

function KpiCard({ label, value, icon, delay }: { label: string; value: string; icon: string; delay: number }) {
  return (
    <div className="kpi-card count-in" style={{ animationDelay: `${delay}s` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[#8a8aa0] uppercase tracking-wider">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="kpi-value text-[2rem]">{value}</div>
      <div className="flex items-center gap-2 mt-2">
        <span className="live-pulse" />
        <span className="text-[10px] text-[#8a8aa0] uppercase tracking-wider">Live</span>
      </div>
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
