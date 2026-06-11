import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Loader } from 'lucide-react';

interface UploadResult {
  ok: boolean;
  rows: number;
  local_inserted: number;
  supabase_inserted: number;
  total_spend: number;
  by_location: Record<string, number>;
  error?: string;
}

export function DataUpload({ onDataImported }: { onDataImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLocal = import.meta.env.VITE_LOCAL_API || '';

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const text = await file.text();
      const apiBase = isLocal || window.location.origin;

      const res = await fetch(`${apiBase}/api/upload/google-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });

      const data = await res.json();
      if (data.ok) {
        setResult(data);
        onDataImported?.();
      } else {
        setError(data.error || 'Error desconocido');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith('.csv')) {
      setFile(f);
      setError(null);
    } else {
      setError('Solo archivos CSV');
    }
  }

  return (
    <>
      {/* Botón en la sidebar */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
          open
            ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/30'
            : 'text-[#8888a0] hover:text-[#e8e8ed] hover:bg-[#1a1a2e] border border-transparent'
        }`}
      >
        <Upload className="w-4 h-4" />
        Importar Datos
      </button>

      {/* Panel desplegable */}
      {open && (
        <div className="border-t border-[#2a2a3e] p-3 space-y-3">
          <p className="text-xs text-[#8888a0] uppercase tracking-wider font-medium">
            Google Ads CSV
          </p>

          {!result && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  file
                    ? 'border-[#22c55e]/40 bg-[#22c55e]/5'
                    : 'border-[#2a2a3e] hover:border-[#3b82f6]/40 hover:bg-[#1a1a2e]'
                }`}
              >
                {file ? (
                  <div className="flex items-center gap-2 justify-center text-sm">
                    <FileSpreadsheet className="w-4 h-4 text-[#22c55e]" />
                    <span className="text-[#e8e8ed] font-medium">{file.name}</span>
                    <span className="text-[#8888a0] text-xs">
                      ({(file.size / 1024).toFixed(0)} KB)
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-[#8888a0]">
                    <Upload className="w-5 h-5 mx-auto mb-1 opacity-50" />
                    Click o arrastra tu CSV aquí
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setFile(f); setError(null); }
                  }}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs text-[#ef4444] bg-[#ef4444]/5 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3 h-3" />
                  {error}
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="w-full py-2 rounded-lg text-sm font-medium bg-[#8b5cf6] text-white hover:bg-[#7c3aed] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    Importar CSV
                  </>
                )}
              </button>
            </>
          )}

          {result && (
            <div className="space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-[#22c55e]">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">¡Importado!</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#12121a] rounded-lg p-2 text-center">
                  <div className="text-lg font-bold text-white">{result.rows}</div>
                  <div className="text-[#8888a0]">filas</div>
                </div>
                <div className="bg-[#12121a] rounded-lg p-2 text-center">
                  <div className="text-lg font-bold text-[#22c55e]">
                    ${result.total_spend.toLocaleString()}
                  </div>
                  <div className="text-[#8888a0]">spend total</div>
                </div>
              </div>

              {Object.keys(result.by_location).length > 0 && (
                <div className="bg-[#12121a] rounded-lg p-2 text-xs max-h-32 overflow-y-auto">
                  {Object.entries(result.by_location)
                    .sort((a, b) => b[1] - a[1])
                    .map(([loc, spend]) => (
                      <div key={loc} className="flex justify-between py-0.5">
                        <span className="text-[#c0c0d0] capitalize">{loc.replace(/_/g, ' ')}</span>
                        <span className="text-white font-mono">${spend.toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              )}

              <button
                onClick={() => { setResult(null); setFile(null); }}
                className="w-full py-1.5 rounded-lg text-xs text-[#8888a0] hover:text-white hover:bg-[#1a1a2e] transition-colors"
              >
                Importar otro
              </button>
            </div>
          )}

          <p className="text-[10px] text-[#666] leading-relaxed">
            Exporta tu reporte de campañas de Google Ads a CSV.<br />
            Columnas esperadas: Campaign, Date, Cost, Impressions, Clicks
          </p>
        </div>
      )}
    </>
  );
}
