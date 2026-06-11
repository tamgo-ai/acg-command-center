/**
 * ACG Legal AI — Weekly Legal Sources Scraper
 *
 * Corre semanalmente (via cron/systemd timer) para buscar actualizaciones
 * de CDI Bulletins, BAR regulations, y otras fuentes legales.
 *
 * Si encuentra contenido nuevo, lo ingesta automáticamente en la DB.
 *
 * Uso manual: npx tsx agents/weekly-legal-scraper.ts
 * Uso automático: systemd timer (acg-legal-scraper.timer)
 */

import { getLocalDb } from '../config/local-db';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const db = getLocalDb();
const LOG_FILE = path.join(__dirname, '..', 'logs', 'legal-scraper.log');

// ── Logger ─────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ── Sources to Monitor ─────────────────────────────────────────────────

interface SourceMonitor {
  name: string;
  url: string;
  categoryId: string;
  contentType: string;
  /** How to detect new content */
  detector: 'html_title' | 'rss_feed' | 'page_list';
}

const MONITORED_SOURCES: SourceMonitor[] = [
  {
    name: 'CDI Bulletins & Notices',
    url: 'https://www.insurance.ca.gov/0250-insurers/0300-insurers/0200-bulletins/bulletin-notices-commiss-opinion/index.cfm',
    categoryId: 'cdi_bulletins',
    contentType: 'bulletin',
    detector: 'page_list',
  },
  {
    name: 'BAR Consumer Alerts',
    url: 'https://www.bar.ca.gov/Consumer/index',
    categoryId: 'bar',
    contentType: 'regulation',
    detector: 'html_title',
  },
  {
    name: 'California Insurance Code Updates',
    url: 'https://leginfo.legislature.ca.gov/faces/codes.xhtml?lawCode=INS',
    categoryId: 'insurance_code',
    contentType: 'statute',
    detector: 'html_title',
  },
  {
    name: 'California Vehicle Code Updates',
    url: 'https://leginfo.legislature.ca.gov/faces/codes.xhtml?lawCode=VEH',
    categoryId: 'vehicle_code',
    contentType: 'statute',
    detector: 'html_title',
  },
  {
    name: 'CA Code of Regulations Title 10',
    url: 'https://govt.westlaw.com/calregs/Browse/Home/California/CaliforniaCodeofRegulations?guid=I8AC8C4D0DF6D11EC8B47DD47EDF145F8',
    categoryId: 'ccr_title10',
    contentType: 'regulation',
    detector: 'html_title',
  },
];

// ── Scraper Logic ──────────────────────────────────────────────────────

interface ScrapeResult {
  source: string;
  title: string;
  url?: string;
  content: string;
  publishedDate?: string;
}

async function scrapeUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ACG-Legal-AI-Scraper/1.0 (+https://www.autoacg.com; compliance monitoring)',
        'Accept': 'text/html, application/xhtml+xml, application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      log(`  ⚠️ HTTP ${response.status} for ${url}`);
      return null;
    }

    const html = await response.text();
    return html;
  } catch (err: any) {
    log(`  ❌ Fetch error for ${url}: ${err.message}`);
    return null;
  }
}

// ── Content Extraction ─────────────────────────────────────────────────

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function extractMetaDescription(html: string): string | null {
  const match = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i)
    || html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i);
  return match ? match[1].trim() : null;
}

// ── Known Content Hashes (evita duplicados) ────────────────────────────

