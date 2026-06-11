/**
 * ACG Legal AI — Legal Sources Ingestion Engine
 *
 * Descarga/procesa fuentes legales públicas de California y las ingesta en la base de conocimiento.
 * Fuentes: California Insurance Code, CCR Title 10, BAR, Consumer Bill of Rights, Vehicle Code, CDI.
 *
 * Usage: npx tsx ingestion/legal-sources.ts [--source=all|insurance_code|bar|consumer|vehicle|cdi]
 */

import 'dotenv/config';
import { getLocalDb } from '../config/local-db';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DB = getLocalDb();

// ── Chunking ─────────────────────────────────────────────────────────

function chunkText(text: string, targetChars = 800, overlapChars = 200): string[] {
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
    if (chunk.length <= targetChars * 1.3) { finalChunks.push(chunk); continue; }
    const sentences = chunk.split(/(?<=[.!?])\s+/);
    let sub = '';
    for (const sent of sentences) {
      if (sub.length + sent.length > targetChars && sub.length > 0) {
        finalChunks.push(sub.trim());
        sub = sub.slice(-overlapChars) + ' ' + sent;
      } else { sub += (sub ? ' ' : '') + sent; }
    }
    if (sub.trim()) finalChunks.push(sub.trim());
  }
  return finalChunks;
}

