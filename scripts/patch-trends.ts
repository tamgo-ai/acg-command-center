import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('server/local-api.ts', 'utf-8');

const start = content.indexOf('// ── GET /api/trends');
const end = content.indexOf('// ── GET /api/calls/recent');

if (start === -1 || end === -1) {
  console.log('Markers not found. Start:', start, 'End:', end);
  process.exit(1);
}

const newTrends = `// ── GET /api/trends — Tendencias temporales completas ──────────
app.get('/api/trends', (_req, res) => {
  // Daily calls by channel (60 days, inbound only)
  const byChannel = db.prepare(\`
    SELECT date(occurred_at) as day, nr.channel, COUNT(*) as calls,
           ROUND(AVG(c.duration_sec), 0) as avg_dur
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-60 days')
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY day, nr.channel ORDER BY day
  \`).all();

  // Daily totals
  const dailyTotal = db.prepare(\`
    SELECT date(occurred_at) as day, COUNT(*) as total_calls,
           ROUND(AVG(duration_sec), 0) as avg_dur
    FROM calls c
    JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-60 days')
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY day ORDER BY day
  \`).all();

  // Weekly by channel
  const weekly = db.prepare(\`
    SELECT strftime('%Y-W%W', occurred_at) as week, nr.channel, COUNT(*) as calls
    FROM calls c JOIN number_registry nr ON c.to_number = nr.twilio_number
    WHERE c.occurred_at > datetime('now', '-60 days')
      AND nr.channel != 'call_center' AND c.direction = 'inbound'
    GROUP BY week, nr.channel ORDER BY week
  \`).all();

  // Drop-offs by month
  const dropsMonthly = db.prepare(\`
    SELECT strftime('%Y-%m', scheduled_at) as month, location_id,
           COUNT(*) as apps,
           SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) as drops
    FROM appointments
    WHERE scheduled_at > datetime('now', '-6 months') AND location_id IS NOT NULL
    GROUP BY month, location_id ORDER BY month
  \`).all();

  // Spend by month
  const spendMonthly = db.prepare(\`
    SELECT strftime('%Y-%m', date) as month, channel, SUM(spend) as spend
    FROM ad_spend GROUP BY month, channel ORDER BY month
  \`).all();

  res.json({ byChannel, dailyTotal, weekly, dropsMonthly, spendMonthly });
});

`;

content = content.slice(0, start) + newTrends + content.slice(end);
writeFileSync('server/local-api.ts', content);
console.log('✅ Trends API replaced');
