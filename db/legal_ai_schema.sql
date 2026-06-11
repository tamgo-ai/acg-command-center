-- ACG Legal AI — Knowledge Base Schema
-- FTS5 + metadata for legal/regulatory documents

-- Categories
CREATE TABLE IF NOT EXISTS legal_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Documents (original sources)
CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES legal_categories(id),
  title TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT NOT NULL,       -- e.g. "California Insurance Code"
  source_section TEXT,             -- e.g. "§758.5"
  jurisdiction TEXT DEFAULT 'CA',
  content_type TEXT DEFAULT 'statute', -- statute, regulation, bulletin, guide, oem, sop
  status TEXT DEFAULT 'active',    -- active, archived, draft
  last_updated TEXT,
  ingested_at TEXT DEFAULT (datetime('now')),
  metadata JSONB DEFAULT '{}'     -- tags, keywords, applicability
);

-- Chunks (FTS5 indexed pieces)
CREATE TABLE IF NOT EXISTS legal_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER,
  token_estimate INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS legal_chunks_fts USING fts5(
  content,
  source_name,
  source_section,
  title,
  category_id,
  content_type,
  tokenize='unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS legal_chunks_ai AFTER INSERT ON legal_chunks BEGIN
  INSERT INTO legal_chunks_fts(rowid, content, source_name, source_section, title, category_id, content_type)
  SELECT lc.rowid, lc.content, ld.source_name, ld.source_section, ld.title, ld.category_id, ld.content_type
  FROM legal_chunks lc
  JOIN legal_documents ld ON ld.id = lc.document_id
  WHERE lc.id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS legal_chunks_ad AFTER DELETE ON legal_chunks BEGIN
  INSERT INTO legal_chunks_fts(legal_chunks_fts, rowid, content, source_name, source_section, title, category_id, content_type)
  VALUES('delete', OLD.rowid, OLD.content, '', '', '', '', '');
END;

-- Chat history
CREATE TABLE IF NOT EXISTS legal_chat_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- user, assistant
  content TEXT NOT NULL,
  sources_used TEXT,               -- JSON array of chunk IDs used
  model_used TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_legal_chat_session ON legal_chat_history(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_doc ON legal_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_legal_docs_cat ON legal_documents(category_id);

-- Seed categories
INSERT OR IGNORE INTO legal_categories (id, name, description, icon, sort_order) VALUES
  ('insurance_code', 'Código de Seguros', 'California Insurance Code — claims, unfair practices, auto insurance', 'shield', 1),
  ('ccr_title10', 'CCR Título 10', 'Fair Claims Settlement Practices Regulations', 'scale', 2),
  ('bar', 'BAR', 'Bureau of Automotive Repair — talleres, reparaciones, quejas', 'wrench', 3),
  ('consumer_rights', 'Derechos del Consumidor', 'Consumer Bill of Rights, Repair Act, CDI guides', 'users', 4),
  ('vehicle_code', 'Código de Vehículos', 'California Vehicle Code — salvage, total loss, DMV', 'car', 5),
  ('oem_procedures', 'OEM Procedures', 'Procedimientos de reparación por fabricante', 'cpu', 6),
  ('icar_scrs', 'I-CAR / SCRS', 'Estándares de reparación y mejores prácticas', 'book-open', 7),
  ('cdi_bulletins', 'CDI Bulletins', 'Department of Insurance bulletins y avisos', 'file-text', 8),
  ('internal_sops', 'SOPs Internos ACG', 'Procedimientos operativos estándar de ACG', 'building', 9),
  ('claims_intel', 'Claims Intelligence', 'Guías por aseguradora, suplementos, diminished value', 'target', 10);
