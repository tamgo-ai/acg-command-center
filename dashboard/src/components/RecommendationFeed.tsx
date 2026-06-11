import { AlertTriangle, Zap, Target, X, ArrowRight } from 'lucide-react';
import type { Recommendation } from '../api';

interface FeedProps {
  recommendations: Recommendation[];
  onStatusChange: (id: number, status: 'reviewed' | 'actioned' | 'dismissed') => void;
}

const severityConfig = {
  critical: { icon: AlertTriangle, accent: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', label: 'CRÍTICO' },
  warning: { icon: AlertTriangle, accent: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', label: 'ATENCIÓN' },
  info: { icon: Zap, accent: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', label: 'INFO' },
};

const typeLabels: Record<string, string> = {
  pause_channel: 'PAUSAR',
  increase_budget: 'ESCALAR',
  geo_opportunity: 'EXPANDIR',
  script_review: 'REVISAR',
  keyword_alert: 'ALERTA',
  funnel_leak: 'FUGA',
  general: 'ANÁLISIS',
};

export function RecommendationFeed({ recommendations, onStatusChange }: FeedProps) {
  const active = recommendations.filter(r => r.status === 'new');
  const archived = recommendations.filter(r => r.status !== 'new');

  if (recommendations.length === 0) {
    return (
      <div className="glass-card p-16 text-center">
        <Target className="w-16 h-16 text-[#8a8aa0] mx-auto mb-5 opacity-20" />
        <p className="text-sm text-[#8a8aa0] font-mono">Sin inteligencia aún. Ejecuta el briefing agent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {active.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
            <h3 className="text-xs font-bold text-[#f59e0b] uppercase tracking-[0.2em]">{active.length} ACCIONES PENDIENTES</h3>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {active.map(rec => (
              <IntelCard key={rec.id} rec={rec} onStatusChange={onStatusChange} />
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <h3 className="text-xs font-bold text-[#8a8aa0] uppercase tracking-[0.2em] mb-4">{archived.length} PROCESADAS</h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 opacity-50 hover:opacity-70 transition-opacity">
            {archived.slice(0, 6).map(rec => (
              <IntelCard key={rec.id} rec={rec} onStatusChange={onStatusChange} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function IntelCard({ rec, onStatusChange }: { rec: Recommendation; onStatusChange: FeedProps['onStatusChange'] }) {
  const config = severityConfig[rec.severity] || severityConfig.info;
  const Icon = config.icon;
  const action = typeLabels[rec.type] || 'ACCIÓN';

  // Extraer números clave del supporting_data
  const numbers = extractKeyNumbers(rec);

  // Dividir el body en bullets si tiene múltiples líneas numeradas
  const bullets = extractBullets(rec.body, rec.title);

  return (
    <div
      className="glass-card p-5 transition-all duration-300 hover:scale-[1.01] cursor-default group relative overflow-hidden"
      style={{ borderColor: config.border }}
    >
      {/* Accent bar left */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 opacity-60" style={{ background: config.accent }} />

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg" style={{ background: config.bg }}>
            <Icon className="w-4 h-4" style={{ color: config.accent }} />
          </div>
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: config.accent }}>
            {config.label}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded font-mono tracking-wider bg-[rgba(255,255,255,0.03)] text-[#8a8aa0]">
            {action}
          </span>
        </div>
        {rec.status === 'new' ? (
          <div className="flex gap-1">
            <button onClick={() => onStatusChange(rec.id, 'actioned')} className="px-2.5 py-1 text-[10px] font-bold bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20 rounded-md hover:bg-[#10b981]/20 transition-all uppercase tracking-wider" title="Accionar">✓</button>
            <button onClick={() => onStatusChange(rec.id, 'dismissed')} className="px-2.5 py-1 text-[10px] font-medium text-[#8a8aa0] hover:text-[#ef4444] hover:bg-[#ef4444]/5 border border-transparent rounded-md transition-all" title="Descartar"><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <span className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider bg-[rgba(255,255,255,0.03)] text-[#8a8aa0]">{rec.status}</span>
        )}
      </div>

      {/* Title + location */}
      <div className="mb-3">
        <h4 className="text-[15px] font-bold text-[#e8e8f0] leading-tight mb-1">{rec.title}</h4>
        <div className="flex items-center gap-2 text-[10px] font-mono text-[#8a8aa0] uppercase tracking-wider">
          {rec.location_id && <span className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.02)]">{rec.location_id.replace(/_/g, ' ')}</span>}
          {rec.channel && rec.channel !== 'all' && <span className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.02)]">{rec.channel.replace(/_/g, ' ')}</span>}
        </div>
      </div>

      {/* Key numbers row - LO MÁS IMPORTANTE */}
      {numbers.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {numbers.map((n, i) => (
            <div key={i} className={`flex items-baseline gap-1 px-3 py-2 rounded-lg ${n.negative ? 'bg-[#ef4444]/8 border border-[#ef4444]/15' : 'bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)]'}`}>
              <span className="text-lg font-bold font-mono" style={{ color: n.negative ? '#f87171' : '#e8e8f0' }}>{n.value}</span>
              <span className="text-[9px] text-[#8a8aa0] font-mono uppercase tracking-wider">{n.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bullets - ultra concisos */}
      {bullets.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {bullets.slice(0, 3).map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-[#b0b0c0] leading-relaxed">
              <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 opacity-40" />
              <span className="line-clamp-2">{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Confidence mini bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-0.5 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${(rec.confidence || 0) * 100}%`, background: config.accent }} />
        </div>
        <span className="text-[9px] font-mono text-[#8a8aa0]">{((rec.confidence || 0) * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
function extractKeyNumbers(rec: Recommendation): { value: string; label: string; negative: boolean }[] {
  const nums: { value: string; label: string; negative: boolean }[] = [];
  const data = typeof rec.supporting_data === 'object' ? rec.supporting_data : {};

  // Costo por drop-off (la métrica estrella)
  if (data.costo_por_drop_off !== undefined) {
    const c = Number(data.costo_por_drop_off);
    nums.push({ value: `$${c.toFixed(0)}`, label: '/drop', negative: c > 150 });
  }
  // Duración media
  if (data.duracion_media !== undefined) {
    const d = Number(data.duracion_media);
    nums.push({ value: `${d}s`, label: 'dur. media', negative: d < 30 });
  }
  // Llamadas
  if (data.llamadas !== undefined) {
    nums.push({ value: Number(data.llamadas).toLocaleString(), label: 'calls', negative: false });
  }
  // Drop-offs
  if (data.drop_offs !== undefined) {
    nums.push({ value: String(data.drop_offs), label: 'drops', negative: false });
  }
  // Spend
  if (data.spend !== undefined && Number(data.spend) > 0) {
    const s = Number(data.spend);
    nums.push({ value: `$${s >= 1000 ? `${(s/1000).toFixed(0)}k` : s.toFixed(0)}`, label: 'spend', negative: false });
  }
  // Tasa de conversión
  if (data.tasa_conversion !== undefined) {
    nums.push({ value: `${Number(data.tasa_conversion)}%`, label: 'conv', negative: false });
  }

  return nums;
}

function extractBullets(body: string, _title: string): string[] {
  if (!body || body.length < 10) return [];

  // Si el body contiene bullets numerados o con guiones, extraerlos
  const cleaned = body
    .replace(/^\*\*[\d]+\.\s*\*\*/gm, '')  // quitar **1. **
    .replace(/^\d+\.\s+/gm, '')            // quitar 1.
    .replace(/^-\s+/gm, '')                // quitar -
    .replace(/\*\*/g, '')                  // quitar negritas
    .trim();

  // Dividir por frases clave
  const sentences = cleaned
    .split(/[.;:]\s+(?=[A-ZÁÉÍÓÚ0-9])/)
    .map(s => s.trim())
    .filter(s => s.length > 8 && s.length < 160);

  if (sentences.length <= 1) {
    // Single sentence: split by commas for short bullets
    const parts = cleaned.split(/,\s+(?=[a-záéíóú])/i).filter(p => p.trim().length > 5);
    return parts.slice(0, 3).map(p => p.trim());
  }

  return sentences.slice(0, 3);
}
