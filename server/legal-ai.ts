/**
 * ACG Legal AI — Motor de búsqueda + Chat API
 *
 * Flujo:
 * 1. Pregunta del usuario
 * 2. FTS5 busca en todos los chunks legales → top 15
 * 3. Claude Opus 4.8 lee pregunta + chunks → responde con citas exactas
 * 4. Se devuelve respuesta + fuentes + chunks consultados
 */

import { Router, Request, Response } from 'express';
import { getLocalDb } from '../config/local-db';
import { randomUUID } from 'crypto';

const router = Router();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const LEGAL_AI_MODEL = 'claude-opus-4-8';

// ── Helpers ──────────────────────────────────────────────────────────

function cleanAnthropicEnv(): void {
  // Limpiar env vars que podrían envenenar las llamadas (mismo fix que el CRM)
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

interface SearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  sourceName: string;
  sourceSection: string | null;
  categoryId: string;
  contentType: string;
  content: string;
  rank: number;
}

interface ChatResponse {
  answer: string;
  sources: {
    sourceName: string;
    sourceSection: string | null;
    title: string;
    excerpt: string; // relevant excerpt from chunk
  }[];
  disclaimer: string;
  model: string;
}

// ── Spanish → English Legal Term Mapping ─────────────────────────────

const ES_EN_LEGAL_MAP: Record<string, string> = {
  // Insurance terms
  'aseguradora': 'insurer insurance company',
  'seguro': 'insurance policy coverage',
  'asegurado': 'insured claimant policyholder',
  'prima': 'premium',
  'cobertura': 'coverage',
  'deducible': 'deductible',
  'reclamo': 'claim',
  'reclamación': 'claim',
  'reclamacion': 'claim',
  'siniestro': 'claim loss accident',
  'indemnización': 'indemnification settlement compensation',
  'indemnizacion': 'indemnification settlement compensation',
  'póliza': 'policy',
  'poliza': 'policy',
  // Repair terms
  'taller': 'repair shop facility automotive repair dealer',
  'reparación': 'repair restoration fix',
  'reparacion': 'repair restoration fix',
  'carrocería': 'body collision auto body',
  'carroceria': 'body collision auto body',
  'pintura': 'paint refinish refinishing',
  'repuesto': 'replacement part',
  'pieza': 'part component',
  'piezas': 'parts components',
  'repuestos': 'replacement parts',
  'mano de obra': 'labor',
  'presupuesto': 'estimate',
  'estimado': 'estimate',
  'estimación': 'estimate',
  'estimacion': 'estimate',
  'suplemento': 'supplement supplemental',
  'suplementario': 'supplemental supplementary',
  'desmontaje': 'teardown disassembly',
  'calibración': 'calibration',
  'calibracion': 'calibration',
  'soldadura': 'welding',
  'bastidor': 'frame chassis',
  'chasis': 'frame chassis',
  // Legal/regulatory terms
  'obligar': 'require mandate compel',
  'obligatorio': 'mandatory required',
  'derecho': 'right entitled',
  'derechos': 'rights',
  'consumidor': 'consumer',
  'fraude': 'fraud fraudulent',
  'ley': 'law statute code',
  'regulación': 'regulation',
  'regulacion': 'regulation',
  'normativa': 'regulation standard',
  'multa': 'penalty fine',
  'sanción': 'penalty sanction',
  'sancion': 'penalty sanction',
  'demanda': 'lawsuit litigation',
  'abogado': 'attorney lawyer counsel',
  'juzgado': 'court',
  'corte': 'court',
  'juicio': 'trial judgment',
  'sentencia': 'judgment ruling',
  'apelación': 'appeal',
  'apelacion': 'appeal',
  // Vehicle terms
  'vehículo': 'vehicle automobile car',
  'vehiculo': 'vehicle automobile car',
  'auto': 'auto automobile vehicle',
  'automóvil': 'automobile vehicle',
  'automovil': 'automobile vehicle',
  'conductor': 'driver',
  'propietario': 'owner',
  'dueño': 'owner',
  'dueno': 'owner',
  'daño': 'damage',
  'daños': 'damages',
  'dano': 'damage',
  'danos': 'damages',
  'colisión': 'collision crash accident',
  'colision': 'collision crash accident',
  'choque': 'crash collision accident',
  'accidente': 'accident crash',
  'pérdida total': 'total loss salvage',
  'perdida total': 'total loss salvage',
  // OEM / Parts
  'original': 'original OEM manufacturer',
  'fabricante': 'manufacturer OEM maker',
  'equipo original': 'OEM original equipment',
  'certificación': 'certification certified',
  'certificacion': 'certification certified',
  'garantía': 'warranty guarantee',
  'garantia': 'warranty guarantee',
  // Process terms
  'plazo': 'deadline timeframe time limit',
  'tiempo': 'time timeframe period',
  'días': 'days business days',
  'dias': 'days business days',
  'horas': 'hours',
  'notificación': 'notice notification',
  'notificacion': 'notice notification',
  'inspección': 'inspection',
  'inspeccion': 'inspection',
  'ajuste': 'adjustment appraisal',
  'ajustador': 'adjuster appraiser',
  'perito': 'appraiser expert',
  'tasación': 'appraisal valuation',
  'tasacion': 'appraisal valuation',
  'arbitraje': 'arbitration',
  'mediación': 'mediation',
  'mediacion': 'mediation',
  // Operational
  'cliente': 'customer client claimant',
  'proveedor': 'provider vendor',
  'contrato': 'contract agreement',
  'acuerdo': 'agreement settlement',
  'DRP': 'DRP direct repair program',
  'programa de reparación directa': 'DRP direct repair program',
  'programa de reparacion directa': 'DRP direct repair program',
};

