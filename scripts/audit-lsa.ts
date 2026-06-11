import { getLocalDb } from '../config/local-db';
const db = getLocalDb();

console.log('═══════════════════════════════════════');
console.log('🔍 AUDITORÍA LSA');
console.log('═══════════════════════════════════════\n');

const NINETY_DAYS = "datetime('now', '-90 days')";

// 1. Números LSA en el registry
const lsaNums = db.prepare("SELECT twilio_number, location_id, display_name FROM number_registry WHERE channel = 'lsa' ORDER BY location_id").all() as any[];
console.log(lsaNums.length + ' NÚMEROS LSA REGISTRADOS:\n');
for (const n of lsaNums) {
  const calls = db.prepare(`SELECT COUNT(*) as c FROM calls WHERE to_number = ? AND occurred_at > ${NINETY_DAYS}`).get(n.twilio_number) as any;
  console.log('  ' + n.location_id.padEnd(20) + ' | ' + (n.display_name || '').padEnd(35) + ' | ' + String(calls.c).padStart(4) + ' calls (90d)');
}

// 2. Ontario detalle
console.log('\n\n🔬 ONTARIO — TODOS LOS NÚMEROS:');
const ontarioNums = db.prepare("SELECT * FROM number_registry WHERE location_id = 'ontario'").all() as any[];
for (const n of ontarioNums) {
  const c90 = db.prepare(`SELECT COUNT(*) as c FROM calls WHERE to_number = ? AND occurred_at > ${NINETY_DAYS}`).get(n.twilio_number) as any;
  const cAll = db.prepare('SELECT COUNT(*) as c FROM calls WHERE to_number = ?').get(n.twilio_number) as any;
  console.log('  ' + n.channel.padEnd(12) + ' | 90d:' + String(c90.c).padStart(4) + ' | all:' + String(cAll.c).padStart(5) + ' | ' + n.twilio_number + ' | ' + (n.display_name || ''));
}

// 3. Llamadas LSA por location
console.log('\n\n📞 LLAMADAS LSA POR LOCATION (90 días):');
const lsaCalls = db.prepare(`
  SELECT nr.location_id, COUNT(*) as calls, ROUND(AVG(c.duration_sec),0) as dur
  FROM calls c JOIN number_registry nr ON c.to_number = nr.twilio_number
  WHERE c.occurred_at > ${NINETY_DAYS} AND nr.channel = 'lsa'
  GROUP BY nr.location_id ORDER BY calls DESC
`).all() as any[];
for (const l of lsaCalls) {
  console.log('  ' + l.location_id.padEnd(20) + ' | ' + String(l.calls).padStart(4) + ' calls | ' + l.dur + 's avg');
}

// 4. Números LSA sin llamadas
console.log('\n\n⚠️ NÚMEROS LSA CON CERO LLAMADAS (90 días):');
let deadCount = 0;
for (const n of lsaNums) {
  const c = db.prepare(`SELECT COUNT(*) as c FROM calls WHERE to_number = ? AND occurred_at > ${NINETY_DAYS}`).get(n.twilio_number) as any;
  if (c.c === 0) { console.log('  ❌ ' + n.location_id + ' | ' + n.twilio_number + ' | ' + n.display_name); deadCount++; }
}
if (deadCount === 0) console.log('  ✅ Todos los números LSA reciben llamadas');

// 5. Llamadas sin atribuir
console.log('\n\n❓ LLAMADAS A NÚMEROS DESCONOCIDOS (NO en registry, 90 días):');
const unknown = db.prepare(`
  SELECT c.to_number, COUNT(*) as cnt, MAX(c.occurred_at) as last_seen
  FROM calls c LEFT JOIN number_registry nr ON c.to_number = nr.twilio_number
  WHERE nr.twilio_number IS NULL AND c.occurred_at > ${NINETY_DAYS}
  GROUP BY c.to_number ORDER BY cnt DESC LIMIT 20
`).all() as any[];
const totalUnknown = unknown.reduce((s: number, r:any) => s + r.cnt, 0);
console.log('  ' + totalUnknown + ' llamadas a ' + unknown.length + ' números desconocidos');
for (const u of unknown) {
  console.log('  ' + u.to_number + ' | ' + u.cnt + ' calls | last: ' + (u.last_seen || '').substring(0, 10));
}
