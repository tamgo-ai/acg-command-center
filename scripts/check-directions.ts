import { getLocalDb } from '../config/local-db';
const db = getLocalDb();

const nums = ['+19093304849', '+15622611599', '+16614538550', '+15623174976'];

for (const num of nums) {
  const dirs = db.prepare('SELECT direction, COUNT(*) as c FROM calls WHERE to_number = ? GROUP BY direction').all(num) as any[];
  console.log(num + ':');
  for (const d of dirs) console.log('  ' + d.direction + ': ' + d.c + ' calls');
  console.log('');
}

console.log('--- GLOBAL ---');
const global = db.prepare('SELECT direction, COUNT(*) as c FROM calls GROUP BY direction ORDER BY c DESC').all() as any[];
for (const g of global) console.log(g.direction + ': ' + g.c + ' calls');

console.log('\n--- INBOUND ATTRIBUTED (90d) ---');
const attr = db.prepare(`
  SELECT COUNT(*) as c FROM calls c
  JOIN number_registry nr ON c.to_number = nr.twilio_number
  WHERE c.direction = 'inbound' AND c.occurred_at > datetime('now', '-90 days')
`).get() as any;
console.log('Inbound + registry: ' + attr.c);

const totalIn = db.prepare("SELECT COUNT(*) as c FROM calls WHERE direction = 'inbound' AND occurred_at > datetime('now', '-90 days')").get() as any;
console.log('Total inbound (90d): ' + totalIn.c);

// Calls from unknown numbers - direction breakdown
console.log('\n--- UNKNOWN NUMBERS (90d) ---');
const unknown = db.prepare(`
  SELECT c.to_number, c.direction, COUNT(*) as cnt
  FROM calls c
  WHERE c.to_number IS NOT NULL
    AND c.to_number NOT IN (SELECT twilio_number FROM number_registry)
    AND c.occurred_at > datetime('now', '-90 days')
  GROUP BY c.to_number, c.direction
  ORDER BY cnt DESC
  LIMIT 30
`).all() as any[];
for (const u of unknown) {
  console.log(u.to_number + ' | ' + u.direction + ' | ' + u.cnt + ' calls');
}