// English legal terms that should always be kept as-is
const ENGLISH_LEGAL_TERMS = new Set([
  'OEM', 'DRP', 'BAR', 'CDI', 'SCRS', 'I-CAR', 'FTS', 'DMV',
  'supplement', 'diminished value', 'total loss', 'salvage',
  'aftermarket', 'refinish', 'blend', 'clear coat', 'primer',
  'scan', 'calibration', 'ADAS', 'teardown', 'blueprint',
  'warranty', 'certification', 'bulletin', 'compliance',
  'estimate', 'appraisal', 'arbitration',
]);

function expandQuery(spanishQuery: string): string {
  const cleaned = spanishQuery.toLowerCase()
    .replace(/[¿?¡!.,;:'"()\[\]{}#$€£¥%&*+=/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/);
  const expanded = new Set<string>();

  // Check multi-word phrases first
  for (const [es, en] of Object.entries(ES_EN_LEGAL_MAP)) {
    if (es.includes(' ') && cleaned.includes(es)) {
      en.split(' ').forEach(w => {
        if (w.length > 1) expanded.add(sanitizeFtsTerm(w));
      });
    }
  }

  for (const word of words) {
    if (word.length <= 1) continue;
    // Keep original word (might be English already)
    if (ENGLISH_LEGAL_TERMS.has(word) || ENGLISH_LEGAL_TERMS.has(word.toUpperCase())) {
      expanded.add(sanitizeFtsTerm(word));
      continue;
    }
    // Translate if available
    const translation = ES_EN_LEGAL_MAP[word];
    if (translation) {
      translation.split(' ').forEach(w => {
        if (w.length > 1) expanded.add(sanitizeFtsTerm(w));
      });
    } else {
      // Keep original word too (might be English or a name)
      expanded.add(sanitizeFtsTerm(word));
    }
  }

  const result = [...expanded].join(' OR ');
  return result || cleaned.split(/\s+/).filter(w => w.length > 1).map(sanitizeFtsTerm).join(' OR ');
}

/** Sanitize a term for FTS5: remove special chars that FTS5 interprets as operators */
function sanitizeFtsTerm(term: string): string {
  // FTS5 special characters: hyphen (-), quotes, asterisk, parentheses, colon
  // Replace hyphens with spaces (I-CAR → I CAR) so both parts are searchable
  return term.replace(/[-:"'*()]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── FTS5 Search ──────────────────────────────────────────────────────

function executeFtsSearch(ftsQuery: string, categoryFilter?: string[], limit = 15): SearchResult[] {
  const db = getLocalDb();
  if (!ftsQuery) return [];

  let sql = `
    SELECT
      lc.id as chunk_id,
      lc.document_id,
      ld.title,
      ld.source_name,
      ld.source_section,
      ld.category_id,
      ld.content_type,
      lc.content,
      fts.rank
    FROM legal_chunks_fts fts
    JOIN legal_chunks lc ON lc.rowid = fts.rowid
    JOIN legal_documents ld ON ld.id = lc.document_id
    WHERE legal_chunks_fts MATCH ?
      AND ld.status = 'active'
  `;

  const params: any[] = [ftsQuery];

  if (categoryFilter && categoryFilter.length > 0) {
    sql += ` AND ld.category_id IN (${categoryFilter.map(() => '?').join(',')})`;
    params.push(...categoryFilter);
  }

  sql += ` ORDER BY fts.rank LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(r => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    title: r.title,
    sourceName: r.source_name,
    sourceSection: r.source_section || null,
    categoryId: r.category_id,
    contentType: r.content_type,
    content: r.content,
    rank: r.rank,
  }));
}

function fallbackLikeSearch(query: string, categoryFilter?: string[], limit = 15): SearchResult[] {
  const db = getLocalDb();
  const cleaned = query.toLowerCase().replace(/[^\w\s/-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];

  // Build multiple LIKE conditions
  const likeConditions = words.map(() => '(lc.content LIKE ? OR ld.title LIKE ?)').join(' AND ');
  const params: any[] = [];
  words.forEach(w => { params.push(`%${w}%`, `%${w}%`); });

  let sql = `
    SELECT lc.id as chunk_id, lc.document_id, ld.title, ld.source_name,
           ld.source_section, ld.category_id, ld.content_type, lc.content, 0.3 as rank
    FROM legal_chunks lc
    JOIN legal_documents ld ON ld.id = lc.document_id
    WHERE (${likeConditions}) AND ld.status = 'active'
  `;

  if (categoryFilter && categoryFilter.length > 0) {
    sql += ` AND ld.category_id IN (${categoryFilter.map(() => '?').join(',')})`;
    params.push(...categoryFilter);
  }

  sql += ` ORDER BY ld.category_id LIMIT ?`;
  params.push(limit);

  try {
    const fallback = db.prepare(sql).all(...params) as any[];
    return fallback.map(r => ({
      chunkId: r.chunk_id, documentId: r.document_id, title: r.title,
      sourceName: r.source_name, sourceSection: r.source_section || null,
      categoryId: r.category_id, contentType: r.content_type,
      content: r.content, rank: r.rank,
    }));
  } catch (err: any) {
    console.error('[LegalAI] LIKE fallback error:', err.message);
    return [];
  }
}

// ── Smart Re-Ranking ──────────────────────────────────────────────────

// Known entity patterns for boosting relevant chunks
const ENTITY_PATTERNS: { regex: RegExp; boostTerms: string[] }[] = [
  { regex: /state\s*farm/i, boostTerms: ['State Farm'] },
  { regex: /geico/i, boostTerms: ['GEICO'] },
  { regex: /progressive/i, boostTerms: ['Progressive'] },
  { regex: /allstate/i, boostTerms: ['Allstate'] },
  { regex: /farmers/i, boostTerms: ['Farmers'] },
  { regex: /usaa/i, boostTerms: ['USAA'] },
  { regex: /mercury/i, boostTerms: ['Mercury'] },
  { regex: /liberty\s*mutual/i, boostTerms: ['Liberty Mutual'] },
  { regex: /tesla/i, boostTerms: ['Tesla'] },
  { regex: /ford/i, boostTerms: ['Ford'] },
  { regex: /toyota/i, boostTerms: ['Toyota'] },
  { regex: /honda/i, boostTerms: ['Honda'] },
  { regex: /gm|general\s*motors|chevrolet|cadillac|gmc/i, boostTerms: ['General Motors', 'GM', 'Chevrolet'] },
  { regex: /diminished\s*value|valor\s*disminuido/i, boostTerms: ['diminished value'] },
  { regex: /total\s*loss|p[eé]rdida\s*total/i, boostTerms: ['total loss'] },
  { regex: /aftermarket|no\s*original|gen[eé]rico/i, boostTerms: ['aftermarket', 'non-OEM'] },
  { regex: /ADAS|calibraci[oó]n|calibration/i, boostTerms: ['ADAS', 'calibration'] },
  { regex: /suplemento|supplement/i, boostTerms: ['supplement', 'supplemental'] },
  { regex: /mano\s*de\s*obra|labor\s*rate/i, boostTerms: ['labor rate', 'labor'] },
  { regex: /bad\s*faith|mala\s*fe/i, boostTerms: ['bad faith'] },
  { regex: /CDI|department\s*of\s*insurance/i, boostTerms: ['CDI', 'California Department of Insurance'] },
  { regex: /steering|direccionamiento|taller\s*espec[ií]fico/i, boostTerms: ['steering'] },
  { regex: /DRP|direct\s*repair\s*program/i, boostTerms: ['DRP', 'direct repair program'] },
];

function extractEntities(query: string): { entity: string; boostTerms: string[] }[] {
  const found: { entity: string; boostTerms: string[] }[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    if (pattern.regex.test(query)) {
      found.push({ entity: pattern.boostTerms[0], boostTerms: pattern.boostTerms });
    }
  }
  return found;
}

function smartRerank(results: SearchResult[], query: string, targetCount: number): SearchResult[] {
  if (results.length <= targetCount) return results;

  const entities = extractEntities(query);

  // Score each result
  const scored = results.map(r => {
    let score = r.rank || 0;

    // Entity boost: chunks mentioning recognized entities get score boost
    if (entities.length > 0) {
      for (const entity of entities) {
        for (const term of entity.boostTerms) {
          if (r.content.toLowerCase().includes(term.toLowerCase()) ||
              r.title.toLowerCase().includes(term.toLowerCase())) {
            score += 2; // Significant boost for entity match
          }
        }
      }
    }

    // Content type priority: guides and standards are often more actionable than raw statutes
    if (r.contentType === 'guide' || r.contentType === 'standard') score += 0.5;

    // Source diversity: slightly penalize chunks from same document
    // (applied during selection below)

    return { ...r, _score: score };
  });

  // Sort by score descending
  scored.sort((a, b) => (b._score || 0) - (a._score || 0));

  // Select top chunks with source diversity
  const selected: SearchResult[] = [];
  const usedSources = new Set<string>();

  for (const r of scored) {
    if (selected.length >= targetCount) break;
    // Skip if we already have 3+ chunks from same document (promotes diversity)
    const sourceKey = r.documentId;
    const sourceCount = selected.filter(s => s.documentId === sourceKey).length;
    if (sourceCount >= 3) continue;

    selected.push(r);
    usedSources.add(sourceKey);
  }

  return selected;
}

function searchLegalChunks(
  query: string,
  categoryFilter?: string[],
  limit = 25
): SearchResult[] {
  // Strategy 1: Expand Spanish query with English legal terms → FTS5 (get extra for re-ranking)
  const expandedQuery = expandQuery(query);
  console.log('[LegalAI] Expanded query:', expandedQuery.substring(0, 250));

  let results = executeFtsSearch(expandedQuery, categoryFilter, Math.max(limit, 30));

  // Strategy 2: If FTS returns few results, try broader LIKE search
  if (results.length < 10) {
    console.log('[LegalAI] FTS returned', results.length, 'results, trying LIKE fallback');
    const likeResults = fallbackLikeSearch(query, categoryFilter, limit);
    const seen = new Set(results.map(r => r.chunkId));
    for (const r of likeResults) {
      if (!seen.has(r.chunkId)) {
        results.push(r);
        seen.add(r.chunkId);
      }
    }
  }

  // Strategy 3: If still nothing, try original Spanish words as LIKE
  if (results.length === 0) {
    console.log('[LegalAI] Still 0 results, trying original query as LIKE');
    results = fallbackLikeSearch(query, categoryFilter, limit);
  }

  // Strategy 4: Smart re-ranking with entity extraction and source diversity
  if (results.length > limit) {
    console.log('[LegalAI] Re-ranking', results.length, '→', limit, 'chunks');
    results = smartRerank(results, query, limit);
  }

  console.log('[LegalAI] Final results:', results.length);
  return results;
}

// ── Claude Chat ──────────────────────────────────────────────────────

async function callClaudeLegal(
  question: string,
  searchResults: SearchResult[],
  conversationHistory?: { role: string; content: string }[]
): Promise<{ answer: string; usedSourceIds: Set<string> }> {
  cleanAnthropicEnv();

  // Build context from search results — legal citation is the most important field
  const contextParts = searchResults.map((r, i) => {
    const section = r.sourceSection ? ` ${r.sourceSection}` : '';
    const fullCitation = r.sourceName + (section ? section : '');
    return `[SOURCE ${i + 1}]
CITE AS: ${fullCitation}
Title: ${r.title}
Source: ${r.sourceName}${section}
Category: ${r.categoryId} | Type: ${r.contentType}
Content:
${r.content}
---`;
  });

  const contextBlock = contextParts.join('\n\n');

  const systemPrompt = `You are the ACG Legal AI — an expert legal and regulatory assistant for Auto Collision Group (ACG), a premier collision repair company with 13 locations across California.

YOUR PURPOSE: Empower ACG estimators, CSRs, managers, and advisors with precise legal and regulatory intelligence to:
1. Ensure insurers pay what they legally owe on every claim.
2. Defend ACG's right to follow OEM repair procedures exclusively.
3. Counter insurer tactics that underpay, delay, or deny legitimate repair costs.
4. Keep ACG in full compliance with California collision repair regulations.
5. Maximize recovery on supplements, diminished value, labor rates, and OEM parts.

CRITICAL RULES:
1. ONLY answer based on the provided source documents. If the answer is not in the sources, say: "I could not find sufficient support in ACG's document base to answer this question with precision. Consider loading relevant documents via the admin panel."
2. CITE THE EXACT LAW INLINE — this is the most important rule. ACG estimators use your answers in real-time phone calls with insurers. Every claim MUST include the full legal citation in the sentence itself, not just a source number. Format: mention the statute/regulation/source name AND section inline, followed by [Source N] in parentheses. Example: "Under California Insurance Code §758(a), no insurer shall require repair at a specific shop [Source 3]." or "Per 10 CCR §2695.8(c), all reasonable costs must be covered [Source 7]." or "Tesla's official collision repair position statement requires calibration after any structural repair [Source 12]." NEVER write a bare "[Source N]" without the legal reference — the estimator needs to say the actual law on the phone.
3. Structure every answer as:
   - **Direct Answer** (plain English, 1-3 sentences, WITH exact legal citations inline — ready to say on a phone call)
   - **Legal/Regulatory Foundation** (specific statutes, codes, or standards — every sentence should name the specific law/section/source it references)
   - **Operational Recommendation for ACG** (exactly what to say on the phone — include word-for-word scripts with the legal citations embedded)
   - **Compliance Risk** (Low / Medium / High with one-line explanation)
   - **Supporting Documents** (which ACG knowledge base docs are most relevant — if applicable)
4. ALWAYS end with: "⚠️ This is regulatory intelligence, not legal advice. For specific legal matters, consult a qualified attorney or compliance officer."
5. Be precise. Distinguish between: statutes (California Insurance Code §xxx, Vehicle Code §xxx), regulations (10 CCR §xxx), OEM position statements (Tesla Collision Repair Program, Ford Position Statement, etc.), industry standards (I-CAR Welding Standards, SCRS Position on OEM Compliance, etc.), CDI bulletins, and internal ACG guides.
6. Write in ENGLISH. All citations in their original English. If the user writes in Spanish, respond in English.
7. When the user asks about a specific insurer (State Farm, GEICO, Progressive, Allstate, Farmers, USAA, Mercury, Liberty Mutual), reference the Claims Intelligence playbook for that insurer and provide tailored counter-strategies with exact citations.
8. Maximum response length: 800 words. Be concise, actionable, and specific.
9. If an insurer is systematically violating California law, cite the specific CDI complaint pathway (California Insurance Code §790.03(h)) and relevant code sections.

YOU ARE A REGULATORY INTELLIGENCE TOOL, NOT A LAWYER. Never provide legal advice. Always recommend consulting qualified legal counsel for specific situations.`;

  const messages: any[] = [
    { role: 'user', content: `LEGAL RESEARCH CONTEXT (from ACG's knowledge base):\n\n${contextBlock}\n\n---\n\nUSER QUESTION:\n${question}\n\nINSTRUCTIONS: Answer based ONLY on the sources above. CRITICAL: cite the EXACT law/source inline in every sentence — e.g., "California Insurance Code §758(a) states..." not just "[Source 1]". The answer will be used in real-time phone calls with insurance adjusters. Every legal claim must include the statute/regulation name and section number.` },
  ];

  if (conversationHistory && conversationHistory.length > 0) {
    messages.unshift(...conversationHistory.map(m => ({
      role: m.role,
      content: m.content,
    })));
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LEGAL_AI_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json() as any;
  const answer = data.content?.[0]?.text || 'No response generated.';

  // Track which sources were cited
  const usedSourceIds = new Set<string>();
  for (let i = 0; i < searchResults.length; i++) {
    if (answer.includes(`[Source ${i + 1}]`)) {
      usedSourceIds.add(searchResults[i].chunkId);
    }
  }

  return { answer, usedSourceIds };
}

// ── Routes ───────────────────────────────────────────────────────────

// POST /api/legal-ai/chat
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { question, categories, sessionId } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const sid = sessionId || randomUUID();

    // Search
    const results = searchLegalChunks(question, categories, 25);

    if (results.length === 0) {
      return res.json({
        answer: 'I could not find relevant information in ACG\'s document base to answer this question. Consider loading the relevant documents via the admin panel.',
        sources: [],
        disclaimer: '⚠️ This is regulatory intelligence, not legal advice.',
        model: LEGAL_AI_MODEL,
        sessionId: sid,
        resultsFound: 0,
      });
    }

    // Chat
    const { answer, usedSourceIds } = await callClaudeLegal(question, results);

    // Build sources list
    const sources = results
      .filter(r => usedSourceIds.has(r.chunkId))
      .slice(0, 8)
      .map(r => ({
        sourceName: r.sourceName,
        sourceSection: r.sourceSection,
        title: r.title,
        excerpt: r.content.slice(0, 250) + (r.content.length > 250 ? '...' : ''),
      }));

    // Save chat history
    const db = getLocalDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO legal_chat_history (id, session_id, role, content, sources_used, model_used, tokens_in, tokens_out, created_at)
      VALUES (?, ?, 'user', ?, NULL, NULL, NULL, NULL, ?)`).run(randomUUID(), sid, question, now);
    db.prepare(`INSERT INTO legal_chat_history (id, session_id, role, content, sources_used, model_used, tokens_in, tokens_out, created_at)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), sid, answer,
      JSON.stringify([...usedSourceIds]), LEGAL_AI_MODEL,
      results.reduce((s, r) => s + r.content.length, 0),
      answer.length, now
    );

    res.json({
      answer,
      sources,
      disclaimer: '⚠️ This is regulatory intelligence based on official sources, not legal advice. For complex legal matters, consult a qualified attorney or compliance officer.',
      model: LEGAL_AI_MODEL,
      sessionId: sid,
      resultsFound: results.length,
      sourcesUsed: usedSourceIds.size,
    });
  } catch (err: any) {
    console.error('[LegalAI] Chat error:', err.message);
    res.status(500).json({ error: 'Error processing legal query', detail: err.message });
  }
});

// GET /api/legal-ai/search — raw search (no AI)
router.get('/search', (req: Request, res: Response) => {
  const q = req.query.q as string;
  const cats = req.query.categories as string | undefined;
  if (!q?.trim()) return res.json({ results: [] });

  const categoryFilter = cats ? cats.split(',').filter(Boolean) : undefined;
  const results = searchLegalChunks(q, categoryFilter, 20);

  res.json({
    results: results.map(r => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      title: r.title,
      sourceName: r.sourceName,
      sourceSection: r.sourceSection,
      categoryId: r.categoryId,
      excerpt: r.content.slice(0, 300),
      rank: r.rank,
    })),
  });
});

