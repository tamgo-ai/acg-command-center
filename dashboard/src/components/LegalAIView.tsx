import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Shield, AlertTriangle, FileText, BookOpen, Wrench, Users, Car, Cpu, Target, Building, X, Search, ChevronDown, Settings } from 'lucide-react';
import { LegalAIAdmin } from './LegalAIAdmin';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  disclaimer?: string;
}

interface Source {
  sourceName: string;
  sourceSection: string | null;
  title: string;
  excerpt: string;
}

interface Category {
  id: string;
  name: string;
  description: string;
  icon: string;
  doc_count: number;
  chunk_count: number;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  insurance_code: <Shield className="w-3.5 h-3.5" />,
  ccr_title10: <FileText className="w-3.5 h-3.5" />,
  bar: <Wrench className="w-3.5 h-3.5" />,
  consumer_rights: <Users className="w-3.5 h-3.5" />,
  vehicle_code: <Car className="w-3.5 h-3.5" />,
  oem_procedures: <Cpu className="w-3.5 h-3.5" />,
  icar_scrs: <BookOpen className="w-3.5 h-3.5" />,
  cdi_bulletins: <AlertTriangle className="w-3.5 h-3.5" />,
  internal_sops: <Building className="w-3.5 h-3.5" />,
  claims_intel: <Target className="w-3.5 h-3.5" />,
};

const EXAMPLE_QUESTIONS = [
  '¿Puede una aseguradora obligarme a usar su body shop preferido?',
  '¿Qué dice BAR sobre piezas aftermarket?',
  '¿Cuánto tiempo tiene la aseguradora para responder un supplement?',
  '¿Qué derechos tiene el cliente al elegir taller en California?',
  '¿Qué es una práctica injusta de liquidación de siniestros?',
];

