/**
 * ACG Legal AI — OEM Procedures Ingestion
 *
 * Carga procedimientos de reparación y position statements de los
 * principales fabricantes (Tesla, Ford, GM, Toyota, Honda).
 *
 * Fuentes:
 * - Position statements públicos de fabricantes
 * - NHTSA OEM Repair Procedures mandate
 * - I-CAR OEM Repair Procedure Advisory
 * - SCRS position statements on OEM compliance
 *
 * Uso: npx tsx ingestion/oem-procedures.ts
 */

import { getLocalDb } from '../config/local-db';
import { randomUUID } from 'crypto';

const db = getLocalDb();

// ── Content ────────────────────────────────────────────────────────────

interface DocDef {
  categoryId: string;
  title: string;
  sourceName: string;
  sourceSection?: string;
  contentType: string;
  tags: string[];
  content: string;
}

const OEM_DOCUMENTS: DocDef[] = [
  // ── NHTSA OEM Repair Mandate ──────────────────────────────────────
  {
    categoryId: 'oem_procedures',
    title: 'NHTSA OEM Repair Procedure Mandate — All Manufacturers',
    sourceName: 'NHTSA / Federal Motor Vehicle Safety Standards',
    sourceSection: '49 CFR Part 583 / 49 USC 30122',
    contentType: 'regulation',
    tags: ['NHTSA', 'OEM', 'federal', 'repair_procedures', 'safety'],
    content: `NATIONAL HIGHWAY TRAFFIC SAFETY ADMINISTRATION (NHTSA)
OEM REPAIR PROCEDURE MANDATE — ALL MANUFACTURERS

Federal regulations require all automobile manufacturers to make their repair procedures, technical service bulletins (TSBs), and service manuals available to independent repair shops, including collision repair facilities.

KEY REQUIREMENTS:

1. Manufacturer Obligation (49 USC 30122 – Making Safety Devices and Elements Available to Repair Industry):
   - All manufacturers MUST make available to the aftermarket and independent repair industry the same repair information, tools, and training as they provide to their franchised dealers.
   - This includes technical service bulletins (TSBs), repair manuals, wiring diagrams, scan tool data, and software updates.
   - Information must be made available at a "fair and reasonable price" for daily, monthly, or yearly access.

2. Repair Procedure Supremacy:
   - OEM repair procedures are the authoritative standard for collision repair.
   - Any deviation from OEM procedures must be documented and justified.
   - Insurance estimates that fail to include OEM-required operations are legally challengeable.

3. Position Statement Authority:
   - OEM position statements carry regulatory weight as the manufacturer's official guidance on repair methods.
   - Common position statement topics: welding methods, sectioning, ADAS calibration, aluminum repair, use of aftermarket parts, pre- and post-repair scanning.
   - When an insurer disputes an OEM requirement, the burden of proof is on the insurer to demonstrate an equivalent alternative.

4. Safety Systems Compliance:
   - Modern vehicles contain Advanced Driver Assistance Systems (ADAS) that require specific calibration procedures after collision repair.
   - Failure to follow OEM calibration procedures creates liability for the repair facility AND the insurer.
   - Pre-repair and post-repair diagnostic scanning is required by most OEMs.

5. Enforcement:
   - NHTSA can investigate and penalize manufacturers who fail to comply with 49 USC 30122.
   - The FTC has authority over unfair or deceptive acts related to repair restrictions.
   - California BAR enforces repair standards at the state level.

COMPLIANCE IMPACT FOR ACG:
- ACG's policy of exclusively using OEM procedures is not just a quality standard — it is a legal compliance requirement.
- Every repair file should include documentation of the OEM procedures consulted.
- When an insurer pushes back on an OEM-required operation (e.g., pre-scan, calibration, OEM parts), cite NHTSA mandate and the specific OEM position statement.`,
  },

  // ── Tesla Position Statement ─────────────────────────────────────
  {
    categoryId: 'oem_procedures',
    title: 'Tesla Collision Repair — OEM Position Statement & Requirements',
    sourceName: 'Tesla Motors',
    sourceSection: 'Tesla Collision Repair Program / tesla.com/collision-repair',
    contentType: 'oem',
    tags: ['Tesla', 'OEM', 'aluminum', 'EV', 'ADAS', 'calibration', 'certification'],
    content: `TESLA COLLISION REPAIR — OEM REQUIREMENTS & POSITION STATEMENT

Source: Tesla Collision Repair Program (tesla.com/collision-repair)

1. TESLA-APPROVED BODY SHOP NETWORK:
   - Tesla maintains a network of Tesla-Approved Body Shops that meet specific training, tooling, and facility requirements.
   - Approval requires: factory training for technicians, Tesla-specific welding equipment, aluminum repair capability, and Tesla diagnostic tools (Toolbox).
   - ACG should pursue Tesla approval for locations near EV-heavy markets (Los Angeles, Santa Ana, Gardena).

2. STRUCTURAL REPAIR:
   - Tesla vehicles use a combination of aluminum, high-strength steel, and ultra-high-strength steel (martensitic).
   - No heat may be applied to ultra-high-strength steel components — cold repair methods only.
   - Sectioning of structural components is generally PROHIBITED for Tesla vehicles. Full panel replacement is required.
   - Aluminum structural components must be replaced, not repaired, when damaged beyond cosmetic.
   - Self-piercing rivets (SPR) and structural adhesives are the primary joining methods.
   - MIG brazing is NOT permitted on Tesla vehicles.

3. WELDING REQUIREMENTS:
   - Resistance spot welding (RSW) with Tesla-approved equipment.
   - Squeeze-type resistance spot welding (STRSW) for certain joints.
   - GMA (MIG) welding only where specified — with exact wire specifications.
   - All welding must follow Tesla's WDS (Weld Distribution Specification) documents.

4. ADAS & CALIBRATION:
   - ALL Tesla vehicles require post-repair calibration of forward-facing cameras, ultrasonics, and radar (if equipped).
   - Calibration must be performed using Tesla Toolbox software.
   - Static calibration requires specific targets and a level floor area (minimum 25' x 12').
   - Autopilot camera calibration is MANDATORY after:
     * Windshield replacement
     * Front bumper removal
     * Any structural repair forward of the B-pillar
     * Steering or suspension work
   - Failure to calibrate = Autopilot/FSD malfunction + massive liability exposure.

5. PARTS POLICY:
   - Tesla sells collision parts ONLY to Tesla-Approved Body Shops.
   - Parts are categorized: Structural, Exterior, Mechanical, Electrical.
   - Structural parts (rails, pillars, rockers) have STRICT replacement criteria — repair is rarely permitted.
   - Over-the-counter (OTC) parts restrictions apply: certain structural components require Tesla engineering approval before ordering.

6. HIGH-VOLTAGE SAFETY:
   - All Tesla repairs require high-voltage (HV) system awareness.
   - HV battery must be disconnected before any structural repair.
   - Only Tesla-certified HV technicians may work on HV components.
   - Post-repair HV system diagnostic scan is MANDATORY.

7. PAINT & REFINISHING:
   - Tesla uses water-based low-VOC paints with specific application procedures.
   - Color matching for Tesla's multi-coat paints (e.g., Pearl White, Red Multi-Coat) requires specific toners and techniques.
   - Blend panels must follow Tesla's refinish specifications to maintain corrosion warranty.

8. WARRANTY PRESERVATION:
   - Repairs not following Tesla procedures VOID the factory corrosion warranty.
   - Repairs using non-OEM parts VOID the Tesla parts warranty.
   - ACG must document all Tesla-specific procedures, tools, and materials used in every repair file.

LIABILITY NOTE:
Tesla vehicles record all diagnostic events. Any repair that triggers a diagnostic trouble code (DTC) without proper resolution, or any skipped calibration, creates a permanent electronic record that can be discovered in post-accident litigation.`,
  },

  // ── Ford Position Statement ─────────────────────────────────────
  {
    categoryId: 'oem_procedures',
    title: 'Ford Motor Company — Collision Repair Position Statement',
    sourceName: 'Ford Motor Company',
    sourceSection: 'Ford Crash Parts Policy / FordServiceInfo.com',
    contentType: 'oem',
    tags: ['Ford', 'OEM', 'aluminum', 'F-150', 'high-strength steel', 'ADAS'],
    content: `FORD MOTOR COMPANY — COLLISION REPAIR POSITION STATEMENT

Source: Ford Motor Company Collision Repair Network (fordserviceinfo.com)

1. REPAIR PROCEDURE REQUIREMENTS:
   - Ford requires that ALL collision repairs follow the procedures published in the Ford Workshop Manual and Body Repair Manual.
   - Repairs performed without following these procedures may compromise vehicle safety systems and void warranties.
   - Ford Body Repair manuals are available at: www.motorcraftservice.com

2. FORD F-150 ALUMINUM BODY:
   - The Ford F-150 (2015+) features an aluminum-intensive body structure.
   - Aluminum repair requires SEPARATE dedicated tools, workspace, and fasteners from steel repair.
   - Cross-contamination between steel and aluminum particles causes galvanic corrosion — separate work areas are MANDATORY.
   - Ford specifies self-piercing rivets (SPR), blind rivets, and structural adhesives for aluminum joining.
   - Heat straightening of aluminum structural components is PROHIBITED.

3. HIGH-STRENGTH STEEL:
   - Boron steel and other ultra-high-strength steels (UHSS) used in Ford body structures CANNOT be heated.
   - Heat to UHSS permanently alters its metallurgical properties, destroying crash energy management capability.
   - Cold repairs only — replacement is required for damaged UHSS components.
   - Sectioning is permitted ONLY where specified in Ford repair procedures.

4. FORD POSITION ON AFTERMARKET PARTS:
   - Ford does NOT approve the use of aftermarket (non-OEM) crash parts.
   - Aftermarket structural components have NOT been crash-tested by Ford.
   - Use of aftermarket parts may affect vehicle crash performance and safety system calibration.
   - Ford's warranty does NOT cover failures caused by aftermarket parts.
   - "Ford strongly recommends the use of Genuine Ford Parts for all collision repairs."

5. ADAS CALIBRATIONS:
   - Ford vehicles with Ford Co-Pilot360 require post-repair calibration of:
     * Forward-looking camera (IPMA)
     * Blind spot radar sensors (SODL/SODR)
     * 360-degree camera system
     * Adaptive cruise control radar
   - Calibration requires Ford IDS/FDRS diagnostic software.
   - Dynamic calibration (road test) is required for some radar systems.

6. FORD CERTIFIED COLLISION NETWORK:
   - Ford maintains a Certified Collision Network (FCCN) requiring:
     * I-CAR Gold Class designation
     * Ford-specific training (online + hands-on)
     * Required tooling: aluminum welding equipment, Ford diagnostic tools, frame rack
     * Annual renewal and audits
   - FCCN shops get priority parts access and Ford technical support.

7. PRE- AND POST-REPAIR SCANNING:
   - Ford REQUIRES pre-repair diagnostic scanning on all vehicles.
   - Post-repair diagnostic scanning is REQUIRED on all vehicles.
   - DTCs must be documented and resolved before delivery.
   - A copy of the pre- and post-scan reports should be included in the repair file.`,
  },

  // ── General Motors Position Statement ────────────────────────────
  {
    categoryId: 'oem_procedures',
    title: 'General Motors — Collision Repair Standards & Position Statement',
    sourceName: 'General Motors',
    sourceSection: 'GM Genuine Parts / acdelcotechconnect.com',
    contentType: 'oem',
    tags: ['GM', 'Chevrolet', 'Cadillac', 'GMC', 'OEM', 'steel', 'ADAS', 'certification'],
    content: `GENERAL MOTORS — COLLISION REPAIR STANDARDS & POSITION STATEMENT

Source: GM Service Technical College / ACDelco TechConnect (acdelcotechconnect.com)

1. GM REPAIR PROCEDURES — USE IS MANDATORY:
   - GM requires strict adherence to published GM repair procedures for all collision repairs.
   - Procedures are published at: www.acdelcotechconnect.com (subscription required).
   - Repair procedures are VIN-specific — technicians must look up procedures by the specific VIN being repaired.
   - "Repair procedures are engineered to restore the vehicle to pre-accident condition in terms of safety, durability, and crash performance."

2. BODY CONSTRUCTION & MATERIALS:
   - GM vehicles use a mix of materials:
     * Mild steel (repairable with conventional methods)
     * High-strength low-alloy (HSLA) steel
     * Dual-phase (DP) steel — limited heat application allowed
     * Martensitic steel (MS) — NO HEAT PERMITTED, replacement only
     * Press-hardened steel (PHS) — NO REPAIR, full replacement required
     * Aluminum (select models: Corvette, CT6, Silverado tailgates, etc.)
   - GM specifies EXACT replacement section locations for each vehicle. Sections may not be improvised.

3. WELDING SPECIFICATIONS:
   - GM vehicles use a combination of welding methods:
     * Gas Metal Arc Welding (GMAW/MIG) — standard specification
     * Squeeze-Type Resistance Spot Welding (STRSW) — specific locations
     * Laser welding — shop environment only where specified
   - Weld bonding (adhesive + welding) is required in specific locations — NOT optional.
   - Weld-through primer must be GM-approved or equivalent.
   - All welds must replicate the number, location, and type of factory welds.

4. SECTIONING POLICY:
   - GM permits sectioning ONLY where specified in the GM Body Repair Manual.
   - Sectioning at unspecified locations VOIDS the GM corrosion warranty and may compromise crash safety.
   - When sectioning is permitted, GM specifies EXACT cut lines, joining methods, and reinforcement requirements.

5. GM POSITION ON AFTERMARKET PARTS:
   - "GM Genuine Parts and ACDelco Original Equipment parts are designed, engineered, tested, and backed by GM."
   - Aftermarket structural parts have NOT been validated by GM for crash performance.
   - GM has issued MULTIPLE Dealer Service Bulletins warning that aftermarket structural components may not perform equivalently in subsequent collisions.
   - "GM recommends using only GM Genuine Parts for collision repair" — official statement.

6. ADAS & ELECTRONICS:
   - GM vehicles with Driver Assist Systems require post-repair calibration of:
     * Forward Collision Alert camera
     * Lane Departure Warning camera
     * Surround Vision cameras
     * Front/Rear park assist sensors
     * Blind Zone Alert radar
     * Adaptive Cruise Control radar
   - Calibration requires GM MDI2 diagnostic interface + GDS2 software.
   - Some ADAS systems require static calibration (target board), others require dynamic (road test).
   - Pre-repair scan is MANDATORY. Post-repair scan is MANDATORY.

7. CORROSION PROTECTION:
   - All repair areas must receive GM-specified corrosion protection.
   - Cavity wax must be applied to internal box sections after welding.
   - All bare metal must be primed with GM-approved primer before topcoat.
   - Seam sealer must be applied to all factory seam sealer locations.

8. GM COLLISION REPAIR NETWORK:
   - GM operates a Collision Repair Network for certified shops:
     * I-CAR Gold Class required
     * GM-specific training required (online modules + in-person)
     * Required equipment: GM diagnostic tools, specific welding equipment, three-dimensional measuring system
     * Annual equipment verification and training renewal
     * Competitive differentiator: access to GM technical support hotline`,
  },

  // ── Toyota Position Statement ────────────────────────────────────
  {
    categoryId: 'oem_procedures',
    title: 'Toyota Motor Corporation — Collision Repair Position Statement',
    sourceName: 'Toyota Motor North America',
    sourceSection: 'Toyota Certified Collision Center Program / techinfo.toyota.com',
    contentType: 'oem',
    tags: ['Toyota', 'Lexus', 'OEM', 'certification', 'parts', 'ADAS', 'repair_procedures'],
    content: `TOYOTA / LEXUS — COLLISION REPAIR POSITION STATEMENT

Source: Toyota Motor North America (techinfo.toyota.com) / Toyota Certified Collision Center Program

1. TOYOTA REPAIR PROCEDURES:
   - All collision repairs MUST follow Toyota/Lexus published repair procedures.
   - Procedures are vehicle-specific and are available at techinfo.toyota.com (TIS — Toyota Information System).
   - TIS subscription provides access to: Repair Manual, Body Repair Manual, Electrical Wiring Diagrams, Technical Service Bulletins.
   - "Toyota recommends that all repairs be performed by a Toyota Certified Collision Center."

2. VEHICLE CONSTRUCTION:
   - Toyota uses a Toyota Body (TB) architecture with strategic use of:
     * High-tensile strength steel (590 MPa, 780 MPa, 980 MPa, 1180 MPa, 1500 MPa grades)
     * Ultra-high-tensile steel in critical safety cage areas
     * Aluminum in select models and components (hybrid hoods, closures)
     * Carbon fiber reinforced plastic (CFRP) in select Lexus models
   - Each steel grade has specific repair or replacement requirements.
   - Materials above 980 MPa generally require replacement, not repair.

3. WELDING & JOINING:
   - Toyota specifies the EXACT welding method for each joint:
     * Spot welding (conventional and squeeze-type)
     * MIG welding (GMAW) — with specified wire, gas, and settings
     * MIG brazing (CuSi) — Toyota-specific applications
     * Laser welding — factory process requiring specialized shop equipment
   - Weld count and pitch (spacing) must be replicated as factory.
   - Adhesives must be Toyota-specified or equivalent.

4. SECTIONING GUIDELINES:
   - Toyota provides specific sectioning procedures for major structural components.
   - Sectioning dimensions are EXACT — within millimeter tolerances.
   - Sections MUST include specified inner and outer reinforcement sleeves.
   - Improper sectioning: safety cage compromised, warranty voided.

5. TOYOTA POSITION ON NON-OEM PARTS:
   - "Toyota Genuine Parts are engineered to exact specifications for fit, finish, and safety."
   - "Use of non-OEM structural parts could compromise vehicle integrity in a subsequent collision."
   - Toyota has not tested aftermarket structural components.
   - Toyota warranty does not cover failures caused by non-OEM parts.
   - Toyota recommends "Toyota Genuine Parts" exclusively.

6. TOYOTA SAFETY SENSE (TSS) CALIBRATION:
   - All Toyota vehicles with Toyota Safety Sense require post-repair calibration:
     * Front camera (millimeter-wave radar + monocular camera)
     * Rear camera (if equipped)
     * Blind Spot Monitor (BSM) sensors
     * Parking Support Alert sensors
     * Panoramic View Monitor cameras
   - Calibration requires Toyota Techstream diagnostic software.
   - Some systems require static calibration with Toyota-specified targets.
   - Other systems require dynamic calibration through road testing.
   - Airbag system must be scanned pre- and post-repair.

7. HYBRID / ELECTRIC VEHICLE CONSIDERATIONS:
   - Toyota Hybrid System (THS) repairs require HV safety certification.
   - HV battery disconnect is required before any structural welding.
   - Post-repair HV system diagnostic scan is REQUIRED.
   - HV battery cooling system must be verified after front-end repairs.

8. TOYOTA CERTIFIED COLLISION CENTER (TCCC):
   - Certification requirements:
     * I-CAR Gold Class
     * Toyota/Lexus specific training
     * Required diagnostic equipment (Techstream)
     * Required welding and measuring equipment
     * Facility standards compliance
     * Annual renewal with audits
   - Benefits: priority parts availability, Toyota technical support hotline, TCCC listing for consumers.`,
  },

  // ── Honda / Acura Position Statement ─────────────────────────────
  {
    categoryId: 'oem_procedures',
    title: 'Honda / Acura — Collision Repair Position Statement & Requirements',
    sourceName: 'American Honda Motor Co.',
    sourceSection: 'Honda Certified Collision Repair Program / techinfo.honda.com',
    contentType: 'oem',
    tags: ['Honda', 'Acura', 'OEM', 'certification', 'parts', 'high-strength steel', 'ADAS'],
    content: `HONDA / ACURA — COLLISION REPAIR POSITION STATEMENT

Source: American Honda Motor Co., Inc. (techinfo.honda.com)

1. POSITION ON REPAIR PROCEDURES:
   - Honda/Acura requires that ALL collision repairs follow the official Honda/Acura Body Repair Manual procedures.
   - "Proper repair procedures are critical to ensure the vehicle continues to meet Honda's high standards for safety, reliability, and performance."
   - Service Express website (techinfo.honda.com) provides all repair information.
   - All repairs must restore the vehicle to pre-accident condition and meet Honda safety standards.

2. ADVANCED COMPATIBILITY ENGINEERING (ACE) BODY STRUCTURE:
   - Honda's ACE body structure is specifically engineered for crash energy management.
   - The ACE structure uses a network of interconnected structural elements to distribute crash forces.
   - MODIFYING ANY PART OF THE ACE STRUCTURE WITHOUT FOLLOWING HONDA PROCEDURES CAN ALTER CRASH PERFORMANCE.
   - High-strength steel grades used: 590, 780, 980, 1180, and 1500 MPa.
   - 1500 MPa steel (used in critical safety areas): NO HEAT, NO REPAIR — REPLACEMENT ONLY.
   - Heat application to 980+ MPa steel permanently alters the crystalline structure, destroying its designed energy absorption properties.

3. REPAIR VS. REPLACE DECISIONS:
   - Honda provides specific criteria for repair vs. replace:
     * 590 MPa and below: repairable within specified limits
     * 780 MPa: limited cold repair, no heat
     * 980 MPa: generally replacement only
     * 1180 MPa+: replacement only — no exceptions
   - If the Honda Body Repair Manual says "REPLACE," it means REPLACE — not "repair if possible."

4. WELDING SPECIFICATIONS:
   - Honda specifies welding methods precisely:
     * MIG (GMAW) with ER70S-6 wire, 75% Argon / 25% CO2 shielding gas
     * Honda-specific plug welding dimensions
     * Stitch welding where specified for panel replacement
   - Weld bonding (structural adhesive + welding) in Honda-specified locations.
   - Zinc-coated steel requires specific weld-through primer.

5. HONDA POSITION ON NON-GENUINE PARTS:
   - "Honda Genuine Parts are manufactured to Honda's exact specifications."
   - "The use of non-genuine parts may affect the operation of safety systems."
   - Honda warranties do NOT cover damage or failure caused by non-genuine parts.
   - Honda does NOT test or validate aftermarket collision parts.
   - For structural components, Honda Genuine Parts are STRONGLY REQUIRED.

6. HONDA SENSING / ACURAWATCH CALIBRATION:
   - All vehicles with Honda Sensing / AcuraWatch require:
     * Pre-repair diagnostic scan
     * Post-repair diagnostic scan
     * Calibration of affected ADAS components
   - Calibration-required scenarios:
     * Windshield replacement → multipurpose camera camera (MPC) calibration
     * Front bumper/grille removal → millimeter wave radar calibration
     * Any structural repair forward of B-pillar → full system calibration
     * Steering/suspension work → steering angle sensor calibration
     * Rear bumper repair → blind spot information (BSI) sensor calibration
   - Calibration requires Honda Diagnostic System (HDS) / i-HDS software.
   - Static calibration: requires Honda-specified targets, level floor, specific lighting conditions.
   - Dynamic calibration: requires road test at specified speed on clearly marked roads.

7. PRE- AND POST-REPAIR SCANNING:
   - Honda REQUIRES pre-repair scanning.
   - Honda REQUIRES post-repair scanning.
   - All DTCs must be documented, addressed, and cleared.
   - Scan reports should be saved in the repair file.
   - Scanning must be performed with Honda HDS/i-HDS — generic OBD-II scanners are INSUFFICIENT for comprehensive system coverage.

8. HONDA CERTIFIED COLLISION REPAIR PROGRAM:
   - Requirements:
     * I-CAR Gold Class designation
     * Honda-specific classroom and hands-on training
     * Honda diagnostic equipment (HDS)
     * Three-dimensional measuring system
     * Dedicated aluminum repair area (for models with aluminum components)
     * Specific welding and squeeze-type resistance spot welding equipment
   - Certified shops are listed on Honda's consumer-facing locator tool.
   - Certification is a competitive advantage in markets with high Honda/Acura concentration.

9. AIRBAG & SRS SYSTEMS:
   - All SRS components must be inspected after ANY collision (even if airbags did not deploy).
   - Airbag modules, sensors, clockspring, and wiring must be replaced per Honda's published criteria.
   - SRS diagnostic trouble codes require specific troubleshooting procedures — parts cannon approach is PROHIBITED.
   - Post-repair SRS functional test is REQUIRED.`,
  },
];

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  ACG Legal AI — OEM Procedures Ingestion ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let loaded = 0;
  let skipped = 0;

  for (const doc of OEM_DOCUMENTS) {
    // Check if already loaded
    const existing = db.prepare(
      'SELECT id FROM legal_documents WHERE title = ? AND source_name = ?'
    ).get(doc.title, doc.sourceName) as any;

    if (existing) {
      console.log(`  ⏭️  SKIP (already loaded): ${doc.title}`);
      skipped++;
      continue;
    }

    const docId = randomUUID();
    const now = new Date().toISOString();

    // Insert document
    db.prepare(`
      INSERT INTO legal_documents (id, category_id, title, source_name, source_section, content_type, status, last_updated, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(docId, doc.categoryId, doc.title, doc.sourceName, doc.sourceSection || null, doc.contentType, now, JSON.stringify({ tags: doc.tags, ingested_via: 'oem-procedures-script' }));

    // Chunk it
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

// ── Chunking ─────────────────────────────────────────────────────────

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