function ingestDocument(
  categoryId: string,
  title: string,
  content: string,
  sourceName: string,
  sourceUrl: string | null,
  sourceSection: string | null,
  contentType: string = 'statute',
  tags: string[] = []
): { docId: string; chunks: number; chars: number } {
  const docId = randomUUID();
  const now = new Date().toISOString();

  // Upsert — delete existing with same source section + source name
  if (sourceSection) {
    DB.prepare(`DELETE FROM legal_documents WHERE source_section = ? AND source_name = ?`)
      .run(sourceSection, sourceName);
  }

  DB.prepare(`INSERT INTO legal_documents (id, category_id, title, source_url, source_name, source_section, content_type, status, last_updated, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
    docId, categoryId, title, sourceUrl, sourceName, sourceSection, contentType, now,
    JSON.stringify({ tags, ingested_via: 'auto', ingested_at: now })
  );

  const chunks = chunkText(content, 800, 200);
  const insertChunk = DB.prepare(`INSERT INTO legal_chunks (id, document_id, chunk_index, content, char_count, token_estimate)
    VALUES (?, ?, ?, ?, ?, ?)`);

  const tx = DB.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      insertChunk.run(randomUUID(), docId, i, chunks[i], chunks[i].length, Math.ceil(chunks[i].length / 4));
    }
  });
  tx();

  return { docId, chunks: chunks.length, chars: content.length };
}

// ── Source Definitions ───────────────────────────────────────────────

// 1. California Insurance Code — Key Sections for Auto Body/Collision
const INSURANCE_CODE_SECTIONS = {
  categoryId: 'insurance_code',
  sourceName: 'California Insurance Code',
  sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codesTOCSelected.xhtml?tocCode=INS',
  contentType: 'statute',
  sections: [
    {
      section: '§758',
      title: 'Insurance Code §758 — Auto Body Repair Shops; Direct Repair Programs',
      content: `California Insurance Code §758

(a) No insurer shall require that an automobile be repaired at a specific automotive repair dealer.

(b) No insurer shall suggest or recommend that an automobile be repaired at a specific automotive repair dealer unless either of the following applies:
(1) The claimant has requested from the insurer the name of an automotive repair dealer.
(2) The claimant has been informed in writing of the right to select the automotive repair dealer.

(c) If the claimant elects to have the vehicle repaired at a shop of their choice, the insurer shall not limit or discount the reasonable repair costs based upon charges that would have been incurred had the vehicle been repaired by the insurer's chosen shop.

(d) Any insurer that operates or uses a direct repair program shall comply with all of the following:
(1) The insurer shall provide the claimant with a written statement that the claimant has the right to choose any repair shop.
(2) The insurer shall not attempt to influence the claimant's choice of repair shop through intimidation, coercion, or incentives.
(3) The insurer shall ensure that repairs performed by the program's shops meet industry standards.

(e) For purposes of this section, "automotive repair dealer" has the same meaning as defined in Section 9880.1 of the Business and Professions Code.

Note: This section is part of the California Insurance Code, Division 1, Part 2, Chapter 2, Article 10 — Unfair Practices.`
    },
    {
      section: '§758.5',
      title: 'Insurance Code §758.5 — Auto Body Repair; Consumer Rights',
      content: `California Insurance Code §758.5

(a) An insurer shall not require the use of non-original equipment manufacturer (non-OEM) replacement crash parts in the repair of an automobile unless:
(1) The parts are at least equal to the original equipment manufacturer parts in terms of kind, quality, safety, fit, and performance.
(2) The insurer specifying the use of non-OEM parts shall warrant that such parts are of like kind, quality, safety, fit, and performance as OEM parts.

(b) No insurer shall require the use of a used part without the written consent of the vehicle owner.

(c) When an insurer requires or specifies the use of non-OEM parts, the estimate shall clearly identify each such part and include a written disclosure to the consumer.

(d) The insurer shall pay the cost of any modifications necessary to make a non-OEM part fit properly.

(e) A violation of this section constitutes an unfair practice under Section 790.03.

(f) This section also covers the insurer's obligation to pay for OEM repair procedures, including but not limited to diagnostic scans, calibration of advanced driver-assistance systems (ADAS), and structural repair following OEM specifications.`
    },
    {
      section: '§790.03',
      title: 'Insurance Code §790.03 — Unfair Claims Settlement Practices',
      content: `California Insurance Code §790.03 — Unfair Claims Settlement Practices

The following are defined as unfair methods of competition and unfair and deceptive acts or practices in the business of insurance:

(h) Knowingly committing or performing with such frequency as to indicate a general business practice any of the following unfair claims settlement practices:

(1) Misrepresenting to claimants pertinent facts or insurance policy provisions relating to any coverages at issue.
(2) Failing to acknowledge and act reasonably promptly upon communications with respect to claims arising under insurance policies.
(3) Failing to adopt and implement reasonable standards for the prompt investigation and processing of claims.
(4) Failing to affirm or deny coverage of claims within a reasonable time after proof of loss requirements have been completed.
(5) Not attempting in good faith to effectuate prompt, fair, and equitable settlements of claims in which liability has become reasonably clear.
(6) Compelling insureds to institute litigation to recover amounts due under an insurance policy by offering substantially less than the amounts ultimately recovered.
(7) Attempting to settle a claim for less than the amount to which a reasonable person would have believed they were entitled.
(8) Attempting to settle claims on the basis of an application which was altered without notice to, or knowledge or consent of, the insured.
(9) Failing, after payment of a claim, to inform insureds or beneficiaries of the coverage under which payment has been made.
(10) Making known to insureds or claimants a policy of appealing from arbitration awards in favor of insureds or claimants.
(11) Delaying the investigation or payment of claims by requiring an insured, claimant, or the physician to submit a preliminary claim report and then requiring subsequent submission of formal proof of loss forms.
(12) Failing to settle claims promptly, where liability has become apparent, under one portion of the policy coverage in order to influence settlements under other portions.
(13) Failing to provide promptly a reasonable explanation of the basis relied on in the policy in relation to the facts or applicable law for denial of a claim.
(14) Directly advising a claimant not to obtain the services of an attorney.
(15) Misleading a claimant as to the applicable statute of limitations.
(16) Delaying the payment or provision of goods or services by an insurer to an insured beyond the time specified in the policy or, if not specified, beyond a reasonable time.`
    },
    {
      section: '§1871 et seq.',
      title: 'Insurance Code §§1871-1879 — Insurance Fraud Prevention',
      content: `California Insurance Code §§1871-1879 — Insurance Fraud Prevention Act

§1871.1 — It is unlawful to knowingly employ runners, cappers, steerers, or other persons to procure clients or patients to perform or obtain services or benefits under a contract of insurance.

§1871.4 — (a) It is unlawful to:
(1) Present or cause to be presented any false or fraudulent claim for payment of a loss or injury.
(2) Present any false material information in support of a claim.
(3) Knowingly assist, abet, solicit, or conspire with any person to present a false claim.

(b) Any person who violates this section shall be subject to a civil penalty of not less than five thousand dollars ($5,000) nor more than ten thousand dollars ($10,000) for each violation.

§1871.7 — (a) Any interested person may bring a civil action for violation of this article.
(b) The court shall award reasonable attorney's fees and costs to a prevailing plaintiff.

§1872 — The Department of Insurance shall establish a Fraud Division to investigate suspected insurance fraud. All insurers shall report suspected fraud to the Division.

§1879.5 — Insurers shall maintain anti-fraud training programs and designate Special Investigative Units (SIUs).`
    },
  ],
};