export function LegalAIView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showSources, setShowSources] = useState<number | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/legal-ai/categories')
      .then(r => r.json())
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(q?: string) {
    const question = (q || input).trim();
    if (!question || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    try {
      const res = await fetch('/api/legal-ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          sessionId,
          categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        }),
      });

      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer || 'Error processing query.',
        sources: data.sources || [],
        disclaimer: data.disclaimer,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Error de conexión. Por favor intenta de nuevo.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const toggleCategory = (catId: string) => {
    setSelectedCategories(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    );
  };

  return (
    <div className="flex h-full gap-0 relative" style={{ height: 'calc(100vh - 200px)' }}>
      {/* Admin button — top right */}
      <button
        onClick={() => setShowAdmin(true)}
        className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-1 text-[10px] text-[#6a6a80] hover:text-[#d0d0e0] hover:bg-[rgba(255,255,255,0.05)] rounded-lg transition border border-transparent hover:border-[rgba(255,255,255,0.08)]"
        title="Admin — Gestión de documentos"
      >
        <Settings className="w-3 h-3" />
        Admin
      </button>

      {showAdmin && <LegalAIAdmin onClose={() => setShowAdmin(false)} />}

      {/* Sidebar — Categories + Examples */}
      <div className="w-60 border-r border-[rgba(255,255,255,0.06)] bg-[#080812]/60 flex flex-col shrink-0">
        <div className="p-3 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-3.5 h-3.5 text-[#3b82f6]" />
            <span className="text-xs font-semibold text-[#d0d0e0]">Filtros de categoría</span>
          </div>
          <p className="text-[10px] text-[#6a6a80]">Filtrar búsqueda por tipo de fuente</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => toggleCategory(cat.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition ${
                selectedCategories.includes(cat.id)
                  ? 'bg-[#3b82f6]/15 text-[#60a5fa] border border-[#3b82f6]/25'
                  : 'text-[#8a8aa0] hover:text-[#d0d0e0] hover:bg-[rgba(255,255,255,0.03)] border border-transparent'
              }`}
            >
              <span className="w-4 flex justify-center">
                {CATEGORY_ICONS[cat.id] || <FileText className="w-3 h-3" />}
              </span>
              <span className="truncate">{cat.name}</span>
              {cat.doc_count > 0 && (
                <span className="ml-auto text-[10px] opacity-50">{cat.doc_count}</span>
              )}
            </button>
          ))}
        </div>

        {selectedCategories.length > 0 && (
          <div className="p-2 border-t border-[rgba(255,255,255,0.06)]">
            <button
              onClick={() => setSelectedCategories([])}
              className="w-full text-center text-[10px] text-[#60a5fa] hover:underline"
            >
              Limpiar filtros ({selectedCategories.length})
            </button>
          </div>
        )}

        <div className="p-3 border-t border-[rgba(255,255,255,0.06)]">
          <p className="text-[10px] text-[#6a6a80] mb-2 font-semibold uppercase tracking-wider">Ejemplos</p>
          <div className="space-y-1">
            {EXAMPLE_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                className="w-full text-left text-[10px] text-[#8a8aa0] hover:text-[#d0d0e0] hover:bg-[rgba(255,255,255,0.03)] px-2 py-1.5 rounded transition leading-relaxed"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="w-14 h-14 rounded-2xl bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-6 h-6 text-[#3b82f6]" />
                </div>
                <h2 className="text-base font-semibold text-[#d0d0e0] mb-2">ACG Legal AI</h2>
                <p className="text-xs text-[#8a8aa0] mb-4">
                  Asistente legal y regulatorio para Auto Collision Group.
                  Pregunta sobre leyes de California, regulaciones BAR, derechos del consumidor, OEM, y más.
                </p>
                <p className="text-[10px] text-[#6a6a80]">
                  ⚠️ Esto no constituye asesoría legal. Basado en fuentes oficiales públicas.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-[#3b82f6]/15 border border-[#3b82f6]/25 text-[#e0e0f0]'
                  : 'bg-[#080812]/80 border border-[rgba(255,255,255,0.06)] text-[#d0d0e0]'
              }`}>
                {/* Assistant Avatar */}
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <Shield className="w-3 h-3 text-[#3b82f6]" />
                    <span className="text-[10px] font-semibold text-[#3b82f6] tracking-wider uppercase">ACG Legal AI</span>
                  </div>
                )}

                {/* Content */}
                <div className="text-sm leading-relaxed whitespace-pre-wrap legal-ai-response"
                  dangerouslySetInnerHTML={{ __html: formatLegalResponse(msg.content) }}
                />

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                    <button
                      onClick={() => setShowSources(showSources === i ? null : i)}
                      className="flex items-center gap-1.5 text-[10px] text-[#60a5fa] hover:text-[#93c5fd] transition"
                    >
                      <Search className="w-3 h-3" />
                      {msg.sources.length} fuente{msg.sources.length > 1 ? 's' : ''} consultada{msg.sources.length > 1 ? 's' : ''}
                      <ChevronDown className={`w-3 h-3 transition ${showSources === i ? 'rotate-180' : ''}`} />
                    </button>

                    {showSources === i && (
                      <div className="mt-2 space-y-1.5">
                        {msg.sources.map((src, j) => (
                          <div key={j} className="bg-[#0a0a14] rounded-lg p-2 border border-[rgba(255,255,255,0.04)]">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#8a8aa0] mb-0.5">
                              <FileText className="w-2.5 h-2.5" />
                              {src.sourceName}
                              {src.sourceSection && <span className="text-[#6a6a80]">{src.sourceSection}</span>}
                            </div>
                            <p className="text-[10px] text-[#a0a0b8] leading-relaxed">{src.excerpt}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Disclaimer */}
                {msg.disclaimer && (
                  <div className="mt-2 flex items-start gap-1.5 text-[9px] text-[#6a6a80] italic">
                    <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                    {msg.disclaimer}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#080812]/80 border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-3 h-3 text-[#3b82f6]" />
                  <span className="text-[10px] text-[#3b82f6]">ACG Legal AI</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#8a8aa0]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Consultando fuentes legales...
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta sobre leyes de California, regulaciones BAR, derechos del consumidor..."
              rows={2}
              className="flex-1 bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-[#e0e0f0] placeholder-[#5a5a7a] resize-none focus:outline-none focus:border-[#3b82f6]/40 focus:ring-1 focus:ring-[#3b82f6]/20 transition"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="px-3 py-2 bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-[#3b82f6]/30 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center gap-1.5 self-end"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          {selectedCategories.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[9px] text-[#6a6a80]">Filtrando:</span>
              {selectedCategories.map(catId => (
                <span key={catId} className="text-[9px] bg-[#3b82f6]/10 text-[#60a5fa] px-1.5 py-0.5 rounded border border-[#3b82f6]/20 flex items-center gap-1">
                  {categories.find(c => c.id === catId)?.name || catId}
                  <button onClick={() => toggleCategory(catId)}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Format legal response ────────────────────────────────────────────

function formatLegalResponse(text: string): string {
  // Bold headers
  let formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-[#e0e0f0] font-semibold">$1</strong>')
    // Source citations
    .replace(/\[Source (\d+)\]/g, '<span class="inline-flex items-center text-[10px] bg-[#3b82f6]/10 text-[#60a5fa] px-1 py-0.5 rounded font-mono">[Source $1]</span>')
    // Section citations
    .replace(/(§[\d.]+(?:\s*et\s*seq\.)?)/g, '<code class="text-[#93c5fd] text-xs">$1</code>')
    // Line breaks
    .replace(/\n\n/g, '</p><p class="mt-2">')
    .replace(/\n/g, '<br/>');

  return `<p>${formatted}</p>`;
}

export default LegalAIView;
