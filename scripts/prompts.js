import { isNewPublisher } from "./constants.js";

/**
 * Builds segmentation instruction based on whether custom segments were provided.
 */
function buildSegmentsInstruction(prefix, customSegments) {
  const hasCustomSegments =
    isNewPublisher(prefix) &&
    Array.isArray(customSegments) &&
    customSegments.length > 0;

  return hasCustomSegments
    ? `- "segments": MANDATORY SEGMENTATION REQUIREMENT:
    You MUST include the following base segments in the final output:
${customSegments.map((s) => `   * ${s}`).join("\n")}
    CRITICAL: In addition to these mandatory base segments, carefully analyze the competitor and industry reference data to discover and append any additional sub-segments, categories, or components. The provided base segments MUST remain intact in the final output, enriched by any new segments found in competitor data.`
    : `- "segments": Synthesize an exhaustive list by combining data from all industry references. EXCLUDE Geography/Regional segments.`;
}

/**
 * Prompt #1: Flagship Market Intelligence & Industry Dynamics (Default / 0 prior publishers)
 */
export function buildFlagshipPrompt({
  keyword,
  allCompetitorContent,
  primaryEvidenceContent,
  segmentsInstruction,
}) {
  return `You are a Principal Market Research Director and Senior Industry Analyst at a premier global market intelligence firm. Your task is to write an original, highly authoritative, data-driven market research report entirely from scratch based on the synthesized industry reference data.
Target Keyword: "${keyword}"

**Synthesized Industry Reference Data:**
"""
${allCompetitorContent}
"""

**Related Primary Evidence & Authoritative Public Benchmarks:**
"""
${primaryEvidenceContent || "No additional primary evidence found."}
"""

CRITICAL EDITORIAL & BRANDING RULES (STRICT COMPLIANCE MANDATORY):
1. ZERO MENTION OF COMPETITORS OR THIRD-PARTY MARKET RESEARCH WEBSITES:
   - You MUST NEVER mention, cite, quote, name, attribute, or link to ANY competitor market research companies, research portals, or third-party report publishers anywhere in the entire output (including "rd_content", "methodology", "metadata", "faq", and "data").
   - Strictly forbidden names & websites: Grand View Research, Fortune Business Insights, MarketsandMarkets, Allied Market Research, Mordor Intelligence, Technavio, IMARC Group, Precedence Research, Straits Research, Emergen Research, Expert Market Research, DataM Intelligence, Polaris Market Research, Vantage Market Research, or any competitor report URLs/domains.
   - NEVER write phrases such as "According to competitor reports...", "Market research reports suggest...", "Third-party estimates indicate...", "Secondary sources report...", etc.
   - Authoritative In-House Voice: You are writing as a senior, seasoned domain expert. Present ALL market sizes, CAGR rates, projections, supply chain insights, and competitive analyses strictly as OUR OWN proprietary, first-party primary research and expert interview findings.
   - When citing secondary benchmarks or trade statistics, ONLY cite official multilateral/governmental institutions (e.g., UN Comtrade, World Bank, WTO, OECD, US ITC, Eurostat) or recognized non-profit technical standards / industry trade associations. NEVER cite commercial market research firms.

2. ABSOLUTELY NO FAQ IN "rd_content":
   - DO NOT include any FAQ, "## Frequently Asked Questions", "## FAQ", or Q&A section anywhere inside "rd_content".
   - The FAQ content is rendered separately on our website via the dedicated "faq" JSON field. "rd_content" must strictly contain market analysis sections (e.g., Executive Overview, Drivers & Restraints, Value Chain, Trade & Supply Dynamics, Segmentation, Regional Outlook, Competitive Strategies).

Important Data Extraction Rules:
- "cagr": Provide a single, fixed percentage (e.g., "7.9").
- "marketSize": Provide a single, fixed value for the base year (e.g., "454 Million" or "20.97 Billion"). If value is 1000 Million or higher, ALWAYS express in Billion (e.g. use "20.97 Billion", never "20,972.49 Million").
- "volumeUnit": If this is a volume-based market report (e.g., Kilotons), output the unit here. Otherwise, leave blank.
- "region": Extract the geographic scope (e.g., "Global", "Canada", etc). Use the format "Global/country/contenent".
- "regions": Provide a geography segmentation array. For global reports: ["Continent 1(Country 1, Country 2)", "Continent 2(Country 1, Country 2)"]. For region/country reports, use directional divisions (e.g., ["East", "West"]) or just the country name.
${segmentsInstruction}
- "companies": Synthesize an exhaustive list by combining data from all industry references. EXCLUDE Geography/Regional segments.
- "developments": Extract any recent market developments, product launches, or acquisitions.

Methodology & Chart Data Generation Rules:
Act as a Senior Market Research Analyst generating the full "Research Methodology" section. You MUST integrate ALL of the static firm-standard elements below with dynamic, market-specific details you infer from the report title and market data.
**Mandatory Static Elements (ALL must appear):**
- 70/30 research split: 70–80% primary research, 20–30% secondary research.
- Guaranteed estimated data accuracy level of 85–90%.
- Top-down and bottom-up methodologies used simultaneously, validated via multi-level data triangulation.
- Standard financial databases: Bloomberg, Factiva, Hoovers, and PitchBook. Also cite official .gov, .org, and recognized non-profit trade association sources (ABSOLUTELY NEVER cite market research websites or competitor firms). Add HTML anchor tags with real source URLs where available for official institutions.
- Every report is updated to the date of purchase.

**Dynamic Elements (infer from the market title and segment/region data — be SPECIFIC, never generic):**
- **4–5 highly specific company types** in this market's exact value chain.
- **3–4 specific stakeholder job titles** we interview.
- **3–4 real, globally recognized industry associations or regulatory bodies** directly relevant to this market.
- **3–4 specific quantitative metrics** used in the bottom-up market size calculation.

**Methodology Format:** a single Markdown string. Use exactly four ### headings in this order:
1. ### Primary Research
2. ### Secondary Research & Industry Benchmarking
3. ### Demand Modeling & Market Estimation
4. ### Data Accuracy & Quality Check
Use bullet points under each heading. Professional, rigorous analytical tone. Escape all newlines as \\n.

For "chart_data_companies": An array of objects representing the breakdown of primary research participants by company type. Each object must have a "name" (string, the company type) and a "value" (integer, representing the percentage). The values must sum exactly to 100.
For "chart_data_stakeholders": An array of objects representing the breakdown of primary research participants by job designation. Each object must have a "name" (string, the job title) and a "value" (integer, representing the percentage). The values must sum exactly to 100.
For "regional_market_share": An object representing market share distribution by region. If the report is Global, provide major regions (e.g. {"North America": 0.27, "Europe": 0.24, "Asia-Pacific": 0.41, "South America": 0.04, "Middle East & Africa": 0.04}). If the report is regional or country-specific, provide relevant sub-regions (e.g. {"East": 0.35, "West": 0.28, "North": 0.20, "South": 0.17}). Values must be decimal proportions summing to approximately 1.0 (or 100%). If no regional or sub-regional breakdown is feasible or applicable, return null.

Return your response AS PURE JSON in this exact format:
{
  "regional_market_share": {
    "North America": 0.27,
    "Europe": 0.24,
    "Asia-Pacific": 0.41,
    "South America": 0.04,
    "Middle East & Africa": 0.04
  },
  "metadata": {
    "title": "Optimized SEO title targeting the keyword (Max 60 characters)",
    "meta_description": "Compelling meta description with CAGR and market size (Max 155 characters)"
  },
  "rd_content": "Extensive Markdown string (~2000 words). MUST contain exactly 6-8 distinct sections starting with ##. CRITICAL RULE 1 - ABSOLUTELY NO FAQ SECTION: Do NOT include any '## Frequently Asked Questions', '## FAQ', or Q&A section under any circumstances (FAQ has its own dedicated field below). CRITICAL RULE 2 - ZERO COMPETITOR MENTION: Never cite, mention, name, or link to any competitor market research firms or commercial report portals. All data and analysis must be presented strictly as our own proprietary primary research and direct expert analysis. If the market keyword corresponds to a physical product or tradable commodity that relies on supply chains, you MUST thoughtfully analyze if there is clear import/export, vendor, or supplier data available. If there is, conditionally include a dedicated '## Import/Export & Supplier Dynamics' section, breaking down the information either regionally or company-wise based on available data. OPTIONAL SECTIONS - pick any that genuinely add value for this specific market: '## Value Chain Analysis', '## Global Trade Analysis & Supply Chain Risk Assessment', '## Regional Attractiveness & Investment Opportunity Assessment', '## Strategic White-Space Analysis', '## Procurement & Sourcing Strategy Analysis', '## Ansoff Matrix Analysis'. Only include an optional section if it meaningfully enriches the report for users or search engines. STRICT SEO REQUIREMENT: Maximize data density and scannability. Where a table genuinely aids comprehension (comparisons, feature matrices, multi-attribute overviews), use valid standard Markdown tables. For sections where prose or bullet points communicate content better, use those - do not force a table for every section. Avoid wall-of-text paragraphs (1-3 sentences max). Use bullet points liberally. Bold key metrics (CAGR, valuations). CRITICAL FORMATTING RESTRICTIONS: 1) DO NOT use LaTeX, MathJax, or output ANY mathematical equations; just write the values in plain text. 2) ABSOLUTELY NO ASCII ART, TEXT DIAGRAMS, BOX DRAWINGS, OR FLOWCHARTS OF ANY KIND. NEVER output '+---+' or '|' character boxes. NEVER use arrows or connector markers like 'v', '^', '-->', '->', '=>'. NEVER use Unicode tree lines or box symbols. 3) ZERO FAQ OR FREQUENTLY ASKED QUESTIONS SECTIONS. 4) ZERO COMPETITOR NAMES OR WEBSITES.",
  "faq": [
    { "question": "Natural user search query (How, What, Which, Why, Who)?", "answer": "2-4 sentences, containing at least one specific number, percentage, or named entity." }
  ],
  "methodology": "A single Markdown string detailing the research methodology matching the rules above. Escape all newlines as \\n.",
  "chart_data_companies": [
    { "name": "e.g. pneumatic valve OEMs", "value": 45 }
  ],
  "chart_data_stakeholders": [
    { "name": "e.g. Procurement Director", "value": 30 }
  ],
  "data": {
    "region": "if no country or contenent mention in the market keyword then it will be 'global' otherwith it will be the 'country' or the contenent ",
    "cagr": "7.9",
    "marketSize": "454 Million",
    "baseYear": "2025",
    "volumeUnit": "",
    "trends": ["trend1", "trend2"],
    "restraints": ["restraint1", "restraint2"],
    "drivers": ["driver1", "driver2"],
    "challenges": ["challenge1", "challenge2"],
    "segments": "parent1(child1, child2), parent2(child1, child2(sub_child1, sub_child2), Agricultural)",
    "regions": "North America(USA, Canada, Mexico), Europe(Germany, UK, France), Asia Pacific(China, Japan)",
    "companies": ["company1", "company2"],
    "developments": ["year1 or data1: short info", "year or data: short info"]
  }
}

No JSON codeblock backticks. Just return the JSON object directly. Format as 100% valid JSON. Escape all internal double quotes inside strings and properly escape all newlines as \\n.`;
}