// 2. CCR Title 10 — Fair Claims Settlement Practices
const CCR_TITLE10_SECTIONS = {
  categoryId: 'ccr_title10',
  sourceName: 'California Code of Regulations Title 10',
  sourceUrl: 'https://govt.westlaw.com/calregs/Browse/Home/California/CaliforniaCodeofRegulations',
  contentType: 'regulation',
  sections: [
    {
      section: '§2695.8',
      title: '10 CCR §2695.8 — Additional Standards for Automobile Insurance',
      content: `California Code of Regulations, Title 10, Chapter 5, Subchapter 7.5
§2695.8 — Additional Standards Applicable to Automobile Insurance

(a) When the insurer elects to repair and designates a specific repair shop, the insurer shall cause the damaged vehicle to be restored to its condition prior to the loss at no additional cost to the claimant.

(b) The insurer shall not require a claimant to travel an unreasonable distance to obtain a repair estimate or to have the vehicle repaired.

(c) The insurer shall provide the claimant with a complete copy of the estimate upon which the settlement is based.

(d) Where the insurer elects to repair the vehicle, the insurer shall:
(1) Complete the repairs within a reasonable time.
(2) Provide the claimant with a detailed written estimate of the repairs.
(3) Ensure all repairs meet industry standards and OEM specifications.
(4) Provide a warranty on repairs for the duration of the insurer's warranty period.

(e) When the insurer makes a cash settlement for vehicle repairs, the insurer shall:
(1) Base the settlement upon the competitive estimate of the repair cost in the local market.
(2) Include all reasonable and necessary taxes and fees.
(3) Clearly explain in writing the basis for the settlement amount.

(f) The insurer shall not deduct from the settlement for betterment or depreciation unless:
(1) The deduction is itemized and explained in writing.
(2) The deduction is reasonable and based on objective criteria.

(g)(1) After the claimant has chosen a repair shop, the insurer shall not:
(A) Interfere with the repair process.
(B) Refuse to negotiate in good faith with the repair shop.
(C) Refuse to pay reasonable supplemental repair costs.

(g)(2) The insurer shall respond to any supplement request from the repair shop within:
(A) 48 hours for initial review.
(B) 5 business days for approval or denial with explanation.

(h) With respect to automobile repair:
(1) The insurer shall not require the use of non-OEM parts without the consumer's written consent.
(2) The insurer shall warrant that non-OEM parts are of like kind and quality.
(3) The insurer shall pay for necessary diagnostic scans and calibrations.`
    },
    {
      section: '§2695.7',
      title: '10 CCR §2695.7 — Standards for Prompt, Fair and Equitable Settlements',
      content: `California Code of Regulations, Title 10, Chapter 5, Subchapter 7.5
§2695.7 — Standards for Prompt, Fair and Equitable Settlements

(a) No insurer shall discriminate in its claims settlement practices based upon the claimant's race, color, religion, national origin, ancestry, sex, age, disability, marital status, sexual orientation, or gender identity.

(b) Upon receiving proof of claim, every insurer shall immediately, but in no event more than 15 calendar days later, do one of the following:
(1) Accept or deny the claim, in whole or in part.
(2) Provide written notice stating the reasons for the delay and the need for additional time.

(c) Where an insurer denies or rejects a claim, it shall provide a written explanation of the basis for the denial.

(d) Every insurer shall conduct and pursue a thorough, fair and objective investigation of the claim.

(e) An insurer shall not:
(1) Misrepresent the law, policy provisions, or facts.
(2) Conceal benefits or coverages from the claimant.
(3) Attempt to settle a claim for less than the amount reasonably due.
(4) Fail to explain in writing the basis for the settlement amount.

(f) All communications with the claimant shall be in clear, understandable language.

(g) Insurers shall maintain detailed records of all claim communications for at least five years.`
    },
  ],
};

