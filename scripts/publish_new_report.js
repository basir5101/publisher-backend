import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import showdown from 'showdown';
import { fileURLToPath } from 'url';

const converter = new showdown.Converter({
    noHeaderId: true,
    ghCodeBlocks: true,
    tables: true,
    simplifiedAutoLink: true,
    strikethrough: true,
});

const makeLinksNofollow = (html) => {
    if (!html || typeof html !== 'string') return html;
    return html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
        let newAttrs = attrs;
        if (/\brel\s*=\s*["'][^"']*["']/i.test(newAttrs)) {
            newAttrs = newAttrs.replace(/\brel\s*=\s*(["'])([^"']*)\1/i, (m, quote, val) => {
                const parts = new Set(val.split(/\s+/).filter(Boolean));
                parts.add('nofollow');
                parts.add('noopener');
                parts.add('noreferrer');
                return `rel=${quote}${Array.from(parts).join(' ')}${quote}`;
            });
        } else {
            newAttrs += ' rel="nofollow noopener noreferrer"';
        }

        if (!/\btarget\s*=\s*["'][^"']*["']/i.test(newAttrs)) {
            newAttrs += ' target="_blank"';
        }

        return `<a${newAttrs}>`;
    });
};

const normalizeMarketSize = (rawSize) => {
    if (!rawSize) return rawSize;
    const match = String(rawSize).match(/^([\d.,]+)\s*(.+)$/);
    if (match) {
        let val = parseFloat(match[1].replace(/,/g, ''));
        let unit = match[2].trim();
        if (val >= 1000 && unit.toLowerCase().startsWith('million')) {
            val = Number((val / 1000).toFixed(2));
            unit = 'Billion';
            return `${val} ${unit}`;
        }
    }
    return rawSize;
};

const sanitizeRdContent = (content) => {
    if (!content || typeof content !== 'string') return '';

    // 0. Remove any FAQ section if accidentally appended to rd_content (since FAQ has its own dedicated field)
    let text = content.replace(/##\s*(?:Frequently Asked Questions|FAQ|Common Questions)[\s\S]*$/i, '');

    // 1. Remove entire ASCII box diagrams (e.g. +-------+ ... +-------+)
    // Matches multi-line or single-line blocks starting with +--- and ending after +---+
    text = text.replace(/\+[-=]{4,}\+[\s\S]*?\+[-=]{4,}\+/g, '');

    // Also remove any remaining +-----+ lines or trailing diagram fragments
    text = text.replace(/^[ \t]*\+[-=]{3,}\+[ \t]*$/gm, '');
    text = text.replace(/\+[-=]{4,}\+[^\n]*/g, '');

    const lines = text.split('\n');
    const cleanedLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) {
            if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== '') {
                cleanedLines.push('');
            }
            continue;
        }

        // Skip leftover ASCII box border or arrow lines
        if (/^\+[-=]{3,}\+$/.test(line) || /^\|?[-=]{4,}\|?$/.test(line)) {
            continue;
        }
        if (/^\|?\s*v\s+.*v\s*\|?$/i.test(line) || /^\|?\s*v\s*\|?$/i.test(line) || /^\(?Severe.*Bottlenecks\)?\s*v?$/i.test(line)) {
            continue;
        }
        // If line is a leftover single-column box item with pipes like "| SE1 & SE2 ... |"
        if (/^\|\s*[^|]+\s*\|$/.test(line)) {
            continue;
        }

        // 2. Detect Unicode box-drawing or flowchart symbols
        const hasUnicodeBox = /[┌┐└┘├┤┬┴┼─═║]/.test(line);
        const hasFlowArrows = /[▼▲►◄▶◀]/.test(line);

        // Skip Unicode connector lines or tree art
        if (hasUnicodeBox && (hasFlowArrows || /^[┌┐└┘├┤┬┴┼─═║\s\-_|/\\]+$/.test(line))) {
            continue;
        }

        // Skip bracketed node diagrams (e.g. ▼ [Foundry Clusters: ...])
        if ((hasUnicodeBox || hasFlowArrows) && /\[.*?\]/.test(line)) {
            continue;
        }

        // Convert standard hierarchy tree markers like ├── or └── into clean bullet points
        if (/[├└]──\s*/.test(line)) {
            cleanedLines.push(line.replace(/[├└]──\s*/g, '- ').replace(/│\s*/g, '  '));
            continue;
        }

        // Skip isolated unicode box-drawing lines without alphanumeric text
        if (hasUnicodeBox && !/[a-zA-Z0-9]/.test(line)) {
            continue;
        }

        // Strip inline unicode box characters if mixed into normal text
        if (hasUnicodeBox) {
            line = line.replace(/[┌┐└┘├┤┬┴┼═║]/g, '').replace(/─{2,}/g, '').trim();
        }

        cleanedLines.push(line);
    }

    return cleanedLines.join('\n');
};

