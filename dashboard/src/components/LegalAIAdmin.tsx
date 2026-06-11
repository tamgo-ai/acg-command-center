import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Search, FileText, BookOpen, Database, Upload } from 'lucide-react';

interface Document {
  id: string;
  title: string;
  source_name: string;
  source_section: string | null;
  category_id: string;
  category_name: string;
  content_type: string;
  status: string;
  chunk_count: number;
  source_url: string | null;
  ingested_at: string;
}

interface Category {
  id: string;
  name: string;
  description: string;
  doc_count: number;
  chunk_count: number;
}

interface Stats {
  documents: number;
  chunks: number;
  categories: number;
  totalChars: number;
  recentChats: number;
}

interface LegalAIAdminProps {
  onClose: () => void;
}

export function LegalAIAdmin({ onClose }: LegalAIAdminProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<'docs' | 'add' | 'categories'>('docs');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Add form
  const [formCategory, setFormCategory] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formSource, setFormSource] = useState('');
  const [formSection, setFormSection] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formType, setFormType] = useState('statute');
  const [formSubmitting, setFormSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [docsRes, catsRes, statsRes] = await Promise.all([
      fetch('/api/legal-ai/documents'),
      fetch('/api/legal-ai/categories'),
      fetch('/api/legal-ai/stats'),
    ]);
    setDocs(await docsRes.json());
    setCategories(await catsRes.json());
    setStats(await statsRes.json());
    setLoading(false);
  }

  async function handleDelete(docId: string) {
    if (!confirm('¿Eliminar este documento y todos sus chunks?')) return;
    await fetch(`/api/legal-ai/documents/${docId}`, { method: 'DELETE' });
    loadData();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!formCategory || !formTitle || !formContent.trim()) return;
    setFormSubmitting(true);
    try {
      const res = await fetch('/api/legal-ai/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: formCategory,
          title: formTitle,
          content: formContent,
          sourceName: formSource || 'Manual Upload',
          sourceUrl: formUrl || null,
          sourceSection: formSection || null,
          contentType: formType,
          tags: [],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFormTitle('');
        setFormContent('');
        setFormSection('');
        setTab('docs');
        loadData();
      } else {
        alert('Error: ' + (data.error || 'Unknown'));
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setFormSubmitting(false);
    }
  }

  const filteredDocs = docs.filter(d =>
    !search ||
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.source_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.source_section || '').toLowerCase().includes(search.toLowerCase())
  );

  const CONTENT_TYPES: Record<string, string> = {
    statute: 'Estatuto',
    regulation: 'Regulación',
    bulletin: 'Boletín',
    guide: 'Guía',
    oem: 'OEM',
    sop: 'SOP Interno',
    other: 'Otro',
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-[#0c0c18] border border-[rgba(255,255,255,0.1)] rounded-2xl p-8 max-w-lg w-full mx-4 text-center">
          <Database className="w-8 h-8 text-[#3b82f6] mx-auto mb-3 animate-pulse" />
          <p className="text-[#8a8aa0]">Cargando Knowledge Base...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0c0c18] border border-[rgba(255,255,255,0.1)] rounded-2xl w-full max-w-4xl mx-4 flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center">
              <Database className="w-4 h-4 text-[#3b82f6]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#d0d0e0]">ACG Legal AI — Admin</h2>
              <p className="text-[10px] text-[#6a6a80]">Gestión de la base de conocimiento legal</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6a6a80] hover:text-[#d0d0e0] transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-5 gap-2 px-4 py-2.5 border-b border-[rgba(255,255,255,0.04)]">
            <StatBadge label="Documentos" value={stats.documents} />
            <StatBadge label="Chunks" value={stats.chunks} />
            <StatBadge label="Categorías" value={stats.categories} />
            <StatBadge label="Caracteres" value={stats.totalChars.toLocaleString()} />
            <StatBadge label="Consultas 7d" value={stats.recentChats} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-0 px-4 border-b border-[rgba(255,255,255,0.04)]">
          {([
            { id: 'docs' as const, label: 'Documentos', icon: FileText },
            { id: 'add' as const, label: 'Añadir', icon: Plus },
            { id: 'categories' as const, label: 'Categorías', icon: BookOpen },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
                tab === t.id
                  ? 'border-[#3b82f6] text-[#60a5fa]'
                  : 'border-transparent text-[#6a6a80] hover:text-[#d0d0e0]'
              }`}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'docs' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5a5a7a]" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar documentos..."
                  className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#e0e0f0] placeholder-[#5a5a7a] focus:outline-none focus:border-[#3b82f6]/40"
                />
              </div>

              {filteredDocs.length === 0 ? (
                <div className="text-center py-8 text-[#6a6a80] text-xs">
                  No documents found. Add sources in the "Añadir" tab.
                </div>
              ) : (
                filteredDocs.map(doc => (
                  <div key={doc.id} className="bg-[#0a0a14] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] bg-[#3b82f6]/10 text-[#60a5fa] px-1.5 py-0.5 rounded font-mono">
                            {CONTENT_TYPES[doc.content_type] || doc.content_type}
                          </span>
                          <span className="text-[10px] text-[#6a6a80]">{doc.category_name}</span>
                          {doc.status !== 'active' && (
                            <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded">{doc.status}</span>
                          )}
                        </div>
                        <h3 className="text-xs font-semibold text-[#d0d0e0] truncate">{doc.title}</h3>
                        <p className="text-[10px] text-[#6a6a80] mt-0.5">
                          {doc.source_name}
                          {doc.source_section && <span className="text-[#60a5fa] ml-1">{doc.source_section}</span>}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 text-[9px] text-[#5a5a7a]">
                          <span>{doc.chunk_count} chunks</span>
                          {doc.source_url && (
                            <a href={doc.source_url} target="_blank" rel="noopener" className="text-[#60a5fa] hover:underline truncate max-w-[200px]">
                              Fuente ↗
                            </a>
                          )}
                          <span>Ingestado: {doc.ingested_at?.slice(0, 10)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="text-[#5a5a7a] hover:text-red-400 transition ml-2 shrink-0"
                        title="Eliminar documento"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'add' && (
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">Categoría *</label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    required
                    className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] focus:outline-none focus:border-[#3b82f6]/40"
                  >
                    <option value="">Seleccionar categoría...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">Tipo de contenido</label>
                  <select
                    value={formType}
                    onChange={e => setFormType(e.target.value)}
                    className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] focus:outline-none focus:border-[#3b82f6]/40"
                  >
                    {Object.entries(CONTENT_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">Título *</label>
                <input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  required
                  placeholder="California Insurance Code §758 — Auto Body Repair"
                  className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] placeholder-[#5a5a7a] focus:outline-none focus:border-[#3b82f6]/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">Fuente (source name)</label>
                  <input
                    value={formSource}
                    onChange={e => setFormSource(e.target.value)}
                    placeholder="California Insurance Code"
                    className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] placeholder-[#5a5a7a] focus:outline-none focus:border-[#3b82f6]/40"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">Sección</label>
                  <input
                    value={formSection}
                    onChange={e => setFormSection(e.target.value)}
                    placeholder="§758.5"
                    className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] placeholder-[#5a5a7a] focus:outline-none focus:border-[#3b82f6]/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">URL de la fuente</label>
                <input
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://leginfo.legislature.ca.gov/..."
                  className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] placeholder-[#5a5a7a] focus:outline-none focus:border-[#3b82f6]/40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8a8aa0] mb-1">Contenido *</label>
                <textarea
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  required
                  rows={8}
                  placeholder="Pega aquí el texto completo del documento legal, regulación, guía..."
                  className="w-full bg-[#0a0a14] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[#e0e0f0] placeholder-[#5a5a7a] resize-none focus:outline-none focus:border-[#3b82f6]/40"
                />
              </div>
              <button
                type="submit"
                disabled={formSubmitting || !formCategory || !formTitle || !formContent.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-[#3b82f6]/30 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition"
              >
                {formSubmitting ? (
                  <>Procesando...</>
                ) : (
                  <><Upload className="w-3 h-3" /> Ingestar documento</>
                )}
              </button>
              <p className="text-[9px] text-[#5a5a7a]">
                El documento se dividirá automáticamente en chunks de ~800 caracteres con overlap de 200.
              </p>
            </form>
          )}

          {tab === 'categories' && (
            <div className="space-y-2">
              {categories.map(cat => (
                <div key={cat.id} className="bg-[#0a0a14] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-[#d0d0e0]">{cat.name}</h3>
                    <p className="text-[10px] text-[#6a6a80] mt-0.5">{cat.description}</p>
                    <p className="text-[9px] text-[#5a5a7a] mt-1">{cat.doc_count} docs · {cat.chunk_count} chunks</p>
                  </div>
                  <span className="text-[10px] bg-[#3b82f6]/10 text-[#60a5fa] px-2 py-1 rounded font-mono">{cat.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-[#d0d0e0]">{value}</div>
      <div className="text-[9px] text-[#5a5a7a] uppercase tracking-wider">{label}</div>
    </div>
  );
}
