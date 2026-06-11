import { MessageSquareWarning, Grid3X3, FunnelIcon, TrendingUp, Activity, CarFront, Shield } from 'lucide-react';
import { DataUpload } from './DataUpload';

interface SidebarProps {
  activeView: 'feed' | 'heatmap' | 'funnel' | 'trends' | 'crashintel' | 'legalai';
  onNavigate: (view: 'feed' | 'heatmap' | 'funnel' | 'trends' | 'crashintel' | 'legalai') => void;
  onDataImported?: () => void;
}

const NAV_ITEMS = [
  { id: 'feed' as const, label: 'Intel', icon: MessageSquareWarning },
  { id: 'heatmap' as const, label: 'Mapa de Calor', icon: Grid3X3 },
  { id: 'funnel' as const, label: 'Embudo', icon: FunnelIcon },
  { id: 'trends' as const, label: 'Tendencias', icon: TrendingUp },
  { id: 'crashintel' as const, label: 'Crash Intel', icon: CarFront },
  { id: 'legalai' as const, label: 'Legal AI', icon: Shield },
];

export function Sidebar({ activeView, onNavigate, onDataImported }: SidebarProps) {
  return (
    <aside className="w-56 border-r border-[rgba(255,255,255,0.06)] bg-[#080812]/90 backdrop-blur-xl flex flex-col shrink-0 relative z-20">
      {/* Header */}
      <div className="h-16 border-b border-[rgba(255,255,255,0.06)] flex items-center px-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#3b82f6]" />
          <span className="text-[10px] text-[#8a8aa0] font-mono tracking-[0.2em] uppercase">Navegación</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-[#3b82f6]/12 text-[#60a5fa] border border-[#3b82f6]/25 shadow-[0_0_15px_rgba(59,130,246,0.06)]'
                  : 'text-[#8a8aa0] hover:text-[#d0d0e0] hover:bg-[rgba(255,255,255,0.03)] border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Upload */}
      <div className="border-t border-[rgba(255,255,255,0.06)] p-2">
        <DataUpload onDataImported={onDataImported} />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="live-pulse" />
          <span className="text-[10px] text-[#8a8aa0] font-mono tracking-wider">SYSTEM ONLINE</span>
        </div>
      </div>
    </aside>
  );
}