/**
 * Safely parse JSON from LLM responses, repairing common issues:
 * 1. Markdown codeblock backticks (```json ... ```)
 * 2. Conversational text outside root object/array
 * 3. Single-quoted keys
 * 4. Trailing commas before } or ]
 * 5. Incomplete/truncated JSON (unclosed strings, dangling keys, unclosed containers)
 * 6. Literal unescaped control characters inside JSON strings
 */
function parseOrRepairJSON(raw, keyword = '') {
    if (!raw || typeof raw !== 'string') {
        throw new Error(`Invalid JSON input (type: ${typeof raw})`);
    }

    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Find outermost JSON structure boundaries
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let startIdx = -1;
    let isObject = true;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace;
        isObject = true;
    } else if (firstBracket !== -1) {
        startIdx = firstBracket;
        isObject = false;
    }

    if (startIdx !== -1) {
        const endChar = isObject ? '}' : ']';
        const lastEnd = cleaned.lastIndexOf(endChar);
        if (lastEnd > startIdx) {
            cleaned = cleaned.substring(startIdx, lastEnd + 1);
        } else {
            cleaned = cleaned.substring(startIdx);
        }
    }

    // 1. Direct parse attempt
    try {
        return JSON.parse(cleaned);
    } catch (e1) {
        // Proceed to repairs
    }

    // 2. Simple repairs: single-quoted keys and trailing commas
    let str = cleaned.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');
    str = str.replace(/,\s*([\}\]])/g, '$1');

    try {
        return JSON.parse(str);
    } catch (e2) {
        // Proceed to structural repairs
    }

    // 3. Structural repair for truncated/unclosed JSON
    console.log(`   [${keyword}] ⚠️ JSON parse failed. Attempting structural repair...`);
    let insideString = false;
    let escapeNext = false;
    const stack = [];

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (char === '\\') {
            escapeNext = true;
            continue;
        }
        if (char === '"') {
            insideString = !insideString;
            continue;
        }
        if (!insideString) {
            if (char === '{' || char === '[') {
                stack.push(char);
            } else if (char === '}') {
                if (stack.length > 0 && stack[stack.length - 1] === '{') {
                    stack.pop();
                }
            } else if (char === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === '[') {
                    stack.pop();
                }
            }
        }
    }

    let repaired = str;
    if (insideString) {
        repaired += '"';
    }

    // Remove dangling commas, colons, or incomplete keys at the end
    repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/g, '');
    repaired = repaired.replace(/:\s*$/g, ': null');
    repaired = repaired.replace(/,\s*$/g, '');
    repaired = repaired.replace(/:\s*""$/g, ': null');
    repaired = repaired.replace(/,\s*([\}\]])/g, '$1');

    while (stack.length > 0) {
        const openChar = stack.pop();
        repaired = repaired.replace(/,\s*$/g, '');
        if (openChar === '{') {
            repaired += '}';
        } else if (openChar === '[') {
            repaired += ']';
        }
    }
    repaired = repaired.replace(/,\s*([\}\]])/g, '$1');

    try {
        return JSON.parse(repaired);
    } catch (e3) {
        // 4. Try escaping raw unescaped control characters in string literals
        try {
            const sanitized = repaired.replace(/[\u0000-\u001f]/g, (c) => {
                if (c === '\n') return '\\n';
                if (c === '\r') return '\\r';
                if (c === '\t') return '\\t';
                return '';
            });
            return JSON.parse(sanitized);
        } catch (e4) {
            const errPos = parseInt(e4.message.match(/position (\d+)/)?.[1] || '-1', 10);
            let snippet = '';
            if (errPos >= 0) {
                const start = Math.max(0, errPos - 80);
                const end = Math.min(repaired.length, errPos + 80);
                snippet = `\nContext around position ${errPos}:\n` +
                          repaired.substring(start, errPos) + " >>>HERE<<< " + repaired.substring(errPos, end);
            }
            throw new Error(`JSON parse and repair failed: ${e4.message}${snippet}`);
        }
    }
}