// GET /api/legal-ai/documents — list all documents (admin)
router.get('/documents', (_req: Request, res: Response) => {
  const db = getLocalDb();
  const docs = db.prepare(`
    SELECT ld.*, lc.name as category_name,
      (SELECT COUNT(*) FROM legal_chunks lch WHERE lch.document_id = ld.id) as chunk_count
    FROM legal_documents ld
    LEFT JOIN legal_categories lc ON lc.id = ld.category_id
    ORDER BY ld.ingested_at DESC
  `).all();
  res.json(docs);
});

// GET /api/legal-ai/categories — list categories with counts
router.get('/categories', (_req: Request, res: Response) => {
  const db = getLocalDb();
  const cats = db.prepare(`
    SELECT lc.*, COUNT(ld.id) as doc_count,
      COALESCE(SUM((SELECT COUNT(*) FROM legal_chunks lch WHERE lch.document_id = ld.id)), 0) as chunk_count
    FROM legal_categories lc
    LEFT JOIN legal_documents ld ON ld.category_id = lc.id AND ld.status = 'active'
    GROUP BY lc.id
    ORDER BY lc.sort_order
  `).all();
  res.json(cats);
});

// GET /api/legal-ai/stats
router.get('/stats', (_req: Request, res: Response) => {
  const db = getLocalDb();
  const stats = {
    documents: (db.prepare('SELECT COUNT(*) as c FROM legal_documents WHERE status = ?').get('active') as any)?.c || 0,
    chunks: (db.prepare('SELECT COUNT(*) as c FROM legal_chunks').get() as any)?.c || 0,
    categories: (db.prepare('SELECT COUNT(*) as c FROM legal_categories').get() as any)?.c || 0,
    totalChars: (db.prepare('SELECT COALESCE(SUM(char_count), 0) as c FROM legal_chunks').get() as any)?.c || 0,
    recentChats: (db.prepare("SELECT COUNT(*) as c FROM legal_chat_history WHERE created_at > datetime('now', '-7 days')").get() as any)?.c || 0,
  };
  res.json(stats);
});