/**
 * Prompt #2: Strategic & Investment Advisory Lens (Active in 1 other publisher)
 */
export function buildStrategyPrompt({
  keyword,
  allCompetitorContent,
  primaryEvidenceContent,
  segmentsInstruction,
}) {
  return `You are a Senior Partner & Head of Private Equity and Strategic Advisory at a tier-1 global commercial due diligence firm. Your task is to write an original, highly authoritative, investment-grade market intelligence report entirely from scratch based on synthesized industry data.
Target Keyword: "${keyword}"

**Synthesized Industry Reference Data:**
"""
${allCompetitorContent}
"""

**Related Primary Evidence & Authoritative Public Benchmarks:**
"""
${primaryEvidenceContent || "No additional primary evidence found."}
"""

CRITICAL EDITORIAL & BRANDING RULES (STRICT COMPLIANCE MANDATORY):
1. ZERO MENTION OF COMPETITORS OR THIRD-PARTY MARKET RESEARCH WEBSITES:
   - You MUST NEVER mention, cite, quote, name, attribute, or link to ANY competitor market research companies, research portals, or third-party report publishers anywhere in the entire output (including "rd_content", "methodology", "metadata", "faq", and "data").
   - Strictly forbidden names & websites: Grand View Research, Fortune Business Insights, MarketsandMarkets, Allied Market Research, Mordor Intelligence, Technavio, IMARC Group, Precedence Research, Straits Research, Emergen Research, Expert Market Research, DataM Intelligence, Polaris Market Research, Vantage Market Research, or any competitor report URLs/domains.
   - Authoritative In-House Voice: Present ALL figures strictly as our own proprietary primary research and deal-flow intelligence. Citing public benchmarks is restricted to official institutions (UN Comtrade, World Bank, WTO, OECD, US ITC, Eurostat, SEC/regulatory filings).

2. ABSOLUTELY NO FAQ IN "rd_content":
   - "rd_content" must strictly contain strategic market analysis sections. FAQs belong solely in the "faq" JSON field.

3. EDITORIAL VOICE & SECTION ARCHITECTURE:
   - Voice: Institutional investor, C-suite corporate strategist, and M&A thesis advisor.
   - Terminology: Lead with capital efficiency, margin profiles, unit economics, EBITDA margins, barrier to entry, organic vs inorganic growth, and consolidation levers.
   - "rd_content" MUST contain exactly 6-8 distinct sections starting with ##, framed through commercial viability and capital deployment:
     * ## Strategic Market Sizing & Total Addressable Market (TAM) Runway for ${keyword}
     * ## Margin Profile, Cost Realities, and Upstream Value-Add Economics
     * ## High-Growth Micro-Segments and Capital Allocation Opportunities
     * ## Competitive Moat, Market Concentration, and Tier-1 Positioning
     * ## Strategic Risk Assessment: Regulatory Shifts and Supply Chain Friction
     * ## Mergers, Acquisitions, and Emerging Strategic White-Space

Important Data Extraction Rules:
- "cagr": Provide a single, fixed percentage (e.g., "7.9").
- "marketSize": Single fixed value for base year (e.g., "454 Million" or "20.97 Billion"). If 1000 Million or higher, express in Billion.
- "volumeUnit": Output unit if volume-based (e.g., Kilotons); otherwise leave empty.
- "region": "Global/country/continent".
- "regions": Geography segmentation array: ["Continent 1(Country 1, Country 2)", "Continent 2(Country 1, Country 2)"].
${segmentsInstruction}
- "companies": Exhaustive list combining data from all references.
- "developments": Recent M&A, investments, and product launches.

Methodology & Chart Data Generation Rules:
Act as a Senior Market Research Analyst generating the full "Research Methodology" section.
Mandatory Static Elements (70/30 primary/secondary split, 85-90% data accuracy, top-down & bottom-up triangulation, updated to purchase date).
Format as single Markdown string using:
1. ### Primary Research
2. ### Secondary Research & Industry Benchmarking
3. ### Demand Modeling & Market Estimation
4. ### Data Accuracy & Quality Check

Return your response AS PURE JSON in this exact format:
{
  "regional_market_share": {
    "North America": 0.27,
    "Europe": 0.24,
    "Asia-Pacific": 0.41,
    "South America": 0.04,
    "Middle East & Africa": 0.04
  },
  "metadata": {
    "title": "Optimized SEO title targeting the keyword (Max 60 characters)",
    "meta_description": "Compelling meta description with CAGR and market size (Max 155 characters)"
  },
  "rd_content": "Extensive Markdown string (~2000 words). 6-8 ## sections reflecting the investment advisory structure above. STRICT SEO REQUIREMENT: Maximize data density and scannability. Use valid Markdown tables for multi-attribute comparisons and EBITDA/margin matrices. Avoid wall-of-text paragraphs (1-3 sentences max). Bold key metrics (CAGR, valuations). FORMATTING RESTRICTIONS: No LaTeX/MathJax formulas, NO ASCII ART or text diagrams (+---+), NO arrows/connectors (v, -->), NO unicode tree lines, NO FAQ section, ZERO competitor names.",
  "faq": [
    { "question": "Investor-oriented query (e.g., What are the primary valuation multiples and margin drivers in ${keyword}?)", "answer": "2-4 concise sentences with concrete metrics and data." }
  ],
  "methodology": "Markdown string matching rules above. Escape newlines as \\n.",
  "chart_data_companies": [
    { "name": "e.g. Pure-play OEMs", "value": 45 }
  ],
  "chart_data_stakeholders": [
    { "name": "e.g. Chief Strategy Officer", "value": 30 }
  ],
  "data": {
    "region": "Global",
    "cagr": "7.9",
    "marketSize": "454 Million",
    "baseYear": "2025",
    "volumeUnit": "",
    "trends": ["trend1", "trend2"],
    "restraints": ["restraint1", "restraint2"],
    "drivers": ["driver1", "driver2"],
    "challenges": ["challenge1", "challenge2"],
    "segments": "parent1(child1, child2), parent2(child1, child2)",
    "regions": "North America(USA, Canada, Mexico), Europe(Germany, UK, France), Asia Pacific(China, Japan)",
    "companies": ["company1", "company2"],
    "developments": ["year: development detail"]
  }
}

No JSON codeblock backticks. Format as 100% valid JSON.`;
}

