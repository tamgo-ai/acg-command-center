/**
 * ACG Claims Intelligence — Part 2: Additional Insurers + Master Strategy
 *
 * Uso: npx tsx ingestion/claims-intelligence-part2.ts
 */

import { getLocalDb } from '../config/local-db';
import { randomUUID } from 'crypto';

const db = getLocalDb();

const DOCUMENTS: any[] = [
  // ═══════════════════════════════════════════════════════════════════
  // ALLSTATE
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'Allstate — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — Allstate',
    contentType: 'guide',
    tags: ['Allstate', 'claims', 'DRP', 'labor_rate', 'aftermarket_parts', 'negotiation'],
    content: `ALLSTATE INSURANCE COMPANY
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

Allstate is a major auto insurer in California with significant market share. Allstate is known for aggressive claims handling, the "Good Hands" repair network (DRP), and systematic use of aftermarket parts.

═══ KNOWN PATTERNS & TACTICS ═══

1. AFTERMARKET PARTS AGGRESSION:
   - Allstate is ONE OF THE MOST AGGRESSIVE insurers on aftermarket parts.
   - They will specify aftermarket bumper covers, absorbers, reinforcements, headlamps, taillamps, fenders, hoods, radiators, condensers, wheels — virtually all cosmetic and many quasi-structural components.
   - For cosmetic parts: Allstate argues that fit, finish, and appearance are "substantially similar."
   - For structural components (bumper reinforcements, impact bars): Allstate may claim the aftermarket part "meets or exceeds OEM specifications" — a claim they cannot substantiate for most parts because no independent crash testing exists.

2. ESTIMATING SOFTWARE MANIPULATION:
   - Allstate uses CCC/Mitchell estimating systems.
   - Adjusters are trained to apply "judgment time" reductions to labor operations.
   - Example: OEM procedure calls for 4.5 hours on a quarter panel replacement. Allstate adjuster applies "judgment" and allows 3.8 hours.
   - This is systematic, not case-by-case — it's a training practice, not an individual adjuster decision.
   - The cumulative effect across all operations can reduce the estimate by 15-25%.

3. "GOOD HANDS" REPAIR NETWORK LEVERAGE:
   - Allstate's DRP shops have agreed to Allstate's parts policy, labor rates, and estimating guidelines.
   - Non-DRP shops are penalized: slower supplement processing, more documentation demands, lower labor rate offers.
   - Allstate may tell the insured: "Your repair will be handled more smoothly at a Good Hands shop." Textbooks STEERING.

4. TOTAL LOSS VALUATION:
   - Allstate uses CCC Valuescope for total loss valuations.
   - CCC systematically undervalues vehicles by 10-20% using "projected sold" comparables rather than actual transaction data.
   - Allstate adjusters have authority to make total loss determinations without supervisory review in many cases.

5. CLAIMS DELAY TACTICS:
   - Allstate is known for "slow-walking" claims where the insured is not at fault and is pursuing a third-party claim.
   - Tactic: "We need to complete our investigation" — can extend for weeks.
   - For first-party claims, delays are less common but supplements face scrutiny.

═══ COUNTER-STRATEGIES ═══

A. JUDGMENT TIME REDUCTIONS:
   - "Allstate, per [OEM] procedure [document page X], this operation requires [X.X] hours. ACG's technician has reviewed the procedure and confirms [X.X] hours is required. Please provide the specific engineering basis for the proposed time reduction."
   - California 10 CCR §2695.8(c): "Reasonable adjustment costs shall include ALL reasonable costs associated with returning the vehicle to its pre-loss condition."
   - Judgment time reductions that don't reference an OEM procedure or documented standard are arbitrary and may constitute unfair claims practice.
   - Maintain a log of judgment time reductions vs. actual required time. Pattern evidence of systematic underpayment is powerful in litigation.

B. AFTERMARKET STRUCTURAL PARTS:
   - "Allstate, this [part name] is a structural component per [OEM] repair procedures. [OEM] has not crash-tested aftermarket versions of this part. California Insurance Code §758.5 requires that non-OEM parts be 'at least equal to the original equipment manufacturer parts in terms of kind, quality, safety, fit, and performance.' Please provide Allstate's crash test data or engineering analysis demonstrating that this specific aftermarket part meets ALL five statutory criteria."
   - Allstate cannot produce this data for nearly any structural aftermarket part. The request itself often results in the part being converted to OEM.

C. THIRD-PARTY CLAIM DELAY:
   - When Allstate represents the at-fault party and ACG's customer is the claimant: Allstate has NO contractual relationship with the claimant. They owe a DUTY OF GOOD FAITH to their insured (the at-fault party), but to the claimant they owe fair handling under California regulations.
   - "Allstate, this third-party claim has been pending for [X] days without resolution. Under California 10 CCR §2695.7, insurers must respond to communications within 15 calendar days. Please provide a written status update within 5 business days or ACG will advise our customer to file a complaint with the California Department of Insurance."
   - Third-party claimants can also file small claims actions directly against the at-fault party, which forces Allstate to defend. This is a powerful leverage tool for smaller claims.

D. TOTAL LOSS VALUATION CHALLENGE:
   - Request the CCC Valuescope report in its entirety — not just the valuation number.
   - Review the comparable vehicles: are they the same year/make/model/trim? Same condition? Same geographic market?
   - "Allstate, the comparable vehicles in your valuation include [X] vehicles with [specific discrepancies]. ACG requests a re-evaluation with local market comparables of the same year, make, model, and trim level."
   - Provide independent comparable values from AutoTrader, Cars.com, and dealer listings within 50 miles.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // FARMERS
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'Farmers Insurance — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — Farmers',
    contentType: 'guide',
    tags: ['Farmers', 'claims', 'DRP', 'supplements', 'OEM_parts', 'negotiation'],
    content: `FARMERS INSURANCE GROUP
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

Farmers Insurance is California-based (headquartered in Los Angeles until recently) and is one of the largest auto insurers in the state. Farmers has a large DRP network and uses a hybrid adjusting model (staff adjusters + independent appraisers).

═══ KNOWN PATTERNS & TACTICS ═══

1. HYBRID ADJUSTING MODEL:
   - Farmers uses BOTH staff adjusters and independent appraisers.
   - Independent appraisers are paid per file and incentivized to close files quickly at low cost.
   - Quality and thoroughness vary widely among independent appraisers.
   - Staff adjusters handle more complex or high-value claims.

2. LABOR RATE NEGOTIATION:
   - Farmers' labor rate strategy is to anchor low and require documentation.
   - They will offer a rate and ask the shop to "justify" a higher rate.
   - The burden is shifted to the shop to prove the prevailing rate, when the legal burden should be on the insurer to justify their offered rate.

3. SUPPLEMENT PROCESS:
   - Farmers' supplement process is generally more cooperative than Progressive/GEICO.
   - BUT: they may require multiple supplement submissions for a single repair, breaking the process into "phases."
   - This increases administrative burden and cycle time.
   - Phase 1: initial teardown supplement. Phase 2: structural repair supplement. Phase 3: calibration supplement. Phase 4: final supplement.

4. OEM PARTS POSITION:
   - Farmers' position on OEM parts varies by adjuster.
   - Some adjusters default to OEM for structural and safety components.
   - Others aggressively push aftermarket.
   - Farmers has a "preferred parts program" with aftermarket suppliers (LKQ, Keystone).

5. DIMINISHED VALUE:
   - Farmers' position on DV is similar to other large insurers: they resist it.
   - They may offer a "goodwill" payment that is far below the actual diminished value amount.
   - Settlement: $150-300 goodwill offer vs. actual DV of $2,000-$5,000+ is common.

═══ COUNTER-STRATEGIES ═══

A. INDEPENDENT APPRAISER MANAGEMENT:
   - When an independent appraiser is assigned: establish credibility immediately.
   - "We follow OEM procedures exclusively. Every operation we request will be supported by the OEM procedure page. If you need documentation, we'll provide it. We don't request operations that aren't required."
   - Independent appraisers value efficiency — they want to close files. If you make it easy for them to approve (complete documentation, clear presentation), they are more likely to approve.

B. PHASED SUPPLEMENT STRATEGY:
   - If Farmers insists on phased supplements: use it to ACG's advantage.
   - Make each supplement THOROUGH and COMPLETE for its phase.
   - Include ALL OEM documentation for that phase.
   - A well-documented phased supplement is harder to deny than a single massive supplement with incomplete documentation.
   - Track cycle time by phase — if Farmers' phased approach adds 5+ days, document this and bill the customer for rental extension caused by insurer delay.

C. LABOR RATE JUSTIFICATION:
   - "Farmers, ACG's posted labor rate is $[XX]/hr. This is the rate charged to all customers. Per California Insurance Code §758(c), insurers shall not limit reasonable repair costs based on preferred shop charges. Please provide the specific basis for your offered rate of $[XX]/hr."
   - Have ACG's rate posted visibly (BAR requirement). Photograph it.
   - If Farmers offers below posted rate: the difference is between Farmers and their insured, not between Farmers and ACG.

D. OEM PARTS LEVERAGE:
   - Farmers adjusters often have more authority than those at GEICO/Progressive to approve OEM parts when properly justified.
   - Use this to ACG's advantage: "The [OEM] procedure requires [specific operation]. ACG can only perform this operation with OEM parts. See attached."
   - For Farmers DRP shops: they may be restricted on OEM parts usage. ACG is NOT a DRP shop and is not bound by those restrictions.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // USAA
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'USAA — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — USAA',
    contentType: 'guide',
    tags: ['USAA', 'military', 'claims', 'OEM_parts', 'negotiation', 'customer_service'],
    content: `USAA (UNITED SERVICES AUTOMOBILE ASSOCIATION)
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

USAA serves military members, veterans, and their families. USAA is generally considered more member-focused than most insurers. However, they still engage in cost containment practices. USAA members in California are a significant demographic, particularly near military bases (San Diego, Camp Pendleton, etc.).

═══ KNOWN PATTERNS & TACTICS ═══

1. MEMBER-FOCUSED MODEL (LEVERAGE):
   - USAA's brand is built on member service. This can be leveraged.
   - USAA adjusters have more flexibility to approve items that are clearly justified.
   - USAA members (customers) are generally loyal and vocal — they will complain to USAA if they feel shortchanged.
   - USAA's internal metrics weight member satisfaction heavily.

2. PARTS POLICY:
   - USAA's parts policy is more moderate than State Farm/Allstate.
   - For current model year vehicles: USAA generally approves OEM parts.
   - For vehicles 1-3 years old: mixed — aftermarket for cosmetics, OEM for structural.
   - For vehicles 3+ years: aftermarket is default, but can be converted to OEM with justification.
   - Recycled (LKQ) parts are commonly specified for older vehicles.

3. REPAIR VS. REPLACE:
   - USAA adjusters may advocate for repair over replacement where the OEM procedure specifies replacement.
   - Example: a door skin repair vs. door shell replacement. OEM may require replacement due to intrusion beam involvement. USAA may push for repair.
   - The adjuster's incentive: repair is cheaper than replace. But the OEM procedure controls.

4. RENTAL MANAGEMENT:
   - USAA is aggressive about rental duration.
   - They will set a "reasonable repair time" and cap rental at that duration.
   - If supplements or delays extend repair time, rental extension must be specifically requested and justified.
   - For claimants (third-party), USAA owes loss of use damages. They should cover rental for the ENTIRE repair period.

5. TOTAL LOSS HANDLING:
   - USAA uses contracted valuation services (similar to CCC).
   - For members (first-party), USAA's total loss process is relatively efficient.
   - For claimants (third-party), it can be slower.
   - USAA will deduct prior damage, condition adjustments, and mileage aggressively.

═══ COUNTER-STRATEGIES ═══

A. LEVERAGING THE MEMBER-FOCUSED MODEL:
   - When interacting with USAA: frame requests in terms of the member's best interest.
   - "USAA, your member's [vehicle] requires [X operation] per the manufacturer's repair procedures. This operation is essential to restore the vehicle's safety systems and preserve the factory warranty. We know USAA prioritizes member safety, so we want to ensure this is documented."
   - This framing appeals to USAA's internal culture and the adjuster's training.
   - If a legitimate operation is denied: "We'll need to inform your member that [X safety-critical operation] was not approved by USAA. The member may want to discuss this with you directly." USAA adjusters know that member complaints escalate quickly.

B. REPAIR VS. REPLACE DISPUTES:
   - Provide the OEM procedure page that specifies REPLACE.
   - "The [OEM] body repair manual specifies replacement for this component when [condition], which is present in this vehicle. ACG cannot repair this component because the OEM procedure requires replacement to maintain crashworthiness."
   - If USAA insists on repair: "ACG will perform the repair as instructed, but we will document in the repair file that USAA directed ACG to repair a component that [OEM] specifies for replacement. ACG will require USAA's written indemnification for any safety system malfunction or structural failure resulting from this deviation from OEM procedures."

C. RENTAL/LOSS OF USE:
   - For third-party claimants: "California law recognizes loss of use damages. USAA owes your insured's claimant the cost of a rental vehicle for the entire reasonable repair period. ACG will document the actual repair duration."
   - If USAA refuses to extend rental: inform the customer. "USAA has capped your rental at [X] days. The repair is expected to take [Y] days due to [parts delay/supplement review/etc.]. The difference may be recoverable from USAA through a supplemental claim."
   - For supplement-caused delays: document that the delay was caused by USAA's review time. Rental extension should be automatic when USAA causes the delay.

D. DIMINISHED VALUE (USAA-SPECIFIC):
   - USAA members are more likely to pursue diminished value because they are informed consumers.
   - "USAA, your member's vehicle has suffered inherent diminished value. We recommend the member obtain a professional DV appraisal. This is a recoverable element of damages under California law."
   - USAA's member satisfaction focus makes them more amenable to reasonable DV settlements than other insurers.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // MERCURY INSURANCE (California-specific)
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'Mercury Insurance — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — Mercury Insurance',
    contentType: 'guide',
    tags: ['Mercury', 'California', 'claims', 'low_cost', 'negotiation', 'OEM_parts'],
    content: `MERCURY INSURANCE COMPANY
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

Mercury Insurance is a California-based insurer that markets itself on low premiums. Mercury's business model depends on keeping claims costs below industry average. Mercury is one of the most aggressive cost-containment insurers ACG will encounter.

═══ KNOWN PATTERNS & TACTICS ═══

1. ULTRA-LOW COST MODEL:
   - Mercury's entire business model is built on charging lower premiums than competitors.
   - Claims cost containment is NOT a tactic — it is Mercury's EXISTENTIAL BUSINESS IMPERATIVE.
   - Every dollar paid on a claim directly impacts Mercury's profit margin more than it would for larger, more diversified insurers.
   - Expect MAXIMUM resistance on: labor rates, OEM parts, ADAS calibration, scanning, and any operation above the base estimate.

2. LABOR RATE — LOWEST IN CALIFORNIA:
   - Mercury will offer $50-$60/hr, among the lowest of any California insurer.
   - They will claim this is "prevailing" based on selective and unrepresentative surveys.
   - Mercury adjusters have very limited authority to approve rates above their schedule.

3. AFTERMARKET PARTS — 100% DEFAULT:
   - Mercury specifies aftermarket parts on EVERY possible line item, regardless of vehicle age.
   - Even for current model year vehicles: aftermarket is the default.
   - They will specify the cheapest available aftermarket option (A/M economy line, not even A/M certified).
   - For recycled parts: they will specify the cheapest grade available.

4. MINIMAL ADJUSTER AUTHORITY:
   - Mercury adjusters have LESS authority than adjusters at other insurers.
   - Most supplement decisions must go through supervisor review.
   - Supplements take LONGER at Mercury than at any other major insurer.
   - The adjuster's job is to contain cost; their supervisor's job is to contain cost. There's no internal advocate for complete repairs.

5. KNOWN REGULATORY HISTORY:
   - Mercury has been the subject of multiple CDI enforcement actions for claims handling practices.
   - In 2019, Mercury paid a $27.6 million fine for charging unapproved rates (Prop 103 violation).
   - Mercury has been cited for unfair claims practices multiple times.
   - This history is USEFUL LEVERAGE — Mercury is on CDI's radar.

═══ COUNTER-STRATEGIES ═══

A. ESCALATE EARLY AND OFTEN:
   - With Mercury, do NOT spend weeks negotiating at the adjuster level. They don't have authority to approve.
   - After the FIRST denial of a legitimate operation: "Please escalate this to your supervisor. The OEM procedure requires [operation]. The adjuster's denial does not reference any engineering or procedural basis. We need a decision from someone with authority to approve OEM-required operations."
   - Document each escalation with date, time, person contacted, and outcome.

B. REGULATORY LEVERAGE:
   - Mercury is HIGHLY sensitive to CDI complaints due to their regulatory history.
   - "Mercury, this claim has [X] documented instances of aftermarket part specification without consumer consent, per California Insurance Code §758.5. ACG is obligated to inform consumers of their rights. Please confirm in writing that Mercury has obtained the consumer's written consent for each non-OEM part specified."
   - Mercury knows that CDI investigates patterns. A shop that systematically documents Mercury's practices and reports them creates a pattern the CDI will act on.
   - "ACG maintains detailed records of every claim. If Mercury's handling of this claim demonstrates a pattern of unfair practices, ACG will provide this documentation to the California Department of Insurance."

C. CUSTOMER ADVOCACY — CRITICAL WITH MERCURY:
   - Mercury's low premiums attract price-sensitive customers who may not understand their rights.
   - Educate the customer EARLY and THOROUGHLY:
     * "Mercury specifies aftermarket parts as a default. These are not manufactured by [vehicle brand] and may not fit or perform the same. You have the right to request OEM parts per California law."
     * "Mercury's offered labor rate is below the prevailing rate for a certified collision repair facility. The difference may be billed to you. Let's discuss your options."
   - An educated customer who demands OEM parts and a complete repair becomes Mercury's problem, not ACG's.

D. COMPLETE DOCUMENTATION (MORE IMPORTANT WITH MERCURY):
   - Every supplement line item must be supported with the OEM procedure page.
   - Photograph everything — hidden damage, ADAS sensors, calibration targets, corrosion protection application.
   - Maintain a CLAIM CHRONOLOGY: date/time of every interaction, every supplement submitted, every response received.
   - This documentation serves two purposes: (1) supports supplement approval; (2) builds a bad faith file if needed.

E. SMALL CLAIMS COURT STRATEGY:
   - For Mercury claims under $10,000 where they systematically underpay: small claims court is a VIABLE strategy.
   - The vehicle owner (not ACG) files against Mercury in small claims.
   - ACG provides: the documented repair file, the OEM procedures, the supplement log, the denied line items, the CDI complaint reference number.
   - Mercury may send an attorney, but small claims in California is designed for self-representation. The cost of defending often exceeds the claim value.
   - Mercury has settled small claims cases brought by well-documented insureds rather than litigate.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // LIBERTY MUTUAL
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'Liberty Mutual — Claims Handling Playbook & Counter-Strategies',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Insurer Analysis — Liberty Mutual',
    contentType: 'guide',
    tags: ['Liberty Mutual', 'claims', 'DRP', 'supplements', 'negotiation'],
    content: `LIBERTY MUTUAL INSURANCE COMPANY
CLAIMS HANDLING ANALYSIS & COUNTER-STRATEGIES FOR ACG

Liberty Mutual is a large national insurer with significant California presence. Liberty Mutual operates a DRP network and uses a combination of staff and independent adjusters. Their claims handling approach shares similarities with Farmers but with less adjuster autonomy.

═══ KNOWN PATTERNS & TACTICS ═══

1. BUREAUCRATIC CLAIMS STRUCTURE:
   - Liberty Mutual's claims process involves multiple layers of review.
   - Supplements over a certain dollar threshold ($2,500-$5,000 depending on region) require supervisor approval.
   - Large supplements may go to a "desk review" unit that never sees the vehicle.
   - The bureaucracy creates DELAYS — not necessarily denials, but the process takes time.

2. TOTAL LOSS APPROACH:
   - Liberty Mutual uses CCC for valuations (similar to Allstate/GEICO).
   - They have a defined total loss threshold (typically 70-75% in California).
   - They may total vehicles earlier in the process than other insurers to avoid supplement-heavy repairs.

3. AFTERMARKET PARTS:
   - Liberty Mutual's aftermarket parts policy is standard for large insurers — aftermarket by default, OEM requires justification.
   - They are particularly aggressive on aftermarket wheels and suspension components.
   - Aftermarket aluminum wheels: Liberty Mutual may specify them; OEM wheels are significantly more expensive.

4. LABOR RATE POLICY:
   - Liberty Mutual's labor rate approach is market-specific.
   - In California metro areas: they may offer rates closer to prevailing (still below, but less aggressive than Progressive/Mercury).
   - They will require rate justification with market data.

5. SALVAGE RETENTION:
   - When Liberty Mutual totals a vehicle, they are aggressive about salvage retention.
   - They will deduct the full estimated salvage value from the settlement.
   - Owner-retained salvage in California has specific DMV requirements (Salvage Certificate, CHP inspection, brake and light inspection).

═══ COUNTER-STRATEGIES ═══

A. NAVIGATING THE BUREAUCRACY:
   - Identify the decision-maker early: "Who has authority to approve this supplement? Please connect me with that person or their supervisor."
   - Don't waste time negotiating with someone who can't approve.
   - For large supplements: submit with a COVER LETTER summarizing the total requested, the OEM justification, and the urgency (customer waiting, rental costs accruing).

B. TOTAL LOSS PREVENTION:
   - If the vehicle is repairable but borderline: provide Liberty Mutual with a detailed blueprint BEFORE the vehicle reaches the total loss threshold.
   - An organized repair plan that demonstrates feasibility under the threshold can prevent an unnecessary total loss declaration.
   - "Liberty Mutual, ACG has blueprinted this vehicle. The complete repair cost is $[X,XXX], which is [XX]% of the vehicle's ACV. This is a repairable vehicle. The repair can be completed in [X] days."

C. AFTERMARKET WHEEL COUNTER:
   - Aftermarket aluminum wheels have a documented history of structural failures (cracking, bending, catastrophic failure at highway speeds).
   - "Liberty Mutual, this is an aluminum alloy wheel that meets the vehicle manufacturer's load rating, speed rating, and structural specifications ONLY when it is OEM. Aftermarket aluminum wheels have not been tested by [OEM] for this vehicle's specifications. ACG cannot install a wheel not validated for this vehicle's performance envelope."
   - Cite: the OEM's wheel specifications, the vehicle's gross axle weight rating (GAWR), and the speed rating. Aftermarket wheels rarely match all specifications.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // MASTER NEGOTIATION STRATEGY
  // ═══════════════════════════════════════════════════════════════════
  {
    categoryId: 'claims_intel',
    title: 'ACG Claims Negotiation — Master Strategy & Best Practices',
    sourceName: 'ACG Claims Intelligence',
    sourceSection: 'Master Strategy',
    contentType: 'guide',
    tags: ['strategy', 'negotiation', 'supplements', 'documentation', 'legal_leverage', 'CDI'],
    content: `ACG CLAIMS NEGOTIATION — MASTER STRATEGY

This is the comprehensive playbook for ACG estimators, CSRs, and managers to maximize insurer reimbursement on every claim. These principles apply to ALL insurers.

═══ THE FIVE PILLARS OF CLAIMS NEGOTIATION ═══

PILLAR 1: OEM PROCEDURES ARE THE LAW
- Vehicle manufacturers are the ONLY AUTHORITY on how their vehicles should be repaired.
- OEM repair procedures are engineering-based specifications, not suggestions.
- Every operation ACG requests must be supported by a specific OEM procedure.
- Insurers cannot override OEM procedures — they don't have the engineering authority.
- When an insurer disputes an OEM-required operation: "Please provide the engineering analysis that supports deviating from the manufacturer's specified repair procedure."

PILLAR 2: DOCUMENTATION IS POWER
- Every supplement line item must reference the specific OEM procedure page.
- Every conversation with an adjuster should be documented: date, time, person, content, outcome.
- Every denial should be requested IN WRITING with the specific justification.
- Build a CLAIM FILE that tells a complete story — not just numbers, but the WHY behind every operation.
- A well-documented file: makes denials harder, supports escalations, builds bad faith evidence, protects ACG from liability.

PILLAR 3: THE INSURER'S INTERNAL METRICS ARE YOUR ALLY
- Claims adjusters are measured on: cycle time, severity (average claim cost), customer satisfaction, file closures per period.
- When a claim stalls due to insurer delay: the adjuster's cycle time metric suffers → they want it resolved.
- When ACG escalates: the supervisor's severity metric may be affected, but their complaint ratio matters more.
- Use the metrics knowledge strategically: "This claim has been open for [X] days with [Y] supplements pending. How can we resolve these to help your cycle time?"

PILLAR 4: THE CUSTOMER IS YOUR LEVERAGE
- The vehicle owner (the insurer's insured or claimant) is the INSURER'S customer, not ACG.
- An educated, informed customer who understands their rights is the most powerful force in claims negotiation.
- When an insurer denies a legitimate operation: "We'll need to inform your insured/claimant that [safety-critical operation] was not approved."
- Insurers HATE when their customers complain — it affects retention, satisfaction scores, and regulatory risk.
- ACG should communicate with customers about what the insurer IS and ISN'T covering. Transparency builds trust AND leverage.

PILLAR 5: REGULATORY THREAT IS REAL (BUT USE STRATEGICALLY)
- California Department of Insurance (CDI) investigates PATTERNS of unfair claims practices, not individual complaints.
- A single complaint may not trigger action. But 10+ complaints about the same insurer from the same shop? That's a pattern the CDI will investigate.
- Insurers know this. A documented history of CDI-reportable practices changes their behavior.
- When to invoke CDI: NOT as a first resort. Use it when: you have documented MULTIPLE instances of the same unfair practice, the insurer has been given opportunities to correct, and the pattern is clear.
- The phrase "ACG maintains detailed records. If this pattern continues, we will provide this documentation to the CDI for market conduct review" carries weight.

═══ THE SUPPLEMENT PROCESS — STEP BY STEP ═══

STEP 1: COMPLETE TEARDOWN & BLUEPRINT
- Teardown the vehicle COMPLETELY before writing the supplement.
- Identify EVERY operation required by OEM procedures.
- Blueprint the repair: parts list (all OEM), labor operations (all OEM-specified), ADAS requirements, calibration requirements, corrosion protection.
- A complete blueprint on the FIRST supplement is more efficient than multiple partial supplements.

STEP 2: SUPPLEMENT SUBMISSION PACKAGE
- Cover sheet: summary of supplement, total additional amount, key OEM requirements.
- Line-by-line detail with OEM procedure page references.
- Photos of all damage (pre and post-teardown).
- ADAS/calibration requirements with OEM documentation.
- Send via the insurer's preferred method (portal, email, or both).
- Document submission date, time, method, and confirmation number.

STEP 3: FOLLOW-UP PROTOCOL
- Day 1-2: No follow-up (allow processing time).
- Day 3: Check status. "Supplement submitted [date]. Status?"
- Day 5: If no response: "This supplement has been pending for 5 days. Please advise if any specific line items are in question. If no dispute is raised within 48 hours, ACG will proceed with repairs and the vehicle owner will be informed of any out-of-pocket balance."
- Day 7: Escalate to supervisor. Document the escalation.
- Day 10+: If still unresolved: CDI complaint consideration, customer notification of insurer delay.

STEP 4: DENIAL RESPONSE
- For each denied line item: request the SPECIFIC justification in writing.
- "Please provide the basis for denying [operation]. Is the denial based on: (a) the operation is not required by OEM procedures? (b) the labor time is disputed? (c) the part is not covered? (d) other?"
- This forces the insurer to commit to a specific basis, which can then be rebutted.

═══ BAD FAITH DOCUMENTATION — BUILDING THE FILE ═══

What to document on EVERY claim:
- Insurer name, claim number, adjuster name, dates of all interactions.
- All denied operations with insurer's stated reason.
- All instances of aftermarket part specification without consumer consent disclosure.
- All labor rate offers below ACG's posted rate.
- All supplement delays > 5 business days.
- All instances where insurer misrepresents policy provisions or California law to ACG or the customer.
- Photographs, OEM procedure pages, correspondence.

Why this matters:
- A well-documented bad faith file: supports CDI complaints, supports the customer's bad faith claim, protects ACG from liability, and demonstrates ACG's professionalism.
- In litigation, ACG's documentation becomes evidence. Insurers know this.
- "ACG's file on this claim includes [X] documented instances of [specific practice]. Would [insurer] like to resolve this claim before it escalates?"

═══ LEGAL CITATION QUICK REFERENCE ═══

For claims negotiation, keep these citations ready:

CONSUMER CHOICE:
- Cal. Ins. Code §758(a): Insurer shall not require repair at a specific shop.
- Cal. Ins. Code §758(c): Insurer shall not discount repair costs based on preferred shop charges.

PARTS:
- Cal. Ins. Code §758.5: Non-OEM parts must be EQUAL in kind, quality, safety, fit, AND performance. Consumer must consent.
- Cal. Ins. Code §758.5(c): Estimate must clearly identify each non-OEM part.
- 15 USC §2302 (Magnuson-Moss): Using non-OEM parts may void warranty.

FAIR CLAIMS:
- 10 CCR §2695.7: Fair claims settlement practices — communication, investigation, response times (15 calendar days).
- 10 CCR §2695.8(c): Reasonable adjustment costs include ALL costs to return vehicle to pre-loss condition.
- Cal. Ins. Code §790.03(h): Unfair claims settlement practices — 16 specific prohibited acts.

DIMINISHED VALUE:
- CACI 3903J: Diminished value is a recoverable element of property damage.
- California Civil Code §3333: Measure of damages in tort — restore to pre-loss position.

BAD FAITH:
- Cal. Ins. Code §790.03: Unfair practices — bad faith liability.
- Brandt v. Superior Court (1985) 37 Cal.3d 813: Attorney's fees recoverable in bad faith actions.`,
  },
];

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  ACG Claims Intelligence — Part 2        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let loaded = 0;
  let skipped = 0;

  for (const doc of DOCUMENTS) {
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
    `).run(docId, doc.categoryId, doc.title, doc.sourceName, doc.sourceSection || null, doc.contentType, now, JSON.stringify({ tags: doc.tags, ingested_via: 'claims-intelligence-part2' }));

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
