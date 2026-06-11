// ACG Command Center — Pipeline de Ingesta Completo
// Orquesta: Twilio → CRM → Identity Resolution → Métricas → Briefing

import { execSync } from 'child_process';

const STEPS = [
  { name: 'Twilio (Calls + SMS)', script: 'ingestion/twilio.ts' },
  { name: 'CRM (Appointments)', script: 'ingestion/crm.ts' },
  { name: 'Identity Resolution', script: 'agents/identity-resolver.ts' },
  { name: 'Métricas Canónicas', script: 'agents/metrics.ts' },
  { name: 'Briefing Diario', script: 'agents/briefing.ts' },
];

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   ACG COMMAND CENTER — Pipeline de Ingesta Completo     ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${i + 1}/${STEPS.length}] ${step.name}`);
    console.log(`${'─'.repeat(60)}`);

    try {
      execSync(`npx tsx ${step.script}`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      console.log(`✅ ${step.name} — OK`);
    } catch (err: any) {
      console.error(`❌ ${step.name} — FALLÓ: ${err.message}`);
      // ¿Seguir o parar? Seguir — cada paso es independiente.
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏁 Pipeline completo en ${elapsed}s`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(console.error);