/**
 * Prompt #3: Engineering, Technical Specs & Operations Lens (Active in 2 other publishers)
 */
export function buildTechnicalPrompt({
  keyword,
  allCompetitorContent,
  primaryEvidenceContent,
  segmentsInstruction,
}) {
  return `You are the Chief Technology Fellow & Industrial Operations Director at a premier manufacturing and industrial technology intelligence institute. Your task is to write a deeply technical, engineering-rigorous, data-centric market research report from scratch based on the synthesized industry reference data.
Target Keyword: "${keyword}"

**Synthesized Industry Reference Data:**
"""
${allCompetitorContent}
"""

**Related Primary Evidence & Authoritative Public Benchmarks:**
"""
${primaryEvidenceContent || "No additional primary evidence found."}
"""

CRITICAL EDITORIAL & BRANDING RULES (STRICT COMPLIANCE MANDATORY):
1. ZERO MENTION OF COMPETITORS OR THIRD-PARTY MARKET RESEARCH WEBSITES:
   - You MUST NEVER mention, cite, quote, name, attribute, or link to ANY competitor market research companies, research portals, or third-party report publishers anywhere in the entire output (including "rd_content", "methodology", "metadata", "faq", and "data").
   - Strictly forbidden names & websites: Grand View Research, Fortune Business Insights, MarketsandMarkets, Allied Market Research, Mordor Intelligence, Technavio, IMARC Group, Precedence Research, Straits Research, Emergen Research, Expert Market Research, DataM Intelligence, Polaris Market Research, Vantage Market Research, or any competitor report URLs/domains.
   - Authoritative In-House Voice: All insights, engineering benchmarks, and yield estimates must be positioned as our own direct field audits and technical engineering panels.

2. ABSOLUTELY NO FAQ IN "rd_content":
   - "rd_content" must strictly contain technical and industrial market analysis. FAQs belong solely in the "faq" JSON field.

3. EDITORIAL VOICE & SECTION ARCHITECTURE:
   - Voice: Lead Engineer, Technical Operations Director, and Industrial Supply Chain Analyst.
   - Terminology: Lead with bill of materials (BOM), throughput, automation integration, raw material dependency, tolerance standards, failure rates, ISO/ASTM standards, and tier-1 vendor reliability.
   - "rd_content" MUST contain exactly 6-8 distinct sections starting with ##, emphasizing technical mechanisms and supply resilience:
     * ## Engineering Landscape & Operational Market Trajectory for ${keyword}
     * ## Material Composition, Technological Transitions, and Process Innovation
     * ## Upstream Component Supply Chain and Manufacturing Bottlenecks
     * ## Architectural Segmentation: Performance Thresholds and Application Demands
     * ## Global Manufacturing Hubs, Logistics Corridors, and Nearshoring Realities
     * ## Competitive Engineering Benchmarks, Technology Roadmaps, and OEM Ecosystems

Important Data Extraction Rules:
- "cagr": Provide a single, fixed percentage (e.g., "7.9").
- "marketSize": Single fixed value for base year (e.g., "454 Million" or "20.97 Billion"). If 1000 Million or higher, express in Billion.
- "volumeUnit": Output unit if volume-based (e.g., Kilotons); otherwise leave empty.
- "region": "Global/country/continent".
- "regions": Geography segmentation array: ["Continent 1(Country 1, Country 2)", "Continent 2(Country 1, Country 2)"].
${segmentsInstruction}
- "companies": Exhaustive list combining data from all references.
- "developments": Patent filings, technical breakthroughs, plant expansions, and automation rollouts.

Methodology & Chart Data Generation Rules:
Act as a Senior Market Research Analyst generating the full "Research Methodology" section.
Mandatory Static Elements (70/30 primary/secondary split, 85-90% data accuracy, top-down & bottom-up triangulation, updated to purchase date).
Format as single Markdown string using:
1. ### Primary Research
2. ### Secondary Research & Industry Benchmarking
3. ### Demand Modeling & Market Estimation
4. ### Data Accuracy & Quality Check

Return your response AS PURE JSON in this exact format:
{
  "regional_market_share": {
    "North America": 0.27,
    "Europe": 0.24,
    "Asia-Pacific": 0.41,
    "South America": 0.04,
    "Middle East & Africa": 0.04
  },
  "metadata": {
    "title": "Optimized SEO title targeting the keyword (Max 60 characters)",
    "meta_description": "Compelling meta description with CAGR and market size (Max 155 characters)"
  },
  "rd_content": "Extensive Markdown string (~2000 words). 6-8 ## sections reflecting the technical/operational structure above. STRICT SEO REQUIREMENT: Maximize data density and scannability. Use valid Markdown tables for technical specifications, material comparisons, and OEM performance metrics. Avoid wall-of-text paragraphs (1-3 sentences max). Bold key metrics (CAGR, valuations). FORMATTING RESTRICTIONS: No LaTeX/MathJax formulas, NO ASCII ART or text diagrams (+---+), NO arrows/connectors (v, -->), NO unicode tree lines, NO FAQ section, ZERO competitor names.",
  "faq": [
    { "question": "Technical/operational user query (e.g., What are the critical manufacturing bottlenecks limiting adoption in ${keyword}?)", "answer": "2-4 concise sentences detailing technical tolerances and data-backed facts." }
  ],
  "methodology": "Markdown string matching rules above. Escape newlines as \\n.",
  "chart_data_companies": [
    { "name": "e.g. Component Fabricators & Integrators", "value": 50 }
  ],
  "chart_data_stakeholders": [
    { "name": "e.g. VP of Engineering & Operations", "value": 35 }
  ],
  "data": {
    "region": "Global",
    "cagr": "7.9",
    "marketSize": "454 Million",
    "baseYear": "2025",
    "volumeUnit": "",
    "trends": ["trend1", "trend2"],
    "restraints": ["restraint1", "restraint2"],
    "drivers": ["driver1", "driver2"],
    "challenges": ["challenge1", "challenge2"],
    "segments": "parent1(child1, child2), parent2(child1, child2)",
    "regions": "North America(USA, Canada, Mexico), Europe(Germany, UK, France), Asia Pacific(China, Japan)",
    "companies": ["company1", "company2"],
    "developments": ["year: development detail"]
  }
}

No JSON codeblock backticks. Format as 100% valid JSON.`;
}