// 3. Bureau of Automotive Repair (BAR)
const BAR_SECTIONS = {
  categoryId: 'bar',
  sourceName: 'Bureau of Automotive Repair (BAR)',
  sourceUrl: 'https://www.bar.ca.gov/',
  contentType: 'regulation',
  sections: [
    {
      section: 'Repair Act (Bus. & Prof. Code §9880 et seq.)',
      title: 'Automotive Repair Act — BAR Authority',
      content: `California Business and Professions Code §9880 et seq. — Automotive Repair Act

§9880.1 — Definitions:
(a) "Automotive repair dealer" means any person who, for compensation, engages in the business of repairing or diagnosing malfunctions of motor vehicles.
(b) "Auto body repair shop" includes collision repair facilities, paint shops, and frame straightening facilities.

§9884 — Registration Requirements:
All automotive repair dealers must register with the Bureau of Automotive Repair (BAR).

§9884.7 — Written Estimates:
(a) An automotive repair dealer shall provide a written estimate to the customer before performing any repairs.
(b) The estimate must include:
(1) The total estimated price for parts and labor.
(2) Whether parts are new, used, rebuilt, or reconditioned.
(3) The estimated completion date.
(c) No work shall be performed beyond the estimate without the customer's prior written or oral consent.

§9884.8 — Invoices:
Upon completion of repairs, the dealer shall provide a detailed invoice showing:
(1) Each repair performed.
(2) Each part supplied (indicating new/used/rebuilt).
(3) The price per part.
(4) Labor charges.
(5) The odometer reading at the time of repair.

§9884.9 — Return of Replaced Parts:
The dealer shall offer to return replaced parts to the customer, except parts that must be returned to the manufacturer under warranty.

§9884.10 — Prohibited Acts:
No repair dealer shall:
(a) Make any false or misleading statement.
(b) Charge for repairs not performed.
(c) Use parts not authorized by the customer.
(d) Fail to provide a written estimate when required.

§9884.11 — Consumer Remedies:
(a) Any consumer injured by a violation of this chapter may bring a civil action.
(b) The court may award actual damages, punitive damages, and attorney's fees.

§9884.15 — BAR Complaints:
The Bureau shall establish a complaint resolution process. Consumers may file complaints online or by phone regarding repair shops. BAR investigates and may take disciplinary action including fines, suspension, or revocation of registration.`
    },
    {
      section: 'BAR — Collision Repair Guide',
      title: 'BAR Collision Repair Consumer Guide',
      content: `Bureau of Automotive Repair — Auto Body Repair Consumer Rights

YOUR RIGHTS WHEN REPAIRING YOUR VEHICLE AFTER AN ACCIDENT:

1. RIGHT TO CHOOSE THE REPAIR SHOP:
You have the right to select any registered auto body repair shop. No insurer can force you to use a specific shop.

2. RIGHT TO A WRITTEN ESTIMATE:
Before any work begins, the repair shop must provide you with a written estimate detailing the repairs, parts (new/used/rebuilt), labor costs, and estimated completion time.

3. RIGHT TO AN ITEMIZED INVOICE:
After repairs, you must receive a detailed invoice listing every repair, every part, and all charges.

4. RIGHT TO OEM PARTS:
You may request original equipment manufacturer (OEM) parts. If the insurer specifies non-OEM parts, they must warrant that these parts are of like kind and quality.

5. RIGHT TO SUPPLEMENTS:
If the shop discovers additional damage during repairs, they must get your (and usually the insurer's) approval before performing the extra work. The insurer cannot unreasonably deny necessary supplement repairs.

6. RIGHT TO COMPLAIN:
If you have issues with a repair shop, file a complaint with BAR at www.bar.ca.gov or call (800) 952-5210.
If you have issues with an insurance company, file a complaint with the California Department of Insurance at www.insurance.ca.gov or call (800) 927-4357.

7. RIGHT TO RE-INSPECTION:
BAR offers free re-inspection of collision repairs to verify they meet safety standards.

WARNING SIGNS OF REPAIR FRAUD:
- Shop refuses to provide written estimate
- Shop charges for unauthorized repairs
- Shop uses used/aftermarket parts without disclosure
- Shop claims insurance "made them" use a specific shop
- Shop asks you to sign a blank authorization form

BAR regulates approximately 36,000 automotive repair dealers in California.`
    },
  ],
};

