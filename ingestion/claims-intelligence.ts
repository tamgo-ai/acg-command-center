/**
 * ACG Legal AI — Claims Intelligence: Insurance Company Playbooks
 *
 * Guías tácticas por aseguradora: cómo operan, qué niegan, cómo contrarrestarlos
 * con fundamento legal para que ACG cobre lo que realmente corresponde.
 *
 * Uso: npx tsx ingestion/claims-intelligence.ts
 */

import { getLocalDb } from '../config/local-db';
import { randomUUID } from 'crypto';

const db = getLocalDb();

interface DocDef {
  categoryId: string;
  title: string;
  sourceName: string;
  sourceSection?: string;
  contentType: string;
  tags: string[];
  content: string;
}

// ── Claims Intelligence Documents ──────────────────────────────────────

const INSURER_PLAYBOOKS: DocDef[] = [
  // ═══════════════════════════════════════════════════════════════════
  // STATE FARM
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'State Farm — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — State Farm',
    contentType: 'guide',
    tags: ['State Farm', 'claims', 'DRP', 'supplements', 'labor_rate', 'OEM_parts', 'negotiation'],
    content: `STATE FARM MUTUAL AUTOMOBILE INSURANCE COMPANY
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

State Farm is the LARGEST auto insurer in California with approximately 18-20% market share. Their claims handling approach is characterized by aggressive cost containment, a preferred shop network (Select Service), and systematic use of aftermarket parts specifications.

═══ KNOWN PATTERNS & TACTICS ═══

1. LOW INITIAL ESTIMATES:
   - State Farm consistently writes initial estimates 30-50% below what the repair actually requires.
   - Tactics: exclude OEM-required operations (pre/post-scan, calibration, corrosion protection), use aftermarket parts by default, use lowest available labor rate.
   - Tactic name internally: "aggressive first estimate" — designed to set a low anchor.

2. AFTERMARKET PARTS DEFAULT:
   - State Farm's estimating system (CCC/Mitchell) defaults to aftermarket parts.
   - They will specify aftermarket bumpers, fenders, hoods, headlamps, radiators, and condensers.
   - Policy: OEM parts must be specifically requested and justified on every estimate line.
   - For vehicles older than 2 years, aftermarket is automatic.

3. LABOR RATE SUPPRESSION:
   - State Farm maintains a "market rate survey" that systematically underreports prevailing rates.
   - They will offer $60-75/hr when the actual market rate in California is $85-130/hr.
   - They claim their rate is "prevailing" based on DRP shop agreements (which are artificially low in exchange for volume).
   - Labor rate is NOT a fixed number — it's a NEGOTIABLE item per California regulation.

4. SUPPLEMENT RESISTANCE:
   - First supplement: generally processed within 48 hours.
   - Second supplement: may be delayed 5-7 business days.
   - Third supplement: often requires supervisor review, significant delays.
   - Tactic: wear down the shop through delays and repeated documentation requests.

5. SCAN & CALIBRATION DENIAL:
   - State Farm frequently denies pre/post-repair scanning as "not necessary" or "diagnostic, not repair."
   - ADAS calibration is often challenged as "not related to the collision damage."
   - They may ask: "Was the scan related to collision damage?" — designed to shift burden to the shop.

═══ COUNTER-STRATEGIES ═══

A. FOR AFTERMARKET PARTS:
   - Cite California Insurance Code §758.5(b): "No insurer shall require the use of non-OEM replacement crash parts in the repair of an automobile unless the parts are at least equal to the original equipment manufacturer parts in terms of kind, quality, safety, fit, and performance."
   - Demand that State Farm provide WRITTEN certification that the specified aftermarket part meets ALL five criteria.
   - For structural parts: cite OEM position statements (Ford, Honda, Toyota, etc.) that state aftermarket structural parts have NOT been crash-tested or validated.
   - For vehicles under manufacturer warranty: cite the vehicle warranty terms and the Magnuson-Moss Warranty Act (15 USC §2302) — using non-OEM parts may void warranty coverage.
   - Economic argument: aftermarket parts often require modification to fit, increasing labor time. Document ALL additional labor for aftermarket part fitment and submit as a supplement.

B. FOR LABOR RATE:
   - California Insurance Code §758(c): insurers shall not "limit or discount the reasonable repair costs based upon charges that would have been incurred had the vehicle been repaired at the insurer's preferred shop."
   - Document ACG's posted labor rate (must be posted in the shop per BAR).
   - Request State Farm's "market rate survey" methodology in writing — they rarely provide it because it doesn't hold up to scrutiny.
   - If State Farm insists on a lower rate: "We accept that rate for the DRP portion, but the difference must be billed to the vehicle owner per California law. We will inform the vehicle owner of this additional charge."
   - The vehicle owner is entitled to a complete repair. The insurer's failure to pay the full rate is between the insurer and the insured, NOT between the shop and the insurer.

C. FOR SCAN/CALIBRATION DENIAL:
   - Cite OEM position statements (ALL major OEMs require pre- and post-repair scanning).
   - Cite I-CAR standards: pre- and post-repair scanning is MANDATORY.
   - Cite 10 CCR §2695.8(c): "Reasonable adjustment costs shall include... all reasonable costs associated with returning the vehicle to its pre-loss condition."
   - If the vehicle has ADAS: cite the OEM's specific calibration requirement by VIN (print the OEM procedure page).
   - "State Farm, you are asking ACG to deliver a vehicle with uncalibrated safety systems. If this vehicle is involved in an accident due to ADAS malfunction, ACG will name State Farm in any resulting litigation for instructing us to skip a safety-critical operation."

D. FOR SUPPLEMENT DELAYS:
   - California Fair Claims Settlement Practices (10 CCR §2695.7): insurers must respond to communications within 15 calendar days.
   - For supplements specifically: 10 CCR §2695.8(c) — reasonable costs must be paid promptly.
   - If State Farm delays beyond 5 business days without explanation: "This supplement has been pending for [X] days. Please advise if State Farm is disputing any line item. If no dispute is raised within 48 hours, ACG will proceed with repairs and the vehicle owner will be informed of the out-of-pocket balance."
   - Document every supplement submission with date/time stamps.
   - For third+ supplements: request supervisor contact information and escalate early.

E. DIMINISHED VALUE:
   - State Farm's position: diminished value is not owed in California (they are WRONG).
   - California recognizes INHERENT diminished value (the loss in market value after an accident, even with perfect repairs).
   - Cite: California Civil Jury Instructions (CACI 3903J) — diminished value is a recoverable element of damages.
   - State Farm will fight diminished value claims aggressively. The burden is on the claimant to prove DV, typically through a professional DV appraisal.
   - ACG strategy: offer DV appraisal as a customer service. Even if the insurer doesn't pay, the customer knows ACG fought for them.

F. BAD FAITH INDICATORS (DOCUMENT THESE):
   - Systematic undervaluation of claims (pattern of 30%+ below actual repair cost).
   - Requiring the use of aftermarket parts without §758.5 certification.
   - Unreasonable delays in supplement processing.
   - Refusing to acknowledge OEM procedures as the repair standard.
   - Misrepresenting policy provisions to the insured.
   - California Insurance Code §790.03(h) defines unfair claims settlement practices — document each instance.
   - Bad faith findings: plaintiff may recover attorney's fees, punitive damages, and emotional distress damages.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // GEICO
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'GEICO — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — GEICO',
    contentType: 'guide',
    tags: ['GEICO', 'claims', 'supplements', 'photo_estimates', 'OEM_parts', 'negotiation'],
    content: `GEICO (GOVERNMENT EMPLOYEES INSURANCE COMPANY)
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

GEICO is the SECOND LARGEST auto insurer in California. GEICO operates with a highly centralized claims model, heavy reliance on technology (photo estimates via app), and an Auto Repair Xpress (ARX) DRP network.

═══ KNOWN PATTERNS & TACTICS ═══

1. PHOTO ESTIMATE DEPENDENCY:
   - GEICO aggressively pushes their mobile app photo estimate ("GEICO Mobile").
   - The photo estimate is intentionally limited — it captures only visible surface damage.
   - Hidden structural damage, ADAS calibration requirements, and OEM procedures are systematically excluded.
   - The photo estimate creates an artificially low "anchor" that constrains subsequent supplements.

2. PARTS PROCUREMENT INTERFERENCE:
   - GEICO has direct parts procurement agreements with aftermarket suppliers (Keystone, CertiFit, LKQ).
   - They will drop-ship aftermarket parts directly to the shop without consultation.
   - They may claim "the parts are already on the way" as pressure to accept them.
   - This violates California Insurance Code §758.5 which requires consumer consent for non-OEM parts.

3. SUPPLEMENT COMPLEXITY:
   - GEICO uses a centralized supplement review process. Supplements go to a regional center, not a local adjuster.
   - The reviewing adjuster never sees the vehicle in person.
   - Supplements are frequently "partially approved" with line items denied without specific justification.
   - Re-submission of denied line items goes to a different adjuster, creating inconsistency.

4. VEHICLE "TOTAL LOSS" AGGRESSION:
   - GEICO uses a low total loss threshold (typically 70-75% of Actual Cash Value).
   - They will attempt to total vehicles that are repairable to avoid supplement-heavy repairs.
   - Their ACV valuations (via CCC) systematically undervalue vehicles — often 10-15% below market.
   - Once a vehicle is declared total loss, the claim moves to a different department, which can delay resolution.

5. DRP PRESSURE:
   - GEICO's ARX shops accept GEICO's labor rates, parts policies, and estimating guidelines in exchange for volume.
   - Non-ARX shops face more resistance on supplements, rates, and parts.
   - GEICO may tell the customer "the repair will be faster/easier if you use an ARX shop" — this is STEERING and is illegal in California.

═══ COUNTER-STRATEGIES ═══

A. COMBATING PHOTO ESTIMATES:
   - NEVER accept a photo estimate as the basis for repair.
   - "This photo estimate is an incomplete assessment. ACG will perform a complete teardown and blueprint the vehicle per OEM procedures. The resulting supplement will reflect the actual required repair operations."
   - Preemptively communicate to the customer: "GEICO's photo estimate is a preliminary document, not a repair blueprint. The actual repair cost will be determined after teardown and will be documented in supplements."
   - California law: the repair facility determines the repair procedures, not the insurer. 10 CCR §2695.8(c).

B. FOR DROP-SHIPPED AFTERMARKET PARTS:
   - "ACG does not accept unsolicited drop-shipped parts. Per California Insurance Code §758.5, the vehicle owner must consent to non-OEM parts in writing. Please provide the consumer's signed consent or issue a return authorization for these parts."
   - Inspect ALL drop-shipped parts before installation. Document every fit, finish, or quality issue with photos and notes.
   - For structural aftermarket parts: "This is a structural component. [Manufacturer] has not crash-tested aftermarket versions. ACG cannot install a part not validated for crash safety."
   - Return non-conforming parts and bill GEICO for the return shipping and handling time.

C. SUPPLEMENT PROCESS:
   - Submit supplements with COMPLETE documentation on first submission: OEM procedure pages, photos, measurements, calibration requirements.
   - Anticipate GEICO's denials and pre-buttal them in the supplement: "This operation is required by [OEM] per attached procedure [page X]. GEICO's prior denial of similar operations was overridden upon supervisor review."
   - Maintain a supplement log with submission dates, approval dates, and denied line items.
   - If a supplement is partially denied: request the specific justification for EACH denied line item in writing.
   - Escalate to supervisor after second supplement delay > 5 business days.

D. TOTAL LOSS DEFENSE:
   - If the vehicle is borderline total loss: provide a detailed repair plan with parts pricing that demonstrates feasibility.
   - Challenge the ACV valuation: request the CCC report and the comparable vehicles used. Identify discrepancies.
   - If the vehicle has recently had major work (engine, transmission, etc.), provide receipts — this increases ACV.
   - "GEICO's total loss valuation does not reflect the actual market value of this vehicle. We request a re-evaluation using local market comparables."

E. STEERING DOCUMENTATION:
   - If GEICO tells a customer anything that suggests using a different shop: DOCUMENT IT.
   - California Insurance Code §758(a): "No insurer shall require that an automobile be repaired at a specific automotive repair dealer."
   - Steering is an UNFAIR CLAIMS PRACTICE under §790.03(h).
   - Report steering to the California Department of Insurance (CDI) — repeated steering complaints trigger CDI investigations.

F. ADDITIONAL LEVERAGE POINTS:
   - GEICO is subject to CDI market conduct examinations. Pattern complaints trigger examinations.
   - GEICO's internal metrics reward adjusters for "cycle time" and "severity control." When a claim stalls, the adjuster's metrics suffer. Use this knowledge:
     * If a supplement is delayed, the adjuster's cycle time metric is being hurt. Escalate to their supervisor: "This claim has been open for [X] days with supplements pending." Adjusters are measured on this.
   - "GEICO, we have documented [X] instances of aftermarket part specification without consumer consent on this claim alone. If this pattern continues, ACG will provide this documentation to the CDI for a market conduct review."`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // PROGRESSIVE
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'Progressive — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — Progressive',
    contentType: 'guide',
    tags: ['Progressive', 'claims', 'photo_estimates', 'labor_rate', 'OEM_parts', 'DRP', 'negotiation'],
    content: `PROGRESSIVE CASUALTY INSURANCE COMPANY
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

Progressive is the THIRD LARGEST auto insurer in California. Progressive operates with a heavy technology focus, a "Name Your Price" marketing model that pressures margins, and an aggressive cost containment approach. Progressive was an early pioneer of photo estimating and continues to invest heavily in automation to reduce claims costs.

═══ KNOWN PATTERNS & TACTICS ═══

1. AGGRESSIVE PHOTO ESTIMATE MODEL:
   - Progressive's "Photo Estimate" (via app) is their DEFAULT first response.
   - The photo estimate is designed to close claims quickly at the lowest possible cost.
   - Progressive adjusters are incentivized to close claims within 7 days — speed is prioritized over accuracy.
   - The photo estimate systematically omits: structural repair time, ADAS calibration, scanning, corrosion protection, OEM-specific procedures, blend time on adjacent panels.

2. LABOR RATE AGGRESSION:
   - Progressive is one of the most aggressive on labor rate suppression.
   - They will offer $55-$65/hr even in high-cost California markets where prevailing rates are $90-$130/hr.
   - Progressive uses "market surveys" that include DRP shops (artificially low), mechanical shops (not collision), and rural shops inappropriately compared to urban locations.
   - They may cite "usual and customary" rates without providing the underlying data.

3. CONCIERGE-LEVEL CLAIM HANDLING (for their insureds):
   - Progressive has a "Concierge" claims program where they take physical possession of the vehicle and direct it to a DRP shop.
   - This program is a sophisticated form of STEERING — the insured is told it's "convenience."
   - Once the vehicle is in Concierge, the insured rarely sees the repair facility or estimate details.
   - ACG loses the repair because the vehicle never reaches the shop.

4. PARTS USAGE:
   - Progressive defaults to aftermarket AND recycled (LKQ/salvage) parts.
   - They will specify LKQ parts that are older, higher mileage, or from different model years.
   - For suspension and mechanical components: they will specify used parts from salvage yards, which may have unknown wear/damage.
   - California law requires that used parts be "of like kind and quality" — a 5-year-old strut assembly with 60,000 miles is NOT "like kind and quality" to the damaged 2-year-old unit.

5. DIMINISHED VALUE POSITION:
   - Progressive has an AGGRESSIVE anti-diminished-value stance.
   - They will claim: "Diminished value does not apply in California" (FALSE).
   - They will claim: "The repair restores the vehicle to pre-loss condition so there is no diminished value" (FALSE — inherent DV exists even with perfect repairs).
   - Progressive has litigated DV claims more aggressively than most insurers.

═══ COUNTER-STRATEGIES ═══

A. ESCAPING THE PHOTO ESTIMATE TRAP:
   - "Progressive, the photo estimate is incomplete and does not reflect the required repair per [OEM] procedures. ACG will perform a complete teardown and submit a comprehensive supplement."
   - Educate the customer EARLY: "Progressive's photo estimate is designed to settle claims quickly, not to restore your vehicle properly. We will document everything the photo estimate missed and fight for a complete repair."
   - If Progressive pressures the customer to accept the photo estimate payout: "That payout would not cover a complete repair. The customer would be left with a partially repaired vehicle and the insurer would be in bad faith for attempting to settle for less than the actual repair cost."

B. LABOR RATE NEGOTIATION:
   - Post ACG's labor rate prominently (BAR requirement — but it's also leverage).
   - "ACG's posted labor rate is $[XX]/hr. This is the rate charged to all customers regardless of insurance involvement."
   - Request Progressive's "market survey" in writing, including:
     * Which shops were surveyed
     * Their collision repair certifications (I-CAR, OEM)
     * Whether they are DRP shops
     * Geographic proximity to ACG's location
   - Progressive will rarely provide this data because the survey methodology is indefensible under scrutiny.
   - California Insurance Code §758(c): insurers shall not discount repair costs based on what a preferred shop would charge.
   - "The difference between Progressive's offered rate and ACG's posted rate is $[XX]/hr. This will be billed to the vehicle owner. ACG will advise the owner that their insurer is not covering the full cost of a proper repair."