import { callDeepSeek } from './ai_calls.js';
import { buildBannerData, generateBannerScreenshot } from './banner_generator.js';
import pool from './db.js';
import { updateR2Asset, updateR2Content, updateR2Rd } from './r2_helper.js';
import { findInactiveMarketKeywords, updateReport } from './report_queries.js';

dotenv.config();

// Apply stealth plugin
chromium.use(stealthPlugin());

const EXCLUDED_DOMAINS = [
    'datainsightsreports.com', 'google.com', 'yahoo.com', 'bloomberg.com',
    'globenewswire.com', 'prnewswire.com', 'businesswire.com', 'linkedin.com',
    'facebook.com', 'twitter.com', 'pinterest.com', 'instagram.com',
    'gartner.com', 'numeric.io', 'covestro.com'
];

const extractSEOData = (html) => {
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    let headers = [];
    $('h1, h2, h3').each((i, el) => {
        if (i < 20) headers.push(`${el.tagName.toUpperCase()}: ${$(el).text().trim()}`);
    });
    $('script, style, nav, footer, header, noscript, svg, iframe').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
    return JSON.stringify({ title, metaDesc, headers, text });
};

export function ensureMarketWord(keyword) {
    if (!keyword || typeof keyword !== 'string') return 'market';

    // Trims extra spacing
    const trimmed = keyword.trim();

    // Checks if the case-insensitive word "market" already exists in the string
    if (/market/i.test(trimmed)) {
        return trimmed;
    }

    // Appends "market" with a clean space if missing
    return `${trimmed} market`;
}
export async function publishNewReport(prefix = 'dim', limit = 1) {
    const CONCURRENCY = parseInt(process.env.PUBLISH_CONCURRENCY, 10) || 3;
    try {
        console.log(`\n🚀 [${prefix}] Publishing ${limit} report(s) — concurrency: ${CONCURRENCY}`);
        const reports = await findInactiveMarketKeywords(prefix, limit);
        if (!reports || reports.length === 0) {
            console.log(`❌ No inactive market keywords found for prefix "${prefix}".`);
            return;
        }

        const isHeadless = process.env.HEADLESS !== 'false';
        let browser = null;
        try {
            browser = await chromium.launch({
                headless: isHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
            });
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            const limiter = pLimit(CONCURRENCY);

            const processReport = async (report, index) => {
                const { id, marketKeyword, categoryId, active } = report;
                const keyword = ensureMarketWord(marketKeyword);
                // Each concurrent job uses its own page
                const jobPage = await context.newPage();

                console.log(`🎯 [${index + 1}/${reports.length}] "${keyword}"`);

                try {
                    // 1. Search Serper API
                    let competitorUrls = [];
                    try {
                        const serperResponse = await axios({
                            method: 'post',
                            url: 'https://google.serper.dev/search',
                            headers: {
                                'X-API-KEY': process.env.SERPER_API_KEY,
                                'Content-Type': 'application/json'
                            },
                            data: { q: `${keyword} size & cagr`, num: 10 },
                            timeout: 30000
                        });
                        const items = serperResponse.data?.organic || [];
                        const validCompetitors = items.filter(item => item.link && !EXCLUDED_DOMAINS.some(domain => item.link.toLowerCase().includes(domain.toLowerCase())));
                        competitorUrls = validCompetitors.slice(0, 5).map(item => item.link);
                        console.log("competitorUrls", competitorUrls)
                    } catch (e) {
                        console.error(`[${keyword}] ❌ Serper error:`, e.message);
                    }

                if (competitorUrls.length === 0) {
                    console.error(`[${keyword}] ❌ No competitor URLs found. Skipping.`);
                    return;
                }

                // 1.5 Brainstorm & Fetch Trusted Primary Sources
                let trustedSources = [];
                try {
                    const brainstormPrompt = `You are a researcher looking for primary market data on the "${keyword}". Generate ONE optimal Google search query using advanced operators to find the most authoritative, raw trade/business data. You MUST force the query to prioritize global trade databases if applicable by using operators like (site:comtradeplus.un.org OR site:trademap.org OR site:wits.worldbank.org OR site:oecd.org OR site:dataweb.usitc.gov OR site:ec.europa.eu). You MUST also include business metrics like ("market size" OR "revenue" OR "export" OR "import"). DO NOT use "filetype:pdf", we need standard HTML pages. You MUST exclude Wikipedia by adding "-site:wikipedia.org". Return ONLY a JSON array containing this one search string. Example: ["(site:comtradeplus.un.org OR site:wits.worldbank.org OR site:.gov) \\"pneumatic valves\\" AND (\\"import\\" OR \\"market size\\") -site:wikipedia.org"]. No backticks, no markdown. Just the array.`;
                    const { text: brainstormText } = await callDeepSeek(brainstormPrompt, "deepseek-chat", { response_format: null });
                    // const { text: brainstormText } = await callGemini(brainstormPrompt, "gemini-3.8-flash", "application/json");
                    const parsedBrainstorm = parseOrRepairJSON(brainstormText, keyword);
                    trustedSources = Array.isArray(parsedBrainstorm) ? parsedBrainstorm : [parsedBrainstorm];
                } catch (error) {
                    console.error(`[${keyword}] ❌ Brainstorm query failed:`, error.message);
                }

                let primaryEvidenceContent = "";
                let primarySourceUrls = [];
                if (trustedSources.length > 0) {
                    try {
                        const topQuery = trustedSources[0];
                        const primarySerper = await axios({
                            method: 'post',
                            url: 'https://google.serper.dev/search',
                            headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
                            data: { q: topQuery, num: 3 },
                            timeout: 30000
                        });
                        const primaryItems = primarySerper.data?.organic || [];
                        // Exclude .pdf for now to avoid robust binary parsing breaks, stick to HTML articles
                        primarySourceUrls = primaryItems.filter(item => item.link && !item.link.toLowerCase().endsWith('.pdf')).slice(0, 2).map(i => i.link);
                        console.log("primarySourceUrls", primarySourceUrls)
                    } catch (e) {
                        console.error(`[${keyword}] ❌ Primary Serper search error:`, e.message);
                    }
                }

                if (primarySourceUrls.length > 0) {
                    for (let i = 0; i < primarySourceUrls.length; i++) {
                        const pUrl = primarySourceUrls[i];
                        try {
                            await jobPage.goto(pUrl, { waitUntil: 'load', timeout: 20000 });
                            await jobPage.waitForTimeout(2000);
                            let pHtml = await jobPage.content();
                            const seoData = extractSEOData(pHtml);
                            primaryEvidenceContent += `\n--- Primary Source ${i + 1} (${pUrl}) ---\n${seoData}\n`;
                        } catch (e) {
                            // silently skip failed primary source
                        }
                    }
                }

                // 2. Scrape Competitors
                let allCompetitorContent = "";
                for (let i = 0; i < competitorUrls.length; i++) {
                    const compUrl = competitorUrls[i];
                    let compHtml = '';

                    try {
                        await jobPage.goto(compUrl, { waitUntil: 'load', timeout: 30000 });
                        await jobPage.waitForTimeout(2000);
                        const title = await jobPage.title();
                        if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention required') || title.toLowerCase().includes('cloudflare')) {
                            throw new Error('Bot verification (Cloudflare) detected');
                        }
                        compHtml = await jobPage.content();
                    } catch (e) {
                        try {
                            const zyteResponse = await axios({
                                method: 'post',
                                url: 'https://api.zyte.com/v1/extract',
                                auth: { username: process.env.ZYTE_API_KEY, password: '' },
                                data: { url: compUrl, browserHtml: true },
                                headers: { 'Accept-Encoding': 'gzip' },
                                timeout: 60000
                            });
                            if (zyteResponse.data?.browserHtml) {
                                compHtml = zyteResponse.data.browserHtml;
                            }
                        } catch (fallbackError) {
                            console.error(`[${keyword}] ❌ Scrape failed for ${compUrl}:`, fallbackError.message);
                        }
                    }

                    if (compHtml) {
                        const seoData = extractSEOData(compHtml);
                        allCompetitorContent += `\n--- Industry Reference Data Document ${i + 1} ---\n${seoData}\n`;
                    }
                }

                // 3. AI Generation

                const prompt = `You are a Principal Market Research Director and Senior Industry Analyst at a premier global market intelligence firm. Your task is to write an original, highly authoritative, data-driven market research report entirely from scratch based on the synthesized industry reference data.
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
- "segments" & "companies": Synthesize an exhaustive list by combining data from all industry references. EXCLUDE Geography/Regional segments.
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
  "rd_content": "Extensive Markdown string (~2000 words). MUST contain exactly 6-8 distinct sections starting with ##. CRITICAL RULE 1 - ABSOLUTELY NO FAQ SECTION: Do NOT include any '## Frequently Asked Questions', '## FAQ', or Q&A section under any circumstances (FAQ has its own dedicated field below). CRITICAL RULE 2 - ZERO COMPETITOR MENTION: Never cite, mention, name, or link to any competitor market research firms or commercial report portals. All data and analysis must be presented strictly as our own proprietary primary research and direct expert analysis. If the market keyword corresponds to a physical product or tradable commodity that relies on supply chains, you MUST thoughtfully analyze if there is clear import/export, vendor, or supplier data available. If there is, conditionally include a dedicated '## Import/Export & Supplier Dynamics' section, breaking down the information either regionally or company-wise based on available data. OPTIONAL SECTIONS - pick any that genuinely add value for this specific market (do NOT include a section just to fill space; skip any that would be generic or repetitive): '## Value Chain Analysis', '## Global Trade Analysis & Supply Chain Risk Assessment', '## Regional Attractiveness & Investment Opportunity Assessment', '## Strategic White-Space Analysis', '## Procurement & Sourcing Strategy Analysis', '## Ansoff Matrix Analysis'. Only include an optional section if it meaningfully enriches the report for users or search engines. STRICT SEO REQUIREMENT: Maximize data density and scannability. Where a table genuinely aids comprehension (comparisons, feature matrices, multi-attribute overviews), use valid standard Markdown tables. For sections where prose or bullet points communicate content better, use those - do not force a table for every section. Avoid wall-of-text paragraphs (1-3 sentences max). Use bullet points liberally. Bold key metrics (CAGR, valuations). CRITICAL FORMATTING RESTRICTIONS: 1) DO NOT use LaTeX, MathJax, or output ANY mathematical equations (e.g., skip the formula for CAGR); just write the values in plain text. 2) ABSOLUTELY NO ASCII ART, TEXT DIAGRAMS, BOX DRAWINGS, OR FLOWCHARTS OF ANY KIND. NEVER output '+---+' or '|' character boxes. NEVER use arrows or connector markers like 'v', '^', '-->', '->', '=>'. NEVER use Unicode tree lines or box symbols ('├──', '│', '└──', '┌', '┐', '┴', '┬', '─', '▼', '▲'). 3) ZERO FAQ OR FREQUENTLY ASKED QUESTIONS SECTIONS. 4) ZERO COMPETITOR NAMES OR WEBSITES. EVERY piece of information MUST be conveyed exclusively via standard Markdown prose, standard Markdown bullet points ('- Point'), or valid standard Markdown tables (| Col 1 | Col 2 |\\n|---|---|\\n| Val 1 | Val 2 |).",
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

No JSON codeblock backticks. Just return the JSON object directly. Format as 100% valid JSON. Escape all internal double quotes inside strings (e.g., \\") and properly escape all newlines as \\n.`;

                let insights;
                try {
                    // To switch to DeepSeek natively, uncomment below:
                    const { text, usage, finishReason } = await callDeepSeek(prompt, "deepseek-chat");
                    // const { text, usage } = await callGemini(prompt, "gemini-3.8-flash", "application/json");
                    if (finishReason === 'length') {
                        console.warn(`   [${keyword}] ⚠️ DeepSeek reached max_tokens limit (8192). JSON might be truncated.`);
                    }

                    insights = parseOrRepairJSON(text, keyword);

                    if (insights.data?.marketSize) {
                        insights.data.marketSize = normalizeMarketSize(insights.data.marketSize);
                    }

                    const methodologyHtml = makeLinksNofollow(converter.makeHtml(insights.methodology || ''));
                    const finalMethodology = {
                        methodology_content: methodologyHtml,
                        chart_data_companies: insights.chart_data_companies || [],
                        chart_data_stakeholders: insights.chart_data_stakeholders || []
                    };

                    // 4. Generate and Upload Valuation Banner Image
                    let imageR2Key = null;
                    const bannerPage = await context.newPage();
                    try {
                        const bannerConfig = buildBannerData({
                            prefix: prefix,
                            marketKeyword: marketKeyword,
                            title: insights.metadata?.title,
                            cagr: insights.data?.cagr,
                            marketSize: insights.data?.marketSize,
                            baseYear: insights.data?.baseYear,
                            drivers: insights.data?.drivers,
                            restraints: insights.data?.restraints,
                        });

                        const bannerResult = await generateBannerScreenshot({
                            page: bannerPage,
                            bannerData: bannerConfig,
                        });

                        if (bannerResult?.buffer) {
                            const imageKey = `${prefix}/images/en/${id}.png`;
                            const imageUpload = await updateR2Content(imageKey, bannerResult.buffer, 'image/png', 'image');
                            if (imageUpload.success) {
                                imageR2Key = imageKey;
                            } else {
                                console.error(`[${keyword}] ❌ Banner R2 upload failed:`, imageUpload.error);
                            }
                        }
                    } catch (bannerErr) {
                        console.error(`[${keyword}] ❌ Banner generation failed:`, bannerErr.message);
                    } finally {
                        await bannerPage.close().catch(() => {});
                    }

                    // Save to Cloudflare R2
                    const sanitizedRdContent = sanitizeRdContent(insights.rd_content || '');
                    const rawRdHtml = converter.makeHtml(sanitizedRdContent);
                    const rdHtml = makeLinksNofollow(rawRdHtml);
                    const rdKey = `rd/${prefix}/en/${id}.html`;
                    const rmKey = `methodology/${prefix}/en/${id}.json`;

                    const rdUpload = await updateR2Rd(rdKey, rdHtml, 'text/html');
                    const rmUpload = await updateR2Asset(rmKey, JSON.stringify(finalMethodology, null, 2), 'application/json');

                    if (rdUpload.success && rmUpload.success) {
                        console.log(`✅ [${keyword}] Published successfully.`);
                    } else {
                        console.error(`[${keyword}] ❌ R2 upload failed:`, rdUpload.error || rmUpload.error);
                    }

                    const summaryLog = {
                        prefix: prefix,
                        id: id,
                        active,
                        marketKeyword: marketKeyword,
                        categoryId: categoryId,
                        meta_title: insights.metadata?.title,
                        meta_description: insights.metadata?.meta_description,
                        ...(insights.data || {}),
                        faq: insights.faq || [],
                        rd_r2_key: rdKey,
                        rm_r2_key: rmKey,
                        image_r2_key: imageR2Key,
                        regional_market_share: insights.regional_market_share || insights.data?.regional_market_share || null
                    };

                    await updateReport(summaryLog);

                    if (usage) {
                        console.log(`   [${keyword}] Tokens: ${usage.totalTokenCount} (in: ${usage.promptTokenCount}, out: ${usage.candidatesTokenCount})`);
                    }
                } catch (error) {
                    console.error(`❌ [${keyword}] AI Error:`, error);
                }
            } finally {
                await jobPage.close();
            }
        };

            // Run all reports concurrently with p-limit
            await Promise.all(
                reports.map((report, index) => limiter(() => processReport(report, index)))
            );
        } finally {
            if (browser) {
                await browser.close().catch(() => {});
            }
        }
    } catch (err) {
        console.error('Error executing query:', err.stack);
        throw err;
    }
}

// Run the check when this script is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const targetPrefix = process.argv[2] || 'dim';
    const targetLimit = parseInt(process.argv[3], 10) || 1;
    publishNewReport(targetPrefix, targetLimit)
        .then(() => {
            console.log(`🏁 Execution finished for prefix: ${targetPrefix} (limit: ${targetLimit})`);
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Execution failed:', err);
            process.exit(1);
        })
        .finally(() => {
            pool.end();
        });
}