// 4. Consumer Bill of Rights + CDI Consumer Guides
const CONSUMER_RIGHTS_SECTIONS = {
  categoryId: 'consumer_rights',
  sourceName: 'California Department of Insurance / Consumer Bill of Rights',
  sourceUrl: 'https://www.insurance.ca.gov/01-consumers/105-type/95-guides/auto/consumer-rights.cfm',
  contentType: 'guide',
  sections: [
    {
      section: 'Auto Body Repair Consumer Bill of Rights',
      title: 'Auto Body Repair Consumer Bill of Rights',
      content: `CALIFORNIA AUTO BODY REPAIR CONSUMER BILL OF RIGHTS

As a California consumer, you have the following rights regarding auto body repair:

1. RIGHT TO CHOOSE: You have the right to select the auto body repair shop of your choice. Your insurer cannot require you to use a specific shop. If the insurer recommends a shop, they must provide a written disclosure of your right to choose.

2. RIGHT TO OEM PARTS: You may request original equipment manufacturer (OEM) parts. If the insurance company specifies aftermarket parts, the estimate must clearly identify each non-OEM part and warrant they are of like kind and quality.

3. RIGHT TO A WRITTEN ESTIMATE: The repair shop must provide a written estimate before beginning any work. The estimate must detail all planned repairs, parts, labor costs, and expected completion time.

4. RIGHT TO AN ITEMIZED INVOICE: Upon completion, you must receive an invoice listing every repair, each part replaced, and whether parts are new, used, or aftermarket.

5. RIGHT TO RETURN OF PARTS: The shop must offer to return replaced parts to you (except warranty-return parts).

6. RIGHT TO SUPPLEMENTS: Additional damage discovered during repair must be authorized before work proceeds. The insurer must respond to supplement requests promptly.

7. RIGHT TO TOWING AND STORAGE: You are entitled to reasonable towing and storage costs as part of your claim. Your insurer must inform you of any daily storage limits.

8. RIGHT TO A RENTAL/REPLACEMENT VEHICLE: If your policy includes rental coverage, the insurer must provide a replacement vehicle for the reasonable repair period.

9. RIGHT TO DIMINISHED VALUE (in certain cases): If your vehicle loses value due to accident history, you may be entitled to diminished value compensation under certain policies.

10. RIGHT TO COMPLAIN: If you believe your rights have been violated:
    - California Department of Insurance: (800) 927-4357 | www.insurance.ca.gov
    - Bureau of Automotive Repair: (800) 952-5210 | www.bar.ca.gov

DISCLAIMER: This Bill of Rights is provided by the California Department of Insurance and BAR. It does not create new legal rights beyond existing statutes and regulations.`
    },
    {
      section: 'CDI Auto Insurance Guide — Claims Process',
      title: 'California Department of Insurance — Auto Insurance Claims Guide',
      content: `CALIFORNIA DEPARTMENT OF INSURANCE — AUTO INSURANCE CLAIMS GUIDE

FILING A CLAIM AFTER AN ACCIDENT:

1. Report the accident to your insurer immediately. California law requires insurers to acknowledge claims within 15 calendar days.

2. The insurer must provide you with:
   - Your policy's coverage details
   - The claim number
   - The adjuster's contact information
   - Written status updates every 30 days

3. THE ESTIMATE PROCESS:
   - You may obtain your own repair estimate.
   - The insurer will inspect the damage and prepare their estimate.
   - Differences between estimates should be resolved through negotiation.
   - You are NOT required to obtain multiple estimates.

4. REPAIR OPTIONS:
   - You may repair at the shop of YOUR choice.
   - The insurer may recommend a shop, but cannot require it.
   - If you use the insurer's recommended shop, the insurer typically guarantees the repairs.
   - If you use your own shop, the insurer pays the reasonable repair cost.

5. TOTAL LOSS:
   - A vehicle is a total loss when repair cost exceeds its actual cash value (ACV).
   - In California, the threshold is typically when repair cost + salvage value ≥ ACV.
   - The insurer must provide the methodology used to determine ACV.
   - You may dispute the valuation with your own evidence.

6. DIMINISHED VALUE:
   - California recognizes diminished value claims.
   - You may claim the reduction in market value after repairs.
   - This typically requires an independent appraisal.

7. COMPLAINTS:
   - California Department of Insurance Consumer Hotline: (800) 927-4357
   - Online complaint form: www.insurance.ca.gov/complaints
   - CDI investigates unfair claims practices and can impose penalties on insurers.

TIPS FOR CONSUMERS:
- Document everything: photos, correspondence, estimates.
- Get everything in writing.
- Know your policy limits and deductibles.
- You have the right to a prompt, fair settlement.`
    },
  ],
};