C. COUNTERING CONCIERGE STEERING:
   - When ACG encounters a customer who was directed to Concierge: "You have the absolute right to choose your repair facility. Progressive's Concierge program is optional. If you prefer, we can handle the entire repair and Progressive must work with us per California law."
   - Insurance Code §758(a): the customer chooses the shop. Concierge is a voluntary program, not a requirement.
   - If Progressive tells the customer Concierge is required or implies it's the only option: this is TEXTBOOK STEERING. Document and report to CDI.

D. LKQ/SALVAGE PARTS COUNTER:
   - For structural components: aftermarket/salvage structural parts should NEVER be accepted. Cite OEM position statements.
   - For mechanical components: demand the EXACT donor vehicle VIN, mileage, and condition. Compare to the damaged component's age/condition.
   - "This LKQ strut assembly has [XX,XXX] miles from a [YEAR] donor. The damaged unit on this [YEAR] vehicle had only [XX,XXX] miles. This is not 'like kind and quality' per California Insurance Code §758.5."
   - For electronic/sensor components: aftermarket/salvage sensors and modules may not communicate correctly. OEM position is clear — use only OEM electronics.

E. DIMINISHED VALUE:
   - California DOES recognize inherent diminished value. CACI 3903J.
   - The measure of damages in a property damage claim includes the difference between pre-loss market value and post-repair market value.
   - Even a PERFECT repair leaves a "stigma" — the vehicle now has an accident history (Carfax, AutoCheck).
   - "Progressive, per California Civil Jury Instruction 3903J, the vehicle owner is entitled to recover diminished value. ACG has a professional DV appraisal documenting a loss of $[X,XXX] in market value."
   - If Progressive denies: advise the customer to pursue DV through small claims court (up to $10,000 in California). Provide the DV appraisal and supporting documentation. Progressive often settles before the hearing.