function contentFingerprint(title: string, source: string): string {
  // Simple hash for dedup
  const str = `${title}|${source}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(16);
}

function isAlreadyIngested(title: string, sourceName: string): boolean {
  const existing = db.prepare(
    'SELECT id FROM legal_documents WHERE title = ? AND source_name = ?'
  ).get(title, sourceName);
  return !!existing;
}

function ingestNewContent(result: ScrapeResult, categoryId: string, contentType: string): boolean {
  if (!result.content || result.content.length < 100) {
    log(`  ⏭️ Content too short (${result.content?.length || 0} chars), skipping`);
    return false;
  }

  if (isAlreadyIngested(result.title, result.source)) {
    log(`  ⏭️ Already in DB: ${result.title}`);
    return false;
  }

  const docId = randomUUID();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO legal_documents (id, category_id, title, source_url, source_name, content_type, status, last_updated, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(docId, categoryId, result.title, result.url || null, result.source, contentType, now, JSON.stringify({
      tags: ['auto-scraped'],
      ingested_via: 'weekly-scraper',
      scraped_at: now,
    }));

    // Chunk it
    const chunks = chunkText(result.content, 800, 200);
    for (let i = 0; i < chunks.length; i++) {
      db.prepare(`
        INSERT INTO legal_chunks (id, document_id, chunk_index, content, char_count, token_estimate)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), docId, i, chunks[i], chunks[i].length, Math.ceil(chunks[i].length / 4));
    }

    log(`  ✅ INGESTED: ${result.title} (${chunks.length} chunks, ${result.content.length} chars)`);
    return true;
  } catch (err: any) {
    log(`  ❌ Ingest error: ${err.message}`);
    return false;
  }
}

// ── Chunking (same as server) ──────────────────────────────────────────

function chunkText(text: string, targetChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-overlapChars) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

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

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  log('═══════════════════════════════════════════');
  log('ACG Legal Scraper — Weekly Run Starting');
  log('═══════════════════════════════════════════');

  const stats = {
    sourcesChecked: 0,
    pagesFetched: 0,
    newContentFound: 0,
    ingested: 0,
    errors: 0,
  };

  for (const source of MONITORED_SOURCES) {
    log(`\n📡 Checking: ${source.name}`);
    log(`   URL: ${source.url}`);
    stats.sourcesChecked++;

    const html = await scrapeUrl(source.url);
    if (!html) {
      stats.errors++;
      continue;
    }
    stats.pagesFetched++;

    const title = extractTitle(html);
    const description = extractMetaDescription(html);

    if (title) {
      log(`   Title: ${title}`);

      // Check if this content is new
      if (!isAlreadyIngested(title, source.name)) {
        log(`   🆕 NEW content detected!`);
        stats.newContentFound++;

        const content = description || `Page title: ${title}\nSource: ${source.url}\nLast checked: ${new Date().toISOString()}`;
        const result: ScrapeResult = {
          source: source.name,
          title,
          url: source.url,
          content: content.length > 200 ? content : `Full page from ${source.name}\nTitle: ${title}\nURL: ${source.url}\n\nNote: Full content extraction requires JavaScript rendering. This record serves as a change detection marker. Manual review of the source page is recommended for complete content ingestion.`,
        };

        if (ingestNewContent(result, source.categoryId, source.contentType)) {
          stats.ingested++;
        }
      } else {
        log(`   ✅ Already tracked, no changes detected`);
      }
    } else {
      log(`   ⚠️ Could not extract title`);
      stats.errors++;
    }
  }

  // Save ingestion log
  db.prepare(`INSERT INTO ingestion_log (source, started_at, finished_at, records_fetched, records_new, records_errors, metadata)
    VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)`).run(
    'weekly-legal-scraper',
    stats.pagesFetched,
    stats.ingested,
    stats.errors,
    JSON.stringify({ sources_checked: stats.sourcesChecked, new_content_found: stats.newContentFound })
  );

  log(`\n═══════════════════════════════════════════`);
  log(`📊 Run Summary:`);
  log(`   Sources checked: ${stats.sourcesChecked}`);
  log(`   Pages fetched: ${stats.pagesFetched}`);
  log(`   New content: ${stats.newContentFound}`);
  log(`   Ingested: ${stats.ingested}`);
  log(`   Errors: ${stats.errors}`);
  log(`═══════════════════════════════════════════\n`);
}

main().catch(err => {
  log(`❌ FATAL: ${err.message}`);
  process.exit(1);
});