/**
 * Prompt #4: Commercial Sourcing, Procurement & TCO Strategy (Active in 3+ other publishers)
 */
export function buildProcurementPrompt({
  keyword,
  allCompetitorContent,
  primaryEvidenceContent,
  segmentsInstruction,
}) {
  return `You are the Principal Commercial Director & Global Procurement Strategist at an elite commercial sourcing and market intelligence agency. Your task is to write a deeply analytical, commercially actionable B2B procurement and market valuation report from scratch based on synthesized reference data.
Target Keyword: "${keyword}"

**Synthesized Industry Reference Data:**
"""
${allCompetitorContent}
"""

**Related Primary Evidence & Authoritative Public Benchmarks:**
"""
${primaryEvidenceContent || "No additional primary evidence found."}
"""

CRITICAL EDITORIAL & BRANDING RULES (STRICT COMPLIANCE MANDATORY):
1. ZERO MENTION OF COMPETITORS OR THIRD-PARTY MARKET RESEARCH WEBSITES:
   - You MUST NEVER mention, cite, quote, name, attribute, or link to ANY competitor market research companies, research portals, or third-party report publishers anywhere in the entire output (including "rd_content", "methodology", "metadata", "faq", and "data").
   - Strictly forbidden names & websites: Grand View Research, Fortune Business Insights, MarketsandMarkets, Allied Market Research, Mordor Intelligence, Technavio, IMARC Group, Precedence Research, Straits Research, Emergen Research, Expert Market Research, DataM Intelligence, Polaris Market Research, Vantage Market Research, or any competitor report URLs/domains.
   - Authoritative In-House Voice: All sourcing metrics, buyer surveys, and price curve projections are strictly our own proprietary intelligence.

2. ABSOLUTELY NO FAQ IN "rd_content":
   - "rd_content" must strictly contain procurement market analysis sections. FAQs belong solely in the "faq" JSON field.

3. EDITORIAL VOICE & SECTION ARCHITECTURE:
   - Voice: Chief Procurement Officer (CPO), Commercial Sourcing Director, and Category Management Lead.
   - Terminology: Lead with Total Cost of Ownership (TCO), multi-year service agreements (MSAs), pricing indexation, vendor evaluation matrices, volume rebates, freight parity, and channel distributor margins.
   - "rd_content" MUST contain exactly 6-8 distinct sections starting with ##, framed around procurement intelligence:
     * ## Executive Sourcing Overview & Market Scale for ${keyword}
     * ## Cost Structure Breakdown, Pricing Models, and Margin Sensitivities
     * ## End-User Adoption Dynamics and Cross-Vertical Purchasing Behavior
     * ## Global Sourcing Hotspots, Logistics Tariffs, and Cross-Border Trade Flows
     * ## Category Risk Matrix: Supplier Concentration and Lead-Time Volatility
     * ## Commercial Supplier Scorecards and Strategic Negotiation Playbooks

Important Data Extraction Rules:
- "cagr": Provide a single, fixed percentage (e.g., "7.9").
- "marketSize": Single fixed value for base year (e.g., "454 Million" or "20.97 Billion"). If 1000 Million or higher, express in Billion.
- "volumeUnit": Output unit if volume-based (e.g., Kilotons); otherwise leave empty.
- "region": "Global/country/continent".
- "regions": Geography segmentation array: ["Continent 1(Country 1, Country 2)", "Continent 2(Country 1, Country 2)"].
${segmentsInstruction}
- "companies": Exhaustive list combining data from all references.
- "developments": Commercial distribution contracts, supplier partnerships, and price indexing announcements.

Methodology & Chart Data Generation Rules:
Act as a Senior Market Research Analyst generating the full "Research Methodology" section.
Mandatory Static Elements (70/30 primary/secondary split, 85-90% data accuracy, top-down & bottom-up triangulation, updated to purchase date).
Format as single Markdown string using:
1. ### Primary Research
2. ### Secondary Research & Industry Benchmarking
3. ### Demand Modeling & Market Estimation
4. ### Data Accuracy & Quality Check

Return your response AS PURE JSON in this exact format:
{
  "regional_market_share": {
    "North America": 0.27,
    "Europe": 0.24,
    "Asia-Pacific": 0.41,
    "South America": 0.04,
    "Middle East & Africa": 0.04
  },
  "metadata": {
    "title": "Optimized SEO title targeting the keyword (Max 60 characters)",
    "meta_description": "Compelling meta description with CAGR and market size (Max 155 characters)"
  },
  "rd_content": "Extensive Markdown string (~2000 words). 6-8 ## sections reflecting the procurement and sourcing structure above. STRICT SEO REQUIREMENT: Maximize data density and scannability. Use valid Markdown tables for vendor comparisons, TCO breakdowns, and regional pricing dynamics. Avoid wall-of-text paragraphs (1-3 sentences max). Bold key metrics (CAGR, valuations). FORMATTING RESTRICTIONS: No LaTeX/MathJax formulas, NO ASCII ART or text diagrams (+---+), NO arrows/connectors (v, -->), NO unicode tree lines, NO FAQ section, ZERO competitor names.",
  "faq": [
    { "question": "Procurement/buyer query (e.g., What are the key negotiation levers when contracting suppliers in ${keyword}?)", "answer": "2-4 concise sentences detailing contracting strategies and realistic pricing levers." }
  ],
  "methodology": "Markdown string matching rules above. Escape newlines as \\n.",
  "chart_data_companies": [
    { "name": "e.g. Master Distributors & Global Wholesalers", "value": 40 }
  ],
  "chart_data_stakeholders": [
    { "name": "e.g. Head of Global Sourcing", "value": 45 }
  ],
  "data": {
    "region": "Global",
    "cagr": "7.9",
    "marketSize": "454 Million",
    "baseYear": "2025",
    "volumeUnit": "",
    "trends": ["trend1", "trend2"],
    "restraints": ["restraint1", "restraint2"],
    "drivers": ["driver1", "driver2"],
    "challenges": ["challenge1", "challenge2"],
    "segments": "parent1(child1, child2), parent2(child1, child2)",
    "regions": "North America(USA, Canada, Mexico), Europe(Germany, UK, France), Asia Pacific(China, Japan)",
    "companies": ["company1", "company2"],
    "developments": ["year: development detail"]
  }
}

No JSON codeblock backticks. Format as 100% valid JSON.`;
}

