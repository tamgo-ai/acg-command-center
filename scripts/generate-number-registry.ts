/**
 * Auto-genera number_registry seed desde los números reales de Twilio.
 * Parsea friendly names tipo "Bakersfield - Google Ads" → location_id + channel.
 */

import twilio from 'twilio';
import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';

dotenv.config();

// ── Channel mapping ───────────────────────────────────────────────
const CHANNEL_MAP: Record<string, string> = {
  google_ads: 'google_ads',
  'google ads': 'google_ads',          // Fix: "City - Google Ads" direct match
  google_adspro: 'google_ads',
  'google adspro': 'google_ads',       // Fix: "Google AdsPro - ..." direct match
  pmax: 'google_ads',
  facebook: 'facebook',
  'facebook ads': 'facebook',
  fb: 'facebook',
  gmb: 'gmb',
  'google my business': 'gmb',
  yelp: 'yelp',
  lsa: 'lsa',
  'lsa (local service ads)': 'lsa',
  'local service ads': 'lsa',
  website: 'website',
};

// ── Location mapping ──────────────────────────────────────────────
// Returns { location_id, location_normalized }
const LOCATION_PATTERNS: Array<{ match: RegExp; location_id: string; city: string }> = [
  // Bakersfield 2 first (more specific)
  { match: /bakersfield\s*2/i, location_id: 'bakersfield_2', city: 'Bakersfield' },
  { match: /bakersfield(?!\s*2)/i, location_id: 'bakersfield_1', city: 'Bakersfield' },
  { match: /gardena\s*2/i, location_id: 'gardena_2', city: 'Gardena' },
  { match: /gardena(?!\s*2)/i, location_id: 'gardena_1', city: 'Gardena' },
  { match: /covina/i, location_id: 'covina', city: 'Covina' },
  { match: /fresno/i, location_id: 'fresno', city: 'Fresno' },
  { match: /ontario/i, location_id: 'ontario', city: 'Ontario' },
  { match: /santa\s*ana/i, location_id: 'santa_ana', city: 'Santa Ana' },
  { match: /orange\s*co(?:u)?ntr?y/i, location_id: 'santa_ana', city: 'Santa Ana' }, // typo "Contry"
  { match: /whittier/i, location_id: 'whittier', city: 'Whittier' },
  { match: /victorville/i, location_id: 'victorville', city: 'Victorville' },
  { match: /los\s*angeles/i, location_id: 'los_angeles', city: 'Los Angeles' },
  { match: /rancho\s*cucamonga/i, location_id: 'rancho_cucamonga', city: 'Rancho Cucamonga' },
  { match: /rancho(?!\s*cucamonga)/i, location_id: 'rancho_cucamonga', city: 'Rancho Cucamonga' },
  { match: /el\s*cajon/i, location_id: 'el_cajon', city: 'El Cajon' },
];

// ── Numbers to skip ───────────────────────────────────────────────
const SKIP_PATTERNS = [
  /sunpilot/i,
  /^\(\d{3}\) \d{3}-\d{4}$/, // Bare phone numbers with no location info
];

function parseChannel(rawChannel: string): string | null {
  const cleaned = rawChannel.trim().toLowerCase();
  // Direct lookup
  if (CHANNEL_MAP[cleaned]) return CHANNEL_MAP[cleaned];
  // Substring match
  for (const [key, value] of Object.entries(CHANNEL_MAP)) {
    if (cleaned.includes(key)) return value;
  }
  // Heuristic: if contains "google" → google_ads, "facebook" or "fb" → facebook
  if (cleaned.includes('google') || cleaned.includes('adspro')) return 'google_ads';
  if (cleaned.includes('facebook') || cleaned.includes('fb')) return 'facebook';
  if (cleaned.includes('gmb') || cleaned.includes('business')) return 'gmb';
  if (cleaned.includes('yelp')) return 'yelp';
  if (cleaned.includes('lsa')) return 'lsa';
  if (cleaned.includes('website')) return 'website';
  if (cleaned.includes('call center') || cleaned.includes('main number')) return 'other';
  return null;
}