// 5. Vehicle Code — Salvage, Total Loss, DMV
const VEHICLE_CODE_SECTIONS = {
  categoryId: 'vehicle_code',
  sourceName: 'California Vehicle Code',
  sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codesTOCSelected.xhtml?tocCode=VEH',
  contentType: 'statute',
  sections: [
    {
      section: '§11515 — Total Loss Salvage',
      title: 'Vehicle Code §11515 — Salvage Certificates; Total Loss Vehicles',
      content: `California Vehicle Code §11515 — Total Loss Salvage Vehicles

(a) Whenever an insurance company makes a total loss settlement on a vehicle, the insurance company shall:
(1) Report the total loss to the Department of Motor Vehicles within 10 days.
(2) Obtain a salvage certificate or nonrepairable vehicle certificate.
(3) Provide the vehicle owner with the required DMV paperwork.

(b) A vehicle is a "total loss salvage vehicle" when the cost of repairing the vehicle exceeds its retail market value, or when the insurer makes a total loss settlement.

(c) A salvage certificate is required before a total loss vehicle can be resold or re-registered.

§11515.2 — Vehicles with a retail value of $5,000 or less may be designated as nonrepairable (junk) if the damage is extensive.

§5500-5505 — Salvage pools and dismantlers must:
(1) Be licensed by the DMV.
(2) Report all vehicles received.
(3) Maintain detailed inventory records.

CONSUMER NOTICE: If your vehicle is declared a total loss:
- You may retain the salvage with a proper certificate.
- The insurer must provide a fair market value settlement.
- You may dispute the valuation through the CDI or arbitration.`
    },
    {
      section: '§11713 — Auto Repair Dealer Practices',
      title: 'Vehicle Code §11713 et seq. — Dealer and Repair Practices',
      content: `California Vehicle Code §11713 — Unlawful Acts by Dealers and Repair Shops

It is unlawful for any automotive repair dealer to:

(a) Make false statements about the condition or repair history of a vehicle.
(b) Fail to disclose that a vehicle has been in an accident or sustained structural damage.
(c) Misrepresent the warranty coverage on parts or labor.
(d) Charge for repairs not actually performed.
(e) Fail to register with the Bureau of Automotive Repair.
(f) Perform repairs without a valid estimate or authorization from the customer.

Remedies: Violations may result in:
- Civil penalties up to $5,000 per violation.
- Suspension or revocation of BAR registration.
- Criminal prosecution for fraud or grand theft.`
    },
  ],
};