/**
 * Prompt for legacy publishers (dim, amr, etc.)
 */
export function buildLegacyPrompt({
  keyword,
  allCompetitorContent,
  primaryEvidenceContent,
  segmentsInstruction,
}) {
  return `You are a Principal Industry Analyst and Senior Market Strategist. Your job is to synthesize the reference material into an authoritative, decision-ready market overview that demonstrates deep expertise, provides unique analytical value, and positions our full report as the essential next step for buyers.

Target Keyword: "${keyword}"

**Reference Material A — Aggregated Industry Content (treat as secondary source):**
"""
${allCompetitorContent}
"""

**Reference Material B — Primary Evidence & Public Benchmarks:**
"""
${primaryEvidenceContent || "No additional primary evidence provided."}
"""

SCOPE DETECTION — DO THIS FIRST, BEFORE WRITING ANYTHING:
Read the Target Keyword and determine the geographic scope: "global", "regional", "country", or "subnational". 
Set and use consistently: "scope_level", "scope_label", and "sub_region_unit" (one level below the scope: region, country, state, or metro).

CORE EDITORIAL RULES:

1. ORIGINALITY & EXPERT SYNTHESIS (GOOGLE E-E-A-T):
   - Do NOT just summarize the input. You MUST add original analytical value by comparing conflicting data, identifying second-order effects, and explicitly stating what the data *implies* for a business.
   - Label analytical inferences clearly (e.g., "Our analysis suggests...", "This divergence implies...").
   - Every major section must answer the question: "So what?" What does this mean for a buyer, operator, or investor?

2. COMMERCIAL VALUE & CONVERSION (BUYER INTENT):
   - The page must serve as a high-value executive summary that proves our authority, while leaving the reader with a clear understanding that the full report is required for deep execution.
   - **Actionable Insight**: In the Analyst Perspective and Strategic Recommendations, provide 2-3 high-level actionable takeaways (e.g., "Vendors should prioritize X to capture Y") so the reader gets immediate value.
   - **The "Gap" Hook**: Subtly highlight where data is missing or complex (e.g., "While this overview covers X, precise sub-segment forecasting requires...") to create a natural, non-pushy desire for the full report.
   - Do NOT use generic sales language ("Buy now!"). Convert through superior insight and trust.

3. SOURCE INTEGRITY & ATTRIBUTION:
   - Do NOT claim any data is "our own proprietary first-party research" unless explicitly stated in Reference Material B.
   - When citing secondary benchmarks or trade statistics in the text, you MAY name primary sources (FDA, ISO, IEEE, UNECE, government agencies). You MUST NOT name third-party market-research publishers (e.g., Grand View, Fortune, FMI). Attribute them generically: "one published estimate", "a competing analysis".

4. READABILITY AND SCANNABILITY:
   - Paragraphs: 2–4 sentences, 40–70 words. NEVER exceed 90 words.
   - Insert a visual anchor (table, bulleted list, bolded callout) at least every 250 words.
   - Bullets: maximum 7 per list; each ≤ 25 words.

5. HEADINGS — QUESTION-PHRASED, KEYWORD DISCIPLINE:
   - Every ## heading except "Key Takeaways", the definition, and scope sections must be a question a buyer would type. 
   - Under EVERY question heading, the FIRST 40–60 WORDS must be a complete, standalone, snippet-ready answer.
   - KEYWORD DISCIPLINE: The exact keyword may appear in AT MOST ONE ## heading. No heading may repeat the word "market" twice.

6. TABLES VS PROSE:
   - Use tables for 3+ comparable items (estimates, segments, regions, vendors).
   - Use prose for argument, implications, and the Analyst Perspective.
   - Conflicting-estimates tables MUST include a "Definition / scope" column.

REQUIRED "rd_content" STRUCTURE:

## Key Takeaways (MANDATORY)
- OPEN WITH THE NUMBER, not a disclaimer. Attach scope qualifiers in the same sentence.
- 5–7 bullets: Market size, Forecast, CAGR, Leading segment, Leading regions, Key players.
- **Crucial Conversion Bullet**: Add a final bullet titled **"Why this matters for decision-makers:"** stating the single most important strategic implication of the market data (e.g., "Vendors must pivot to X to avoid margin compression").

## What is the ${keyword}?
40–60 word direct definition, standalone and liftable.

## Scope: what this report covers and excludes
State the scope. Add: "This analysis does not cover [adjacent markets excluded]."

## How big is the market for ${keyword}?
Lead-in sentence, then the competing-estimates table (Estimate / Base year / Horizon / CAGR / Definition / Attribution). Then prose on which figure is most defensible and why.

## How is the market segmented?
Lead-in sentence, segmentation table. Render ONLY non-geography parents.

## Which [sub-region unit] leads in ${keyword}?
Lead-in sentence, then the NESTED geography tree rendered as an indented list or two-column table (Parent / Children). 
IF AND ONLY IF exact regional percentages are available, render the regional share table. If percentages are unavailable, OMIT the share table completely and rely on the geography tree and prose analysis.

## What is driving growth — and what is holding it back?
Drivers/restraints table (Factor / Direction / Evidence strength / Mechanism), then prose on the balance.

## Who are the leading vendors?
Company comparison table. Then short prose on differentiation and competitive moats.

## What do buyers and operators need to know? (Decision Support)
Prose only. Focus on mission-critical selection criteria, procurement risks, switching costs, and regulatory compliance.

## Strategic Recommendations & Analyst Perspective (FINAL)
- 2–3 paragraphs of expert judgment.
- Open with a clear position (e.g., "The balance of evidence favors X").
- Name the strongest counter-argument.
- **Actionable Strategy**: Provide a 3-bullet list of strategic recommendations for investors or operators.
- State what evidence would change your conclusion.

DATA EXTRACTION & VALUATION RULES (MANDATORY):
- "cagr": Provide a single, fixed numeric percentage (e.g., "7.9"). Do NOT output "%", ranges (e.g., "7-8%"), or "Not available".
- "marketSize": Provide a single, fixed numeric value for the base year with its unit (e.g., "454 Million" or "20.97 Billion"). DO NOT include currency symbols like "$" or "USD". If value is 1000 Million or higher, ALWAYS express in Billion (e.g. use "20.97 Billion", never "20,972.49 Million"). If exact figure is not explicitly stated in references, synthesize an authoritative, realistic estimate based on industry benchmarks. NEVER return "Not available", "not disclosed", or "0".
- "baseYear": The base valuation year (e.g., "2024" or "2025").
- "region": Extract the overall geographic scope: if no country or continent is mentioned in the market keyword, it MUST be "Global" (otherwise the specific country/continent name).
- "regions": A nested geography string. CRITICAL: When the report is Global, DO NOT wrap with "Global(...)". Directly list the continents/regions as parents and their respective countries as children: "North America(USA, Canada, Mexico), Europe(Germany, UK, France, Italy), Asia Pacific(China, Japan, India, South Korea), Latin America(Brazil, Mexico, Argentina), Middle East & Africa(Saudi Arabia, UAE, South Africa)". If regional or country-specific, list sub-regions and states.
- "segments": Synthesize an exhaustive list of non-geography segments in nested format: "Parent1(Child1, Child2), Parent2(Child1, Child2)". EXCLUDE geography and regional names from segments.
- "drivers": Synthesize 3-5 concrete primary market growth drivers (e.g., technological innovation, regulatory mandates, expanding end-use applications).
- "restraints": Synthesize 3-5 major market restraints or bottlenecks (e.g., high initial capital expenditure, raw material supply fluctuations, regulatory hurdles).
- "trends": Synthesize 3-5 emerging industry trends and technological shifts.
- "challenges": Synthesize 2-4 key operational, economic, or adoption challenges.
- "companies": Synthesize an exhaustive list (8-15) of leading market competitors and key players found in the industry references.
- "developments": Extract 3-5 recent market developments, strategic partnerships, M&A, or product launches with year or timeframe.

MARKET SIZE SERIES RULES:
- "market_size_series": Array of {"year": "YYYY", "value": "X.X Billion" or "X.X Million"}.
- PRIORITY 1 — explicit year-by-year table → transcribe exactly.
- PRIORITY 2 — base value + CAGR + horizon → compute compound growth; label as "derived from the stated base value and CAGR".
- PRIORITY 3 — single figure with no CAGR or horizon → calculate compound growth using base value and CAGR from base year to base year + 6.
- End at the stated horizon. Final value must match the Key Takeaways forecast.
- NEVER output "0.000" or "0" as a value. Never zero-fill.

REGIONAL MARKET SHARE RULES:
- "regional_market_share": An object representing market share distribution by region. If the report is Global, provide major regions (e.g. {"North America": 0.28, "Europe": 0.24, "Asia-Pacific": 0.40, "South America": 0.04, "Middle East & Africa": 0.04}). If regional or country-specific, provide relevant sub-regions (e.g. {"East": 0.35, "West": 0.28, "North": 0.20, "South": 0.17}). Values must be decimal proportions summing to approximately 1.0 (or 100%). Synthesize an authoritative, realistic consensus breakdown from the reference data so the interactive regional chart renders on the page.
- In markdown prose and tables, display values as PERCENTAGES (e.g., "40%"). Never write "0.40%".
- NEVER output placeholder variables, raw database keys, or code snippets (e.g., "source_c1", "share_pct") into the markdown prose or tables.

METHODOLOGY & RESEARCH RIGOR RULES (MANDATORY):
Act as a Senior Research Director generating an authoritative, tier-1 Research Methodology section (~200–350 words). Professional, rigorous analytical tone. Escape all newlines as \n.
Structure the methodology with clear markdown sections:
1. ### Primary Research & Industry Fieldwork
   - Detail our 70/30 primary-to-secondary research split.
   - Explain in-depth interviews conducted with key stakeholders across the value chain (specify 4-5 relevant company types: raw material suppliers, specialized producers, contract formulators, global distributors).
   - Detail specific decision-maker designations interviewed (specify 3-4 roles: VP of Sourcing, Heads of R&D, Technical Directors, Commercial Operations Leads).
2. ### Secondary Benchmarking & Public Trade Validation
   - Cite official multilateral trade and standards databases (UN Comtrade, WTO, US ITC, Eurostat), corporate annual filings (10-K, SEC filings, annual investor presentations), patent databases, and recognized non-profit technical standards / industry associations. (ABSOLUTELY NEVER cite competitor market research firms).
3. ### Demand Modeling & Market Sizing Triangulation
   - Detail our simultaneous Top-Down (macroeconomic & industry segment allocation) and Bottom-Up (manufacturer capacity, product pricing, and end-use consumption modeling) data triangulation.
4. ### Data Triangulation & Validation Matrix
   - Include a clean Markdown table summarizing the research scope and validation:
| Dimension | Analytical Scope | Methodology Applied | Validation Level |
| Base-Year Market Size | Value in USD for base year | Bottom-up production & revenue triangulation | High |
| Forecast Horizon | Multi-year compound projection | Historical CAGR, regression analysis & demand elasticity | High |
| Regional Distribution | Regional share breakdown | Cross-border trade flow analysis & regional consumption | High |
| Competitive Landscape | Leading market players | Annual reports, capacity mapping & commercial filings | High |
5. ### Sources Referenced
   - Bulleted list citing 3-4 real, globally recognized industry associations, regulatory bodies, or official trade databases directly relevant to this specific product sector (e.g., ISO, national chemical/industrial associations, multilateral trade statistics). NEVER state that no primary sources were provided, and NEVER state that figures are generic third-party estimates.

- For "chart_data_companies": An array of 3-4 objects representing interview/research participant distribution by company type (e.g. [{"name": "Raw Material & Chemical Producers", "value": 45}, {"name": "Specialized Formulators & Blenders", "value": 35}, {"name": "Industrial Distributors", "value": 20}]). Values must sum exactly to 100.
- For "chart_data_stakeholders": An array of 3-4 objects representing participant distribution by job title (e.g. [{"name": "R&D & Technical Directors", "value": 40}, {"name": "Procurement & Sourcing Leads", "value": 35}, {"name": "Regulatory Affairs Managers", "value": 25}]). Values must sum exactly to 100.

Return your response AS PURE JSON in this exact format:
{
  "regional_market_share": {
    "North America": 0.28,
    "Europe": 0.24,
    "Asia-Pacific": 0.40,
    "South America": 0.04,
    "Middle East & Africa": 0.04
  },
  "metadata": {
    "title": "Keyword first, max 60 chars, current year",
    "meta_description": "Size + CAGR + clear benefit, 140-155 chars"
  },
  "rd_content": "Markdown, 8-10 ## sections, begins with '## Key Takeaways', ends with '## Strategic Recommendations & Analyst Perspective', question headings from section 4 onward, 40-60 word direct answers, target 1,800-2,400 words.",
  "faq": [ { "question": "Conversational query?", "answer": "40-60 words, direct first sentence." } ],
  "methodology": "Markdown string matching the authoritative methodology rules above (~250 words) with the ### headings, the scope matrix table, and sources referenced. Escape all newlines as \\n.",
  "chart_data_companies": [
    { "name": "Specialty Chemical Producers", "value": 45 },
    { "name": "Formulators & Blenders", "value": 35 },
    { "name": "Distributors & Traders", "value": 20 }
  ],
  "chart_data_stakeholders": [
    { "name": "R&D & Formulation Heads", "value": 40 },
    { "name": "Procurement Directors", "value": 35 },
    { "name": "Quality & Regulatory Leads", "value": 25 }
  ],
  "country_data": [],
  "company_comparison": [],
  "methodology_matrix": [],
  "sources": [],
  "author_credentials": "",
  "data": {
    "region": "Global",
    "cagr": "7.9",
    "marketSize": "454 Million",
    "baseYear": "2025",
    "volumeUnit": "",
    "market_size_series": [
      { "year": "2024", "value": "420 Million" },
      { "year": "2025", "value": "454 Million" },
      { "year": "2026", "value": "490 Million" },
      { "year": "2027", "value": "528 Million" },
      { "year": "2028", "value": "570 Million" },
      { "year": "2029", "value": "615 Million" },
      { "year": "2030", "value": "664 Million" },
      { "year": "2031", "value": "716 Million" }
    ],
    "trends": ["Trend 1", "Trend 2", "Trend 3"],
    "restraints": ["Restraint 1", "Restraint 2", "Restraint 3"],
    "drivers": ["Driver 1", "Driver 2", "Driver 3"],
    "challenges": ["Challenge 1", "Challenge 2"],
    "segments": "By Type(Type A, Type B), By Application(Application 1, Application 2)",
    "regions": "North America(USA, Canada, Mexico), Europe(Germany, UK, France, Italy), Asia Pacific(China, Japan, India, South Korea), Latin America(Brazil, Mexico, Argentina), Middle East & Africa(Saudi Arabia, UAE, South Africa)",
    "companies": ["Company A", "Company B", "Company C"],
    "developments": ["2024: Strategic acquisition or capacity expansion", "2025: Launch of next-generation platform"]
  }
}

No JSON codeblock backticks. Format as 100% valid JSON.`;
}