function parseFriendlyName(friendly: string): {
  location_id: string;
  city: string;
  channel: string;
  display_name: string;
} | null {
  // Skip patterns
  for (const skip of SKIP_PATTERNS) {
    if (skip.test(friendly)) return null;
  }

  const name = friendly.trim();

  // Try to extract location
  let locationMatch: { location_id: string; city: string } | null = null;
  for (const pattern of LOCATION_PATTERNS) {
    if (pattern.match.test(name)) {
      locationMatch = { location_id: pattern.location_id, city: pattern.city };
      break;
    }
  }

  if (!locationMatch) return null;

  // Try to extract channel from what's left
  let channelStr = name;
  // Remove location part
  for (const pattern of LOCATION_PATTERNS) {
    channelStr = channelStr.replace(pattern.match, '');
  }
  // Clean up separators and prefixes
  channelStr = channelStr
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .replace(/^(Google\s*AdsPro|ACG)\s*-?\s*/i, '')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')   // re-clean after removing prefix
    .replace(/^\s*-\s*/, '')
    .trim();

  const channel = parseChannel(channelStr) || parseChannel(name); // fallback to full name

  if (!channel) return null;

  return {
    location_id: locationMatch.location_id,
    city: locationMatch.city,
    channel,
    display_name: `${locationMatch.city} - ${channel.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
  };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const numbers = await client.incomingPhoneNumbers.list({ limit: 200 });

  console.log(`📞 ${numbers.length} números encontrados en Twilio\n`);

  const parsed: Array<{
    phone: string;
    location_id: string;
    channel: string;
    display_name: string;
    sid: string;
    friendlyName: string;
  }> = [];
  const skipped: Array<{ phone: string; friendlyName: string }> = [];

  for (const n of numbers) {
    const result = parseFriendlyName(n.friendlyName);
    if (result) {
      parsed.push({
        phone: n.phoneNumber,
        location_id: result.location_id,
        channel: result.channel,
        display_name: result.display_name,
        sid: n.sid || '',
        friendlyName: n.friendlyName,
      });
    } else {
      skipped.push({ phone: n.phoneNumber, friendlyName: n.friendlyName });
    }
  }

  // ── Generate SQL ───────────────────────────────────────────────
  let sql = `-- ============================================================================
-- NUMBER REGISTRY — Auto-generado desde Twilio (${new Date().toISOString().split('T')[0]})
-- ${parsed.length} números mapeados | ${skipped.length} omitidos
-- ============================================================================

INSERT INTO number_registry (twilio_number, location_id, channel, display_name, notes) VALUES
`;

  const values = parsed.map(p => {
    return `('${p.phone}', '${p.location_id}', '${p.channel}', '${p.display_name}', 'Auto-mapped from: ${p.friendlyName.replace(/'/g, "''")}')`;
  });

  sql += values.join(',\n');
  sql += `\nON CONFLICT (twilio_number) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    channel = EXCLUDED.channel,
    display_name = EXCLUDED.display_name,
    updated_at = now();
`;

  // ── Write files ────────────────────────────────────────────────
  writeFileSync('db/number_registry_seed.sql', sql);

  // CSV version
  const csvHeader = 'twilio_number,location_id,channel,display_name,friendly_name,sid';
  const csvRows = parsed.map(p =>
    `"${p.phone}","${p.location_id}","${p.channel}","${p.display_name}","${p.friendlyName.replace(/"/g, '""')}","${p.sid}"`
  );
  writeFileSync('db/number_registry.csv', [csvHeader, ...csvRows].join('\n'));

  // ── Summary ─────────────────────────────────────────────────────
  console.log('✅ REGISTRO GENERADO\n');
  console.log(`📊 ${parsed.length} números mapeados a ${sql.length} bytes SQL`);
  console.log(`📄 db/number_registry_seed.sql`);
  console.log(`📄 db/number_registry.csv\n`);

  // Breakdown by location
  const byLocation = new Map<string, number>();
  const byChannel = new Map<string, number>();
  for (const p of parsed) {
    byLocation.set(p.location_id, (byLocation.get(p.location_id) || 0) + 1);
    byChannel.set(p.channel, (byChannel.get(p.channel) || 0) + 1);
  }

  console.log('📍 POR LOCATION:');
  Array.from(byLocation.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([loc, count]) => console.log(`   ${loc}: ${count} números`));

  console.log('\n📡 POR CANAL:');
  Array.from(byChannel.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([ch, count]) => console.log(`   ${ch}: ${count} números`));

  console.log('\n⚠️  OMITIDOS:');
  skipped.forEach(s => console.log(`   ${s.phone} — "${s.friendlyName}"`));

  // Check coverage: which locations have NO numbers?
  const allLocations = [
    'whittier', 'bakersfield_1', 'bakersfield_2', 'covina', 'fresno',
    'gardena_1', 'gardena_2', 'ontario', 'santa_ana', 'victorville',
    'los_angeles', 'rancho_cucamonga', 'el_cajon',
  ];
  const covered = new Set(byLocation.keys());
  const missing = allLocations.filter(l => !covered.has(l));
  if (missing.length) {
    console.log(`\n❌ LOCATIONS SIN NÚMEROS: ${missing.join(', ')}`);
  } else {
    console.log('\n✅ TODAS LAS 13 LOCATIONS TIENEN NÚMEROS');
  }
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
