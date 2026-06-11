// Script temporal: parsear números de Twilio → number_registry SQL
import { Twilio } from "twilio";
import "dotenv/config";

const client = new Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

// ── Mapeo de nombres a location_id ──
const LOCATION_ALIASES: Record<string, string> = {
  whittier: "whittier",
  bakersfield: "bakersfield_1",
  "bakersfield 2": "bakersfield_2",
  bakersfield2: "bakersfield_2",
  covina: "covina",
  fresno: "fresno",
  gardena: "gardena_1",
  "gardena 2": "gardena_2",
  gardena2: "gardena_2",
  ontario: "ontario",
  "santa ana": "santa_ana",
  victorville: "victorville",
  "los angeles": "los_angeles",
  rancho: "rancho_cucamonga",
  "rancho cucamonga": "rancho_cucamonga",
  "el cajon": "el_cajon",
  "orange contry": "santa_ana",
  "orange county": "santa_ana",
};

// ── Mapeo de canales (Raúl vs Ryan's) ──
// "adspro" en el nombre = Ryan's agency
// sin "adspro" = Raúl
const CHANNEL_ALIASES: Record<string, string> = {
  "google my business": "gmb",
  gmb: "gmb",
  "facebook ads": "facebook",
  fb: "facebook",
  website: "website",
  yelp: "yelp",
  "call center main number": "call_center",
  sunpilot: "other",
};

function detectChannel(friendly: string): string | null {
  const name = friendly.toLowerCase().trim();
  const isAdspro = name.includes("adspro");
  const isLsa = name.includes("lsa");
  const isPmax = name.includes("pmax");
  const isGoogleAds = name.includes("google ads");

  // LSA manejado por AdsPro (Ryan's)
  if (isLsa && isAdspro) return "lsa_adspro";
  // LSA manejado por Raúl
  if (isLsa) return "lsa";
  // Google Ads manejado por AdsPro (Ryan's) — incluye PMAX
  if ((isGoogleAds || isPmax) && isAdspro) return "google_adspro";
  // Google Ads manejado por Raúl
  if (isGoogleAds) return "google_ads";

  return null;
}

function parseFriendlyName(friendly: string): { location_id: string | null; channel: string | null } {
  const name = friendly.toLowerCase().trim();

  // Pattern 1: "Google AdsPro - LSA ACG {Location}" / "Google AdsPro - ACG PMAX {Location}"
  // Estos siempre son Ryan's — detectChannel ya lo maneja
  const adsproMatch = name.match(/google adspro\s*[-–—]\s*(lsa\s*)?\s*acg\s*(pmax\s*)?\s*(.+)/i);
  if (adsproMatch) {
    const locationPart = adsproMatch[3]?.trim();
    if (locationPart) {
      const loc = LOCATION_ALIASES[locationPart];
      const chan = detectChannel(friendly);
      if (loc && chan) return { location_id: loc, channel: chan };
      if (chan) {
        console.log(`  ⚠️  AdsPro sin location: "${locationPart}" ← "${friendly}"`);
        return { location_id: null, channel: chan };
      }
    }
  }

  // Pattern 2: "ACG {Location} - {Channel}"
  const acgMatch = name.match(/^acg\s+(.+?)\s*[-–—]\s*(.+)$/i);
  if (acgMatch) {
    const loc = LOCATION_ALIASES[acgMatch[1].trim()];
    const chanRaw = acgMatch[2].trim().toLowerCase();
    const detectedChan = detectChannel(friendly) || CHANNEL_ALIASES[chanRaw] || chanRaw.replace(/\s+/g, "_");
    return { location_id: loc || null, channel: detectedChan };
  }

  // Pattern 3: "{Location} - {Channel}"
  const simpleMatch = name.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (simpleMatch) {
    const locPart = simpleMatch[1].trim();
    const chanRaw = simpleMatch[2].trim().toLowerCase();
    const loc = LOCATION_ALIASES[locPart];
    const chan = detectChannel(friendly) || CHANNEL_ALIASES[chanRaw] || null;

    if (loc && chan) return { location_id: loc, channel: chan };
    if (loc && !chan) return { location_id: loc, channel: chanRaw.replace(/\s+/g, "_") };
    if (!loc) {
      console.log(`  ⚠️  Location no mapeada: "${locPart}" ← "${friendly}"`);
      return { location_id: null, channel: chan };
    }
  }

  // Pattern 4: Just a phone number as friendly name
  if (name.match(/^\(?\d{3}\)?\s*\d{3}[-\s]?\d{4}$/)) {
    return { location_id: null, channel: "unknown" };
  }

  // Pattern 5: Call Center Main Number → sin location (es el número central de salida)
  if (name.includes("call center")) {
    return { location_id: "all", channel: "call_center" };
  }

  // Pattern 6: SunPilot
  if (name.includes("sunpilot")) {
    return { location_id: null, channel: "other" };
  }

  console.log(`  ❓ No parseado: "${friendly}"`);
  return { location_id: null, channel: null };
}

// ── Main ──
async function main() {
  const numbers = await client.incomingPhoneNumbers.list({ limit: 200 });
  console.log(`📞 Parseando ${numbers.length} números...\n`);

  const mapped: { number: string; location_id: string; channel: string; friendly: string }[] = [];
  const unmapped: { number: string; friendly: string; reason: string }[] = [];

  for (const n of numbers) {
    const friendly = n.friendlyName || n.phoneNumber;
    const { location_id, channel } = parseFriendlyName(friendly);

    if (location_id && channel) {
      mapped.push({
        number: n.phoneNumber,
        location_id,
        channel,
        friendly,
      });
    } else {
      unmapped.push({
        number: n.phoneNumber,
        friendly,
        reason: !location_id ? "location no mapeada" : "canal no mapeado",
      });
    }
  }

  console.log(`\n✅ Mapeados: ${mapped.length}`);
  console.log(`❓ Sin mapear: ${unmapped.length}\n`);

  // ── Por Location ──
  console.log("── Por Location ──");
  const byLoc = new Map<string, number>();
  for (const m of mapped) {
    byLoc.set(m.location_id, (byLoc.get(m.location_id) || 0) + 1);
  }
  for (const [loc, count] of [...byLoc.entries()].sort()) {
    console.log(`  ${loc}: ${count} números`);
  }

  console.log("\n── Por Canal ──");
  const byChan = new Map<string, number>();
  for (const m of mapped) {
    byChan.set(m.channel, (byChan.get(m.channel) || 0) + 1);
  }
  for (const [chan, count] of [...byChan.entries()].sort()) {
    console.log(`  ${chan}: ${count} números`);
  }

  // ── Sin mapear ──
  if (unmapped.length > 0) {
    console.log("\n── ⚠️  SIN MAPEAR (validar con Raúl) ──");
    for (const u of unmapped) {
      console.log(`  ${u.number} → "${u.friendly}" (${u.reason})`);
    }
  }

  // ── SQL ──
  console.log("\n\n── SQL para number_registry ──\n");
  const values = mapped.map(m =>
    `('${m.number}', '${m.location_id}', '${m.channel}', '${m.friendly.replace(/'/g, "''")}')`
  );
  console.log(`INSERT INTO number_registry (twilio_number, location_id, channel, display_name) VALUES\n${values.join(",\n")}\nON CONFLICT (twilio_number) DO UPDATE SET location_id = EXCLUDED.location_id, channel = EXCLUDED.channel;`);
}

main().catch(console.error);
