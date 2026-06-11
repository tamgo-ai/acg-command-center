import { Shield, RefreshCw } from 'lucide-react';

interface HeaderProps {
  lastUpdate: Date | null;
  onRefresh: () => void;
  loading: boolean;
  isLocal?: boolean;
  period: { label: string; days: number };
  periods: { label: string; days: number }[];
  onPeriodChange: (p: { label: string; days: number }) => void;
}

export function Header({ lastUpdate, onRefresh, loading, isLocal, period, periods, onPeriodChange }: HeaderProps) {
  return (
    <header className="h-16 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between px-6 bg-[#06060c]/85 backdrop-blur-xl shrink-0 relative z-10">
      {/* Left */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Shield className="w-7 h-7 text-[#3b82f6]" />
            <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-[#10b981] rounded-full border-2 border-[#06060c] live-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none">
              <span className="text-white">ACG</span>
              <span className="text-[#3b82f6] ml-2 font-light tracking-[0.15em] text-sm">CENTRO DE COMANDO</span>
            </h1>
            <p className="text-[10px] text-[#8a8aa0] font-mono tracking-wider">AUTO COLLISION GROUP</p>
          </div>
        </div>

        <div className="h-7 w-px bg-[rgba(255,255,255,0.08)]" />

        {/* Status */}
        <div className="flex items-center gap-2.5">
          <span className={`live-pulse ${loading ? '!bg-[#f59e0b]' : ''}`} />
          <span className="text-xs text-[#8a8aa0] font-mono tracking-wider">
            {loading ? 'PROCESSING...' : isLocal ? 'LOCAL DB' : 'SUPABASE'}
          </span>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.03)] rounded-lg p-0.5">
        {periods.map(p => (
          <button
            key={p.label}
            onClick={() => onPeriodChange(p)}
            className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-md transition-all tracking-wider ${
              period.label === p.label
                ? 'bg-[#3b82f6] text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                : 'text-[#8a8aa0] hover:text-[#d0d0e0] hover:bg-[rgba(255,255,255,0.04)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Right */}
      <div className="flex items-center gap-5">
        {lastUpdate && (
          <span className="text-xs text-[#8a8aa0] font-mono">
            UPDATED {lastUpdate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}Z
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-[rgba(255,255,255,0.04)] transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-[#8a8aa0] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </header>
  );
}