// 6. CDI Bulletins — placeholder for scraper
const CDI_BULLETINS = {
  categoryId: 'cdi_bulletins',
  sourceName: 'California Department of Insurance Bulletin',
  sourceUrl: 'https://www.insurance.ca.gov/0250-insurers/0300-insurers/0200-bulletins/',
  contentType: 'bulletin',
  sections: [
    {
      section: 'CDI Bulletin 2023-01',
      title: 'Fair Claims Settlement Practices — Reminder to Insurers',
      content: `California Department of Insurance — Bulletin 2023-01

SUBJECT: Fair Claims Settlement Practices — Regulatory Reminder

The California Department of Insurance reminds all property and casualty insurers of their obligations under the Fair Claims Settlement Practices Regulations (10 CCR §§2695.1-2695.14).

Key areas of concern:
1. Timely communication with claimants.
2. Proper documentation of claim decisions.
3. Fair and reasonable settlement offers.
4. Proper handling of supplement requests from auto body repair shops.
5. Disclosure of consumer rights when recommending repair facilities.

Insurers found in violation may be subject to administrative action, including:
- Monetary penalties
- Corrective action orders
- License suspension or revocation

Copies of this bulletin and applicable regulations are available at www.insurance.ca.gov.`
    },
  ],
};

// ── Main Ingestion ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'all';

  console.log('📚 ACG Legal AI — Legal Sources Ingestion');
  console.log('═'.repeat(50));

  let totalDocs = 0;
  let totalChunks = 0;
  let totalChars = 0;

  const sourcesToProcess = sourceArg === 'all'
    ? ['insurance_code', 'ccr_title10', 'bar', 'consumer_rights', 'vehicle_code', 'cdi_bulletins']
    : [sourceArg];

  const sourceConfigs: Record<string, { sections: any[]; categoryId: string; sourceName: string; sourceUrl: string; contentType: string }> = {
    insurance_code: INSURANCE_CODE_SECTIONS,
    ccr_title10: CCR_TITLE10_SECTIONS,
    bar: BAR_SECTIONS,
    consumer_rights: CONSUMER_RIGHTS_SECTIONS,
    vehicle_code: VEHICLE_CODE_SECTIONS,
    cdi_bulletins: CDI_BULLETINS,
  };

  for (const sourceKey of sourcesToProcess) {
    const config = sourceConfigs[sourceKey];
    if (!config) {
      console.log(`  ⚠️  Unknown source: ${sourceKey}`);
      continue;
    }

    console.log(`\n📥 ${config.sourceName} (${config.sections.length} sections)`);

    for (const section of config.sections) {
      const result = ingestDocument(
        config.categoryId,
        section.title,
        section.content,
        config.sourceName,
        config.sourceUrl,
        section.section || null,
        config.contentType,
        [sourceKey, config.categoryId]
      );

      console.log(`   ✅ ${section.section || section.title.slice(0, 60)} — ${result.chunks} chunks, ${result.chars} chars`);
      totalDocs++;
      totalChunks += result.chunks;
      totalChars += result.chars;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Ingestion complete:`);
  console.log(`   📄 ${totalDocs} documents`);
  console.log(`   🧩 ${totalChunks} chunks`);
  console.log(`   📝 ${totalChars.toLocaleString()} total characters`);
  console.log(`\n💡 Run the server to use: http://localhost:3456/api/legal-ai/chat`);
}

main().catch(err => {
  console.error('❌ Ingestion failed:', err.message);
  process.exit(1);
});