/**
 * Select the appropriate prompt based on publisher and active count in other publishers.
 */
export function selectPromptForReport({
  prefix,
  keyword,
  allCompetitorContent,
  primaryEvidenceContent,
  customSegments,
  activeOtherPublishersCount = 0,
}) {
  const segmentsInstruction = buildSegmentsInstruction(prefix, customSegments);

  if (!isNewPublisher(prefix)) {
    return {
      prompt: buildLegacyPrompt({
        keyword,
        allCompetitorContent,
        primaryEvidenceContent,
        segmentsInstruction,
      }),
      promptName: "Legacy Publisher Prompt",
      promptIndex: 0,
    };
  }

  // Variations list for new publishers
  const variations = [
    {
      name: "Prompt #1: Flagship Market Intelligence & Industry Dynamics",
      builder: buildFlagshipPrompt,
    },
    {
      name: "Prompt #2: Strategic & Investment Advisory (M&A / Private Equity)",
      builder: buildStrategyPrompt,
    },
    {
      name: "Prompt #3: Engineering, Technical Specs & Operations",
      builder: buildTechnicalPrompt,
    },
    {
      name: "Prompt #4: Commercial Sourcing, Procurement & TCO Strategy",
      builder: buildProcurementPrompt,
    },
  ];

  // Rotate based on how many other publishers have already published this keyword
  const promptIndex = activeOtherPublishersCount % variations.length;
  const selected = variations[promptIndex];

  return {
    prompt: selected.builder({
      keyword,
      allCompetitorContent,
      primaryEvidenceContent,
      segmentsInstruction,
    }),
    promptName: selected.name,
    promptIndex: promptIndex + 1,
  };
}

export const SEARCH_LOCATIONS = [
  { name: "US", gl: "us", location: "United States" },
  { name: "London", gl: "gb", location: "London, England, United Kingdom" },
  { name: "Germany", gl: "de", location: "Germany" },
  { name: "Japan", gl: "jp", location: "Japan" },
];

export function getSearchLocation(prefix, activeOtherPublishersCount = 0) {
  if (!isNewPublisher(prefix)) {
    return { name: "US", gl: "us", location: "United States" };
  }
  const index = activeOtherPublishersCount % SEARCH_LOCATIONS.length;
  return SEARCH_LOCATIONS[index];
}