// POST /api/legal-ai/documents/ingest — ingest a document (admin)
router.post('/documents/ingest', (req: Request, res: Response) => {
  try {
    const { categoryId, title, content, sourceName, sourceUrl, sourceSection, contentType, tags } = req.body;
    if (!categoryId || !title || !content) {
      return res.status(400).json({ error: 'categoryId, title, and content are required' });
    }

    const db = getLocalDb();
    const docId = randomUUID();
    const now = new Date().toISOString();

    // Insert document
    db.prepare(`INSERT INTO legal_documents (id, category_id, title, source_url, source_name, source_section, content_type, status, last_updated, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
      docId, categoryId, title, sourceUrl || null, sourceName, sourceSection || null,
      contentType || 'statute', now, JSON.stringify({ tags: tags || [], ingested_via: 'manual' })
    );

    // Chunk it
    const chunks = chunkText(content, 800, 200);
    for (let i = 0; i < chunks.length; i++) {
      db.prepare(`INSERT INTO legal_chunks (id, document_id, chunk_index, content, char_count, token_estimate)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), docId, i, chunks[i], chunks[i].length, Math.ceil(chunks[i].length / 4)
      );
    }

    res.status(201).json({
      id: docId,
      title,
      chunks: chunks.length,
      totalChars: content.length,
    });
  } catch (err: any) {
    console.error('[LegalAI] Ingest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/legal-ai/documents/:id
router.delete('/documents/:id', (req: Request, res: Response) => {
  const db = getLocalDb();
  db.prepare('DELETE FROM legal_documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PATCH /api/legal-ai/documents/:id
router.patch('/documents/:id', (req: Request, res: Response) => {
  const { status, categoryId, title } = req.body;
  const db = getLocalDb();
  const updates: string[] = [];
  const params: any[] = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (categoryId) { updates.push('category_id = ?'); params.push(categoryId); }
  if (title) { updates.push('title = ?'); params.push(title); }
  if (updates.length > 0) {
    params.push(req.params.id);
    db.prepare(`UPDATE legal_documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  res.json({ ok: true });
});

// ── Call Script Generator ────────────────────────────────────────────

const CALL_SCRIPT_SYSTEM = `You are the ACG Call Script Generator — an expert at writing word-for-word phone scripts for collision repair estimators negotiating with insurance adjusters.

YOUR JOB: Generate a complete, ready-to-read phone script that an ACG estimator can use in real time when calling an insurance adjuster.

SCRIPT STRUCTURE:
1. **PRE-CALL PREP** (what to have open: claim number, OEM procedure pages, key statutes)
2. **OPENING** (exactly what to say when the adjuster answers — professional, direct, establishes credibility)
3. **THE ASK** (state exactly what you need: supplement approval, OEM parts, labor rate, calibration, etc. — with the EXACT legal citation embedded in the sentence)
4. **ADJUSTER PUSHBACK SCENARIOS** (3-4 most likely objections the adjuster will say, with your EXACT counter-response including legal citations)
5. **THE CLOSE** (if they agree → confirmation protocol; if they resist → escalation path)
6. **POST-CALL ACTIONS** (what to document, what to send in writing)

CRITICAL RULES:
- Every legal claim must include the EXACT statute/regulation citation inline — ready to say aloud
- Write conversationally — this will be spoken, not read
- Include PAUSE markers for when the adjuster is expected to respond
- Keep responses under 15 seconds of speaking time each
- Provide the TOP 3 legal citations that must be mentioned no matter what
- Adapt the script to the specific insurer's known tactics (from Claims Intelligence)

FORMAT: Use clear section headers and put the estimator's words in quotes or bold. Put adjuster likely responses in [brackets].`;

async function generateCallScript(question: string, searchResults: SearchResult[]): Promise<string> {
  cleanAnthropicEnv();

  const contextParts = searchResults.map((r, i) => {
    const section = r.sourceSection ? ` ${r.sourceSection}` : '';
    const fullCitation = r.sourceName + (section || '');
    return `[SOURCE ${i + 1}] CITE AS: ${fullCitation}
Title: ${r.title}
Content: ${r.content}
---`;
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LEGAL_AI_MODEL,
      max_tokens: 2500,
      system: CALL_SCRIPT_SYSTEM,
      messages: [{
        role: 'user',
        content: `LEGAL CONTEXT:\n\n${contextParts.join('\n\n')}\n\n---\n\nCALL SCENARIO:\n${question}\n\nGenerate a complete phone script for this situation. Include exact legal citations the estimator should say aloud. Write conversationally — this will be read on a live call.`
      }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
  const data = await response.json() as any;
  return data.content?.[0]?.text || 'No script generated.';
}

// POST /api/legal-ai/call-script
router.post('/call-script', async (req: Request, res: Response) => {
  try {
    const { scenario, insurer, vehicle, issue } = req.body;
    const constructedQuestion = [
      scenario || '',
      insurer ? `Insurer: ${insurer}` : '',
      vehicle ? `Vehicle: ${vehicle}` : '',
      issue ? `Issue: ${issue}` : '',
    ].filter(Boolean).join('\n');

    if (!constructedQuestion.trim()) {
      return res.status(400).json({ error: 'Scenario description is required' });
    }

    const results = searchLegalChunks(constructedQuestion, undefined, 20);
    if (results.length === 0) {
      return res.json({
        script: 'I could not find sufficient legal context to generate a reliable call script for this scenario.',
        sources: [],
        disclaimer: '⚠️ This is regulatory intelligence, not legal advice.',
      });
    }

    const script = await generateCallScript(constructedQuestion, results);

    const usedSourceIds = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      if (script.includes(`[Source ${i + 1}]`)) usedSourceIds.add(results[i].chunkId);
    }
    const sources = results
      .filter(r => usedSourceIds.has(r.chunkId))
      .slice(0, 6)
      .map(r => ({
        sourceName: r.sourceName,
        sourceSection: r.sourceSection,
        title: r.title,
        excerpt: r.content.slice(0, 250),
      }));

    res.json({ script, sources, disclaimer: '⚠️ This is regulatory intelligence, not legal advice.' });
  } catch (err: any) {
    console.error('[CallScript] Error:', err.message);
    res.status(500).json({ error: 'Error generating call script', detail: err.message });
  }
});

// ── Demand Letter Generator ──────────────────────────────────────────

const DEMAND_LETTER_SYSTEM = `You are the ACG Demand Letter Generator — an expert at drafting formal, legally-grounded demand letters for collision repair claims in California.

YOUR JOB: Generate a professional demand letter that an ACG manager can send to an insurance company when they have systematically underpaid, delayed, or denied legitimate repair costs.

LETTER STRUCTURE:
1. **LETTERHEAD** (Auto Collision Group, address, phone, date)
2. **REFERENCE** (Claim number, insured name, vehicle VIN/year/make/model, date of loss)
3. **SUMMARY OF DISPUTE** (2-3 sentences: what happened, what's owed, what's been denied/underpaid)
4. **DETAILED FINDINGS** (line-by-line breakdown of each disputed item with the exact repair operation, the amount, the insurer's position, and WHY the insurer is wrong — with specific legal citations)
5. **LEGAL BASIS FOR PAYMENT** (list each applicable statute/regulation with a brief explanation of how it applies to this claim)
6. **PATTERN DOCUMENTATION** (if applicable — note that this is part of a systematic pattern by this insurer, cite prior claims if available)
7. **DEMAND** (exact dollar amount demanded, breakdown, deadline for payment — recommend 15 calendar days per 10 CCR §2695.7)
8. **CONSEQUENCES OF NON-PAYMENT** (CDI complaint, potential bad faith litigation, consumer notification)
9. **CC LINE** (California Department of Insurance — Market Conduct Division)
10. **SIGNATURE BLOCK**

CRITICAL RULES:
- Every legal citation must be EXACT and complete (statute name + section + subsection)
- Use formal business letter tone — professional, firm, legally precise
- Every dollar amount must be itemized with the specific repair operation it corresponds to
- Reference the specific OEM procedure or I-CAR standard that supports each disputed operation
- If the insurer has a known pattern (from Claims Intelligence), reference it
- Include the CDI complaint filing reference: California Insurance Code §790.03(h) — Unfair Claims Settlement Practices
- The letter should be ready to print, sign, and send — no placeholders except where the user must fill in specific data
- Maximum length: 1200 words`;

async function generateDemandLetter(scenario: string, searchResults: SearchResult[]): Promise<string> {
  cleanAnthropicEnv();

  const contextParts = searchResults.map((r, i) => {
    const section = r.sourceSection ? ` ${r.sourceSection}` : '';
    const fullCitation = r.sourceName + (section || '');
    return `[SOURCE ${i + 1}] CITE AS: ${fullCitation}
Title: ${r.title}
Content: ${r.content}
---`;
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LEGAL_AI_MODEL,
      max_tokens: 3000,
      system: DEMAND_LETTER_SYSTEM,
      messages: [{
        role: 'user',
        content: `LEGAL CONTEXT:\n\n${contextParts.join('\n\n')}\n\n---\n\nDEMAND LETTER SCENARIO:\n${scenario}\n\nGenerate a formal demand letter ready to print, sign, and send. Include exact legal citations, itemized amounts, and CDI complaint reference.`
      }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
  const data = await response.json() as any;
  return data.content?.[0]?.text || 'No letter generated.';
}

// POST /api/legal-ai/demand-letter
router.post('/demand-letter', async (req: Request, res: Response) => {
  try {
    const { claimNumber, insurer, insuredName, vehicleInfo, dateOfLoss, totalDisputed, disputedItems, additionalContext } = req.body;

    const scenarioParts = [
      `CLAIM #: ${claimNumber || 'N/A'}`,
      `INSURER: ${insurer || 'N/A'}`,
      `INSURED: ${insuredName || 'N/A'}`,
      `VEHICLE: ${vehicleInfo || 'N/A'}`,
      `DATE OF LOSS: ${dateOfLoss || 'N/A'}`,
      `TOTAL AMOUNT DISPUTED: $${totalDisputed || 'N/A'}`,
      `DISPUTED ITEMS:\n${disputedItems || 'N/A'}`,
      additionalContext || '',
    ].filter(Boolean).join('\n');

    if (!insurer && !disputedItems) {
      return res.status(400).json({ error: 'At minimum, insurer name and disputed items are required' });
    }

    const results = searchLegalChunks(scenarioParts, undefined, 25);
    if (results.length === 0) {
      return res.json({
        letter: 'I could not find sufficient legal context to generate a reliable demand letter for this scenario.',
        sources: [],
      });
    }

    const letter = await generateDemandLetter(scenarioParts, results);

    const usedSourceIds = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      if (letter.includes(`[Source ${i + 1}]`)) usedSourceIds.add(results[i].chunkId);
    }
    const sources = results
      .filter(r => usedSourceIds.has(r.chunkId))
      .slice(0, 8)
      .map(r => ({
        sourceName: r.sourceName,
        sourceSection: r.sourceSection,
        title: r.title,
        excerpt: r.content.slice(0, 250),
      }));

    res.json({
      letter,
      sources,
      disclaimer: '⚠️ This is a draft generated from regulatory intelligence. Review all details before sending. This is not legal advice.',
    });
  } catch (err: any) {
    console.error('[DemandLetter] Error:', err.message);
    res.status(500).json({ error: 'Error generating demand letter', detail: err.message });
  }
});

// ── Chunking ─────────────────────────────────────────────────────────

function chunkText(text: string, targetChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  // Split by double newlines first (paragraph boundaries), then single
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep last `overlapChars` characters of previous chunk
      current = current.slice(-overlapChars) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If any chunk is still too big, split by sentences
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= targetChars * 1.3) {
      finalChunks.push(chunk);
      continue;
    }
    const sentences = chunk.split(/(?<=[.!?])\s+/);
    let sub = '';
    for (const sent of sentences) {
      if (sub.length + sent.length > targetChars && sub.length > 0) {
        finalChunks.push(sub.trim());
        sub = sub.slice(-overlapChars) + ' ' + sent;
      } else {
        sub += (sub ? ' ' : '') + sent;
      }
    }
    if (sub.trim()) finalChunks.push(sub.trim());
  }
  return finalChunks;
}

export { router as legalAiRoutes, searchLegalChunks };
