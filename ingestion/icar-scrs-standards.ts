/**
 * ACG Legal AI — I-CAR / SCRS Standards Ingestion
 *
 * Carga estándares de reparación de I-CAR (Inter-Industry Conference
 * on Auto Collision Repair) y SCRS (Society of Collision Repair Specialists).
 *
 * Uso: npx tsx ingestion/icar-scrs-standards.ts
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

const STANDARDS: DocDef[] = [
  // ── I-CAR Welding & Steel ──────────────────────────────────────
  {
    categoryId: 'icar_scrs',
    title: 'I-CAR — Steel Welding & Sectioning Standards',
    sourceName: 'I-CAR (Inter-Industry Conference on Auto Collision Repair)',
    sourceSection: 'WCS03 / WCS04 / SPS10',
    contentType: 'standard',
    tags: ['I-CAR', 'welding', 'steel', 'sectioning', 'high-strength', 'GMAW', 'STRSW'],
    content: `I-CAR STEEL WELDING & SECTIONING STANDARDS

Source: I-CAR (Inter-Industry Conference on Auto Collision Repair) — Industry Training Alliance

1. I-CAR WELDING CERTIFICATION SERIES (WCS):
   - WCS01: Steel GMA (MIG) Welding — Qualified
   - WCS02: Steel GMA (MIG) Welding — ProLevel
   - WCS03: Steel Sectioning — ProLevel
   - WCS04: Squeeze-Type Resistance Spot Welding (STRSW)
   - Each requires: in-shop hands-on testing with destructive analysis

2. STEEL IDENTIFICATION IS PARAMOUNT:
   - I-CAR emphasizes that technicians MUST identify the steel grade BEFORE welding.
   - Steel grades cannot be determined by appearance alone.
   - Vehicle maker repair procedures specify the EXACT steel grade at each location.
   - Using the wrong welding parameters on advanced steels can create brittle welds that fail in subsequent collisions.
   - "When in doubt, look it up. Never assume."

3. GMA (MIG) WELDING STANDARDS:
   - ER70S-6 wire: standard for mild steel up to 590 MPa
   - Silicon bronze (CuSi) for MIG brazing: specific applications (some European and Japanese OEMs)
   - Shielding gas: 75% Argon / 25% CO2 unless OEM specifies otherwise
   - Weld penetration: must achieve full fusion at root without burn-through
   - Plug weld diameter: OEM-specified (typically 8mm for structural, 5-6mm for non-structural)
   - Stitch weld length: OEM-specified
   - All structural welds require visual inspection AND destructive testing of test coupons

4. HIGH-STRENGTH STEEL CONSIDERATIONS:
   - HSLA (High-Strength Low-Alloy) up to 590 MPa: standard GMAW acceptable
   - DP (Dual Phase) 590-980 MPa: specific heat control required; some grades are heat-restricted
   - MS (Martensitic) 1180+ MPa: NO HEAT PERMITTED; replacement only
   - PHS (Press-Hardened Steel) 1500 MPa: NO HEAT, NO WELDING; full replacement only
   - I-CAR teaches: "If you can't identify the steel, you can't repair it safely."

5. SECTIONING STANDARDS:
   - Sectioning is ONLY permitted where the vehicle maker provides specific sectioning procedures.
   - Sectioning joints MUST use OEM-specified reinforcement sleeves or backer plates.
   - Cut lines must be located at OEM-specified positions (not "the straightest spot").
   - Sectioning joint types:
     * Open butt joint with backing (most common)
     * Lap joint (where OEM-specified)
     * Insert (sleeve) joint (where OEM-specified)
   - Adhesive MUST be applied to sectioning joints where OEM specifies.
   - All sectioning repairs require post-repair corrosion protection to internal cavities.

6. SQUEEZE-TYPE RESISTANCE SPOT WELDING (STRSW):
   - Used to replicate factory spot welds in areas accessible from both sides.
   - STRSW weld strength must match or exceed factory spot weld specifications.
   - Weld count and location must match factory specifications.
   - Destructive peel testing on test coupons is MANDATORY for STRSW verification.
   - STRSW cannot be used on 3+ layer stacks unless OEM specifically permits.

7. WELD BONDING (ADHESIVE + WELDING):
   - Many modern vehicles use weld bonding at the factory — adhesive applied between panels, then welded.
   - I-CAR requires that aftermarket repairs replicate factory joining methods EXACTLY.
   - If factory used weld bonding, the repair MUST use weld bonding.
   - Structural adhesives must be OEM-specified or equivalent (crash-tested).
   - Adhesives must be applied within their working time window.
   - Adhesive alone is NEVER a substitute for welding on structural joints.

8. CORROSION PROTECTION POST-WELDING:
   - All weld zones must receive corrosion protection immediately after welding.
   - Weld-through primer must be applied between panels before welding.
   - All bare metal edges must be sealed.
   - Internal cavities must be treated with cavity wax after welding.
   - I-CAR standard: "If you can reach a welded area with your hand, it needs corrosion protection."`,
  },

  // ── I-CAR ADAS ──────────────────────────────────────────────────
  {
    categoryId: 'icar_scrs',
    title: 'I-CAR — ADAS Calibration & Diagnostics Standards',
    sourceName: 'I-CAR',
    sourceSection: 'ADE01 / ADE02 / S-CAL courses',
    contentType: 'standard',
    tags: ['I-CAR', 'ADAS', 'calibration', 'scanning', 'diagnostics', 'safety'],
    content: `I-CAR ADAS CALIBRATION & DIAGNOSTICS STANDARDS

Source: I-CAR ADAS courses (ADE01: ADAS Diagnostics, ADE02: ADAS Calibration)

1. PRE-REPAIR SCANNING — MANDATORY:
   - I-CAR standard: ALL vehicles involved in a collision MUST receive a pre-repair diagnostic scan.
   - The pre-scan establishes a baseline — documents DTCs present before repair begins.
   - Pre-scan helps identify:
     * Collision-related damage not visible to the naked eye
     * Pre-existing conditions (protects shop from liability)
     * System functionality baseline for insurance documentation
   - Scan tool must be OEM-compatible — generic OBD-II is NOT sufficient for comprehensive coverage.
   - Scan report must be saved in the repair file.

2. POST-REPAIR SCANNING — MANDATORY:
   - I-CAR standard: ALL vehicles MUST receive a post-repair diagnostic scan.
   - Post-scan verifies that NO new DTCs were introduced during repair.
   - Post-scan confirms all ADAS systems are operational.
   - All DTCs must be cleared and verified as resolved.
   - "A vehicle with active DTCs should never leave the shop."

3. ADAS CALIBRATION — WHEN REQUIRED:
   - I-CAR identifies specific "calibration events" that trigger the need for calibration:
     * Windshield replacement → forward camera
     * Front or rear bumper removal → parking sensors, radar
     * Side mirror replacement → side cameras, blind spot sensors
     * Steering or suspension work → steering angle sensor, lane departure
     * Structural repair → MULTIPLE systems
     * Wheel alignment → steering angle sensor, lane departure
     * Any sensor or module replacement → that system
     * Any DTC in an ADAS module → that system
   - "When in doubt, calibrate. The cost of calibration is less than the liability of non-calibration."

4. STATIC VS DYNAMIC CALIBRATION:
   - Static calibration (in-shop):
     * Requires: OEM-specified targets, level floor, specific lighting, specific distances
     * Used for: forward cameras (most), surround view cameras, some radar
     * Requires exact target placement (mm precision)
     * Shop must have adequate space (minimum 25' x 12' clear area for forward camera)
   - Dynamic calibration (road test):
     * Requires: OEM scan tool connected, specific driving conditions
     * Used for: some radar systems, blind spot monitors
     * Requires clear lane markings, specific speed range, minimal traffic
     * Vehicle drives while scan tool monitors and calibrates
   - Some vehicles require BOTH static and dynamic calibration.

5. COMMON CALIBRATION REQUIREMENTS BY SYSTEM:
   - Forward Collision Warning / Automatic Emergency Braking:
     * Calibration type: Static (target board) or dynamic
     * Often requires BOTH methods for complete calibration
   - Lane Departure Warning / Lane Keep Assist:
     * Static calibration of forward camera (most common)
     * Steering angle sensor zero-point calibration (mandatory after alignment)
   - Blind Spot Monitoring:
     * Static calibration with Doppler simulator or corner reflector
     * Dynamic calibration through road test on multi-lane road
   - 360° Surround View:
     * Static calibration with grid mats OR target patterns
     * Requires specific shop floor layout (typically 20' x 20' minimum)
   - Adaptive Cruise Control:
     * Static calibration of radar sensor (alignment check)
     * Often combined with dynamic calibration

6. DIAGNOSTIC TOOL REQUIREMENTS:
   - I-CAR emphasizes: generic/aftermarket scan tools are INSUFFICIENT for ADAS.
   - Each OEM requires specific diagnostic interfaces:
     * Tesla: Toolbox
     * Ford: IDS / FDRS with VCM III
     * GM: MDI 2 with GDS2
     * Toyota/Lexus: Techstream
     * Honda/Acura: i-HDS
     * BMW: ISTA
     * Mercedes-Benz: XENTRY
   - Scan tool subscription and updates must be current.
   - "An expired scan tool license = an uncalibrated vehicle."

7. DOCUMENTATION REQUIREMENTS:
   - Pre-scan report saved in file.
   - Post-scan report saved in file.
   - Calibration report (which systems, method, result) saved in file.
   - All DTCs documented with resolution.
   - I-CAR Gold Class shops are audited on scan/calibration documentation.

8. LIABILITY CONSIDERATIONS:
   - A shop that performs a collision repair without proper ADAS calibration:
     * Has created an unsafe vehicle
     * Is liable for any accident resulting from ADAS malfunction
     * May face regulatory action from BAR
     * May lose I-CAR certification
   - "Calibration is not optional. It is a required part of the repair."`,
  },

  // ── SCRS Position Statement — OEM Compliance ────────────────────
  {
    categoryId: 'icar_scrs',
    title: 'SCRS — OEM Repair Procedure Compliance Position Statement',
    sourceName: 'SCRS (Society of Collision Repair Specialists)',
    sourceSection: 'SCRS Position Statement on OEM Compliance',
    contentType: 'standard',
    tags: ['SCRS', 'OEM', 'standards', 'position statement', 'safety', 'compliance'],
    content: `SCRS POSITION STATEMENT — OEM REPAIR PROCEDURE COMPLIANCE

Source: Society of Collision Repair Specialists (scrs.com)

1. CORE POSITION:
   "The Society of Collision Repair Specialists maintains that vehicle manufacturers are the only authority on how their vehicles should be repaired. OEM repair procedures are engineering-based specifications designed to restore vehicles to pre-accident condition in terms of safety, durability, and performance."

2. WHY OEM PROCEDURES ARE MANDATORY:
   - Vehicle structures are engineered with specific crash load paths.
   - Materials are selected and processed for specific energy absorption properties.
   - Joining methods are engineered for specific structural requirements.
   - ADAS and safety systems are calibrated to specific parameters.
   - "Any deviation from OEM procedures introduces unknown variables into the vehicle's crash performance."

3. WHEN INSURERS REQUEST PROCEDURE DEVIATIONS:
   - SCRS position: insurers do not have the engineering authority to override OEM procedures.
   - An insurer's estimate is NOT a repair procedure — it is a financial document.
   - The repair facility bears the liability for the repair, not the insurer.
   - "If an insurer insists on a repair method that deviates from OEM procedures, the shop should:
     a) Document the OEM procedure requirement in writing.
     b) Provide the OEM procedure to the insurer.
     c) If the insurer still refuses, document the refusal and the shop's position.
     d) Consider whether the shop can ethically perform the compromised repair."**

4. AFTERMARKET PARTS POSITION:
   - SCRS does not categorically oppose aftermarket parts but holds that:
     * Structural aftermarket parts have NOT been validated by OEMs for crash performance.
     * Cosmetic aftermarket parts may have fit, finish, and corrosion differences.
     * Electronic aftermarket parts (sensors, modules) may not communicate correctly with vehicle networks.
     * The shop must inform the customer when non-OEM parts are being used.
   - "The decision to use aftermarket parts should be disclosed to the vehicle owner with full transparency."

5. SCAN & CALIBRATION POSITION:
   - "Pre-repair and post-repair diagnostic scanning is a required part of a complete and safe repair."
   - "Calibration of ADAS components is not an optional service — it is a required repair operation."
   - SCRS supports the I-CAR position that ALL vehicles should be scanned pre- and post-repair.
   - "The cost of scanning and calibration should be included in every repair estimate."

6. REPAIRER LIABILITY:
   - The repair facility (not the insurer, not the vehicle manufacturer) bears liability for repair quality.
   - Under California law, repairers have a duty of care to perform repairs to industry standards.
   - Industry standard = OEM procedures + I-CAR standards + SCRS best practices.
   - A repairer who knowingly deviates from OEM procedures may be found negligent in subsequent litigation.

7. CONSUMER EDUCATION:
   - SCRS encourages repairers to educate consumers about:
     * Their right to choose the repair facility.
     * The importance of OEM procedures for safety.
     * The difference between OEM and aftermarket parts.
     * The role of pre- and post-repair scanning.
     * Their right to a complete and safe repair.

8. REGULATORY SUPPORT:
   - SCRS supports regulations that require:
     * Insurers to acknowledge OEM procedures as the repair standard.
     * Disclosure to consumers when non-OEM parts are specified.
     * Inclusion of scanning and calibration in all repair estimates.
     * Enforcement against insurers who systematically deny OEM-required operations.`,
  },

  // ── SCRS — Consumer Rights Guide ─────────────────────────────────
  {
    categoryId: 'icar_scrs',
    title: 'SCRS — Consumer Rights in Collision Repair',
    sourceName: 'SCRS (Society of Collision Repair Specialists)',
    sourceSection: 'SCRS Consumer Rights',
    contentType: 'standard',
    tags: ['SCRS', 'consumer_rights', 'repair_choice', 'OEM', 'parts', 'safety'],
    content: `SCRS CONSUMER RIGHTS IN COLLISION REPAIR

Source: Society of Collision Repair Specialists (scrs.com)

1. RIGHT TO CHOOSE:
   - Consumers have the right to choose ANY collision repair facility.
   - Insurers may recommend shops but CANNOT require consumers to use a specific shop.
   - "Steering" — the practice of directing consumers to specific shops — is illegal in California (Ins. Code §758).
   - Consumers who feel pressured to use a specific shop should report it to the California Department of Insurance.

2. RIGHT TO OEM PROCEDURES:
   - Consumers have the right to a repair that follows the vehicle manufacturer's specifications.
   - The vehicle manufacturer is the only authority on how the vehicle should be repaired.
   - If an insurer's estimate omits OEM-required operations, the consumer should ask why.
   - A repair that doesn't follow OEM procedures may not restore the vehicle to pre-accident safety.

3. RIGHT TO INFORMATION:
   - Consumers have the right to know:
     * What parts are being used (OEM vs aftermarket vs recycled)
     * What repair procedures are being followed
     * Whether pre- and post-repair scanning is being performed
     * What calibrations are required after the repair
     * The warranty terms on parts and labor
   - This information should be provided in writing.

4. RIGHT TO OEM PARTS:
   - In California, consumers have the right to request OEM parts for their collision repair.
   - For vehicles under warranty, non-OEM parts may void the vehicle warranty for the affected components.
   - California Insurance Code §758.5 requires insurer disclosure of non-OEM parts use.
   - Consumers should ask for OEM parts in writing and keep a copy of the request.

5. RIGHT TO A COMPLETE REPAIR:
   - A "complete repair" means:
     * All visible damage repaired
     * All structural damage repaired per OEM procedures
     * All safety systems restored to pre-accident functionality
     * All ADAS systems calibrated
     * All corrosion protection applied
   - A "cheaper" repair that skips steps is not a complete repair.
   - Consumers should ask: "Will this repair restore my vehicle to pre-accident condition?"

6. RIGHT TO HOLD THE SHOP ACCOUNTABLE:
   - Shops must stand behind their work.
   - Ask about the shop's warranty before authorizing repairs.
   - ACG offers a lifetime warranty — consumers should value this as a quality signal.
   - If repair quality is unsatisfactory, consumers can file a complaint with BAR.

7. RED FLAGS FOR CONSUMERS:
   - The shop says "we follow what insurance pays" (instead of "we follow OEM procedures").
   - The shop doesn't scan vehicles before and after repair.
   - The shop can't explain what calibration is needed.
   - The shop uses aftermarket parts without disclosing.
   - The insurer offers a "guarantee" if you use "their" shop — this is illegal steering.

8. HOW ACG ALIGNS:
   - ACG exclusively uses OEM parts — this is above industry standard.
   - ACG follows OEM procedures for every repair.
   - ACG scans every vehicle pre- and post-repair.
   - ACG calibrates all ADAS systems.
   - ACG offers lifetime warranty on repairs.
   - ACG advocates for the customer against insurers who try to cut corners.`,
  },

  // ── I-CAR Gold Class Standards ──────────────────────────────────
  {
    categoryId: 'icar_scrs',
    title: 'I-CAR Gold Class — Shop Certification Standards',
    sourceName: 'I-CAR',
    sourceSection: 'Gold Class Recognition Program',
    contentType: 'standard',
    tags: ['I-CAR', 'Gold Class', 'certification', 'training', 'standards'],
    content: `I-CAR GOLD CLASS SHOP CERTIFICATION STANDARDS

Source: I-CAR (i-car.com/goldclass)

1. WHAT IS I-CAR GOLD CLASS:
   - I-CAR Gold Class is the INDUSTRY STANDARD for collision repair training and certification.
   - Gold Class shops have demonstrated that their technicians are trained in the latest repair procedures and technologies.
   - Only approximately 20% of collision repair shops nationwide achieve and maintain Gold Class status.
   - Gold Class is REQUIRED by many OEM certification programs (Toyota, Ford, GM, Honda, etc.).

2. GOLD CLASS REQUIREMENTS:
   - Annual training requirements for ALL technicians (not just lead techs).
   - Role-based training paths: Estimator, Steel Structural Technician, Aluminum Structural Technician, Non-Structural Technician, Refinish Technician.
   - Training must be verified and current every year.
   - New hires must complete training within a specified timeframe.
   - Shop must maintain a minimum number of ProLevel-trained technicians in each role.

3. KEY TRAINING AREAS:
   - Steel Welding & Sectioning (WCS series)
   - Aluminum Welding & Repair (WCA series)
   - ADAS Diagnostics & Calibration (ADE series)
   - Non-Structural Repair & Replacement (NSR series)
   - Refinishing (REF series)
   - Plastic & Composite Repair (PLA series)
   - Damage Analysis & Estimating (DAM series)
   - Vehicle Technology (hybrid, EV, high-voltage safety)

4. PROLEVEL RECOGNITION:
   - ProLevel 1: Introductory knowledge
   - ProLevel 2: Advanced knowledge + hands-on skill validation
   - ProLevel 3: Master-level — requires years of experience + advanced certification
   - Each role has its own ProLevel track.

5. GOLD CLASS BENEFITS:
   - Consumer recognition: Gold Class is the most recognized quality signal in collision repair.
   - OEM certification prerequisite: most OEM programs require Gold Class.
   - Insurance DRP preference: many insurers prefer or require Gold Class.
   - Reduced liability: trained technicians make fewer errors.
   - Improved cycle time: trained technicians work more efficiently.

6. GOLD CLASS RENEWAL & AUDITS:
   - Annual renewal required.
   - Training records must be maintained and verifiable.
   - I-CAR conducts random audits of Gold Class shops.
   - Technicians who let training lapse must retake relevant courses.
   - Shops that fail to maintain standards may lose Gold Class designation.

7. GOLD CLASS AND ACG:
   - ACG should maintain or pursue I-CAR Gold Class at all locations.
   - Gold Class is a competitive differentiator — only 1 in 5 shops have it.
   - Gold Class supports ACG's positioning as a premium, OEM-focused repairer.
   - Gold Class helps defend against insurer pushback: "Our technicians are I-CAR trained and follow OEM procedures."
   - Gold Class status can be verified by consumers at i-car.com/goldclass.`,
  },
];

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  ACG Legal AI — I-CAR/SCRS Standards     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let loaded = 0;
  let skipped = 0;

  for (const doc of STANDARDS) {
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
    `).run(docId, doc.categoryId, doc.title, doc.sourceName, doc.sourceSection || null, doc.contentType, now, JSON.stringify({ tags: doc.tags, ingested_via: 'icar-scrs-script' }));

    const chunks = chunkText(doc.content, 800, 200);
    for (let i = 0; i < chunks.length; i++) {
      db.prepare(`
        INSERT INTO legal_chunks (id, document_id, chunk_index, content, char_count, token_estimate)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), docId, i, chunks[i], chunks[i].length, Math.ceil(chunks[i].length / 4));
    }

    console.log(`  ✅ LOADED: ${doc.title} (${chunks.length} chunks)`);
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