F. BAD FAITH DOCUMENTATION (PROGRESSIVE-SPECIFIC):
   - Document every instance of: photo estimate that misses >30% of repair cost, aftermarket part specification without consumer consent, labor rate below the documented prevailing rate, supplement delay >10 days, refusal to acknowledge OEM procedures.
   - Progressive has been the subject of multiple bad faith lawsuits in California for systematic underpayment of collision claims. Pattern evidence is powerful.
   - "Progressive, ACG has documented [X] instances on this claim alone that appear to violate California Fair Claims Settlement Practices regulations. We request that a claims supervisor review this file before it escalates further."`,
  },
];

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  ACG Claims Intelligence — Insurer Intel ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let loaded = 0;
  let skipped = 0;

  for (const doc of INSURER_PLAYBOOKS) {
    const existing = db.prepare(
      'SELECT id FROM legal_documents WHERE title = ? AND source_name = ?'
    ).get(doc.title, doc.sourceName) as any;

    if (existing) {
      console.log(`  ⏭️  SKIP: ${doc.title}`);
      skipped++;
      continue;
    }

    const docId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO legal_documents (id, category_id, title, source_name, source_section, content_type, status, last_updated, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(docId, doc.categoryId, doc.title, doc.sourceName, doc.sourceSection || null, doc.contentType, now, JSON.stringify({ tags: doc.tags, ingested_via: 'claims-intelligence-script' }));

    const chunks = chunkText(doc.content, 800, 200);
    for (let i = 0; i < chunks.length; i++) {
      db.prepare(`
        INSERT INTO legal_chunks (id, document_id, chunk_index, content, char_count, token_estimate)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), docId, i, chunks[i], chunks[i].length, Math.ceil(chunks[i].length / 4));
    }

    console.log(`  ✅ LOADED: ${doc.title} (${chunks.length} chunks, ${doc.content.length} chars)`);
    loaded++;
  }

  console.log(`\n📊 Summary: ${loaded} loaded, ${skipped} skipped`);
  console.log('Done. ✅\n');
}

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

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
