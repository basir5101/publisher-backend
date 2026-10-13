import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

dotenv.config();

const reportsDir = path.resolve('reports');

// Apply stealth plugin
chromium.use(stealthPlugin());

// List of domains to completely ignore during gap analysis
const EXCLUDED_DOMAINS = [
    'datainsightsreports.com',
    'google.com',
    'yahoo.com',
    'bloomberg.com',
    'globenewswire.com',
    'prnewswire.com',
    'businesswire.com',
    'linkedin.com',
    'facebook.com',
    'twitter.com',
    'pinterest.com',
    'instagram.com',
    'gartner.com',
    'numeric.io',
    'covestro.com'
];

async function runGapFixer() {
    const args = process.argv.slice(2);
    const targetUrl = args.find(a => a.startsWith('--url='))?.split('=')[1];
    const targetKeyword = args.find(a => a.startsWith('--keyword='))?.split('=')[1];

    if (!targetUrl && !targetKeyword) {
        console.error("❌ Please provide either a --url= or --keyword= argument.");
        console.error("Example: node scripts/gap_fixer.js --url=https://www.datainsightsreports.com/reports/xyz");
        process.exit(1);
    }

    // 1. Get newest report file
    const reportFiles = fs.readdirSync(reportsDir).filter(f => f.startsWith('gap-analysis-') && f.endsWith('.json'));
    if (reportFiles.length === 0) {
        console.error("❌ No gap analysis reports found in reports/ directory.");
        process.exit(1);
    }

    reportFiles.sort((a, b) => b.localeCompare(a));
    const latestReportPath = path.join(reportsDir, reportFiles[0]);

    console.log(`📂 Reading from ${reportFiles[0]}...`);

    const reportData = JSON.parse(fs.readFileSync(latestReportPath, 'utf8'));

    let targetItem = null;
    if (targetUrl) {
        targetItem = reportData.keywords.find(k => k.page_url === targetUrl);
    } else if (targetKeyword) {
        targetItem = reportData.keywords.find(k => k.keyword === targetKeyword);
    }

    if (!targetItem) {
        console.error("❌ Target not found in the latest gap analysis report.");
        process.exit(1);
    }

    const { keyword, page_url } = targetItem;
    console.log(`\n🎯 Target set!`);
    console.log(`   Keyword: "${keyword}"`);
    console.log(`   Page: ${page_url}\n`);

    // 2. Search Google via DataForSEO
    console.log(`🔍 Searching Google via DataForSEO for: "${keyword}"`);

    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
        console.error("❌ DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD is not defined in .env");
        process.exit(1);
    }

    // We dynamically import axios since it might not be imported at the top
    const axios = (await import('axios')).default;

    let competitorUrls = [];
    try {
        const d4sResponse = await axios({
            method: 'post',
            url: 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
            auth: {
                username: process.env.DATAFORSEO_LOGIN,
                password: process.env.DATAFORSEO_PASSWORD
            },
            data: [{
                keyword: keyword,
                location_code: 2840,
                language_code: "en",
                device: "desktop",
                os: "windows",
                depth: 20
            }],
            headers: { 'content-type': 'application/json' }
        });

        const items = d4sResponse.data?.tasks?.[0]?.result?.[0]?.items || [];

        const validCompetitors = items.filter(item =>
            item.type === 'organic' &&
            item.url &&
            !EXCLUDED_DOMAINS.some(domain => item.url.toLowerCase().includes(domain.toLowerCase()))
        );

        competitorUrls = validCompetitors.slice(0, 5).map(item => item.url);
    } catch (e) {
        console.error("❌ DataForSEO API Error:", e.message);
    }

    if (!competitorUrls || competitorUrls.length === 0) {
        console.error("❌ Could not find a suitable competitor URL via DataForSEO.");
        process.exit(1);
    }

    console.log(`🏆 Found ${competitorUrls.length} Competitor URLs via DataForSEO:`);
    competitorUrls.forEach((url, i) => console.log(`   ${i + 1}. ${url}`));

    // 3. Launch browser for scraping pages
    console.log("🌐 Launching Stealth Browser to Scrape Pages...");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const extractSEOData = (html) => {
        const $ = cheerio.load(html);
        const title = $('title').text().trim();
        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const author = $('meta[name="author"]').attr('content') || $('.author, [itemprop="author"]').text().substring(0, 50).trim() || '';

        let headers = [];
        $('h1, h2, h3').each((i, el) => {
            if (i < 20) headers.push(`${el.tagName.toUpperCase()}: ${$(el).text().trim()}`);
        });

        let images = [];
        $('img').each((i, el) => {
            if (i < 15) {
                const alt = $(el).attr('alt');
                images.push(alt ? `Image: alt="${alt}"` : `Image: MISSING ALT`);
            }
        });

        $('script, style, nav, footer, header, noscript, svg, iframe').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);

        return JSON.stringify({ title, metaDesc, author, headers, images, text });
    };

    let allCompetitorContent = "";

    // Scrape all competitors
    console.log(`\n📥 Scraping Competitor Pages...`);
    for (let i = 0; i < competitorUrls.length; i++) {
        const compUrl = competitorUrls[i];
        console.log(`   Scraping Competitor ${i + 1}: ${compUrl}`);

        let compHtml = '';
        try {
            await page.goto(compUrl, { waitUntil: 'load', timeout: 30000 });
            await page.waitForTimeout(2000);

            // Check for obvious bot protection blocks (Cloudflare, etc.)
            const title = await page.title();
            if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention required') || title.toLowerCase().includes('cloudflare')) {
                throw new Error('Bot verification (Cloudflare) detected');
            }

            compHtml = await page.content();
        } catch (e) {
            console.log(`   ⚠️ Playwright failed on ${compUrl} (${e.message}). Falling back to DataForSEO...`);

            let d4sSeoData = null;
            try {
                // Fallback to DataForSEO Instant Pages API
                const d4sFallback = await axios({
                    method: 'post',
                    url: 'https://api.dataforseo.com/v3/on_page/instant_pages',
                    auth: {
                        username: process.env.DATAFORSEO_LOGIN,
                        password: process.env.DATAFORSEO_PASSWORD
                    },
                    data: [{
                        url: compUrl,
                        enable_javascript: false,
                        load_resources: false
                    }],
                    headers: { 'content-type': 'application/json' }
                });

                // Extract structured SEO data from DataForSEO response
                const item = d4sFallback.data?.tasks?.[0]?.result?.[0]?.items?.[0];
                if (item && item.meta) {
                    let headers = [];
                    if (item.meta.htags) {
                        ['h1', 'h2', 'h3'].forEach(tag => {
                            if (Array.isArray(item.meta.htags[tag])) {
                                item.meta.htags[tag].forEach(h => headers.push(`${tag.toUpperCase()}: ${h}`));
                            }
                        });
                    }

                    d4sSeoData = JSON.stringify({
                        title: item.meta.title || '',
                        metaDesc: item.meta.description || '',
                        author: 'Unknown',
                        headers: headers,
                        images: [],
                        text: "Body text not available via fallback. Analyzing structure via headers."
                    });
                } else {
                    console.log(`   ❌ DataForSEO returned empty metadata for ${compUrl}. Skipping.`);
                }
            } catch (fallbackError) {
                console.log(`   ❌ DataForSEO fallback also failed for ${compUrl}.`);
            }

            if (d4sSeoData) {
                const domain = new URL(compUrl).hostname.replace('www.', '');
                allCompetitorContent += `\n--- Competitor ${i + 1} (${domain}) ---\n${d4sSeoData}\n`;
                console.log("   ✅ Data extracted successfully via DataForSEO structured metadata.");
            }
        }

        if (compHtml) {
            const seoData = extractSEOData(compHtml);
            const domain = new URL(compUrl).hostname.replace('www.', '');
            allCompetitorContent += `\n--- Competitor ${i + 1} (${domain}) ---\n${seoData}\n`;
            console.log("   ✅ Data extracted successfully.");
        }
    }

    // 4. Scrape Own Content
    console.log(`\n📥 Scraping Your Page...`);
    await page.goto(page_url, { waitUntil: 'load', timeout: 30000 }).catch(e => console.log('   Timeout on your page, processing what we have.'));
    await page.waitForTimeout(2000);
    const ownHtml = await page.content();
    const ownContent = extractSEOData(ownHtml);
    console.log(`✅ Extracted structured SEO context from your page.`);

    await browser.close();

    // 5. AI Analysis
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ GEMINI_API_KEY is not defined in .env");
        process.exit(1);
    }

    console.log('\n🤖 Sending data to Gemini AI for gap analysis...');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
You are an expert SEO content strategist. We need to perform a content gap analysis against the top ranking competitors.

Target Keyword: "${keyword}"

**Competitors' Content (Top 5 Ranking Aggregated):**
"""
${allCompetitorContent}
"""

**Our Content:**
"""
${ownContent}
"""

Analyze our detailed SEO structural data against the aggregated competitor content. Identify actual, specific, and actionable gaps and misalignments across publishing domains (RD content, Meta data, methodology, FAQs, graphical elements/authors) based on facts rather than generic "hit and try" advice.

Important Rules:
1. Keyword Match Flag: If our content does *not* match the target keyword (i.e., the page is completely off-topic or the keyword is absent/irrelevant to our current content), set "keyword_match_flag" to false. Otherwise, set it to true. IMPORTANT: If "keyword_match_flag" is false, you MUST leave all improvement and removal arrays completely EMPTY (e.g., "rd_content_improvements": []), and ONLY populate the "data" object and the "action_plan", relying solely on competitor data. Do not bother checking our website for improvements if it's completely mismatched.
2. Optional Improvements: You do not have to provide improvements for every section. If a section (e.g., FAQ, methodology, meta_data) does not need improvement or isn't relevant, leave its array empty. Provide improvements ONLY when strictly necessary. If our content is fundamentally at parity with or better than the competitors, you MUST return empty arrays. Do not invent minor stylistic nitpicks.
3. Source Attribution: For every single recommendation you provide across any category, you MUST append the source domain(s) at the end of the sentence formatted exactly like this: " (Sources: domain1.com, domain2.com)". DO NOT provide any recommendations without referencing the specific competitor domain(s).
4. Handling Removals: When recommending content to remove, place that recommendation inside the relevant category array (e.g., if it's a paragraph to delete, put it in "rd_content_improvements"; if it's an FAQ to delete, put it in "faq_improvements"). Prefix your sentence with "REMOVE: ". Only use the "general_content_to_remove" array if the removal does not fit into any other category.
5. Data Extraction: 
   - "cagr": Provide a single, fixed percentage (e.g., "11%"), NOT a range. It must align with the base year.
   - "marketSize": Provide a single, fixed value for the base year in the exact format "Value Unit" (e.g., "16.5 Billion"). Do NOT provide a range.
   - "volumeUnit": If this is a volume-based market report (e.g., Kilotons, Million Liters), output the unit here. Otherwise, leave blank.
   - "region": Extract the geographic scope (e.g., "Global", "Canada", "Asia Pacific") of the market.
   - "segments" & "companies": Synthesize a comprehensive, exhaustive list by combining and deduplicating data found across OUR content AND ALL competitor domains. EXCLUDE Geography/Regional segments (e.g., North America, Europe) from the segments list.
   - "developments": Extract any recent market developments, product launches, partnerships, or acquisitions mentioned across sources.
   CRITICAL: ONLY extract this data from legitimate Market Research websites. Completely ignore informational sites like Wikipedia or news sites. Do not invent missing data; leave blank if unavailable.

Return your response AS PURE JSON in this exact format:
{
  "keyword_match_flag": true,
  "rd_content_improvements": [
    "Specific content gap recommendation (Sources: domain1.com, domain2.com)",
    "REMOVE: Specific inflated market valuation paragraph that contradicts industry consensus (Sources: domain1.com)"
  ],
  "meta_data_improvements": ["Actionable advice for the Title and Meta Description (Sources: domain1.com)"],
  "methodology_improvements": ["Suggestions to improve trust, research citations, or methodology details (Sources: domain1.com)"],
  "faq_improvements": ["Specific FAQs the competitors have that we are missing (Sources: domain1.com)"],
  "graphics_and_trust_signals": ["Actionable insights on images, alt tags, and author presence (Sources: domain1.com)"],
  "general_content_to_remove": ["What to delete that doesn't fit in other categories: harmful, duplicated, or irrelevant elements"],
  "data": {
    "region": "Global",
    "cagr": "",
    "marketSize": "",
    "baseYear": "",
    "volumeUnit": "",
    "trends": ["trend1", "trend2"],
    "restraints": ["restraint1", "restraint2"],
    "drivers": ["driver1", "driver2"],
    "challenges": ["challenge1", "challenge2"],
    "segments": "parent1(child1, child2), parent2(child1(sub_child1, sub_child2), child2)",
    "companies": ["company1", "company2"],
    "developments": ["Company A acquired Company B", "Company C launched new product"]
  },
  "action_plan": "A short executive summary paragraph of what to do."
}
No backticks, no markdown formatting. Just the JSON object.

STRICT JSON RULE: You MUST NOT use double quotes (") anywhere INSIDE your text values or arrays. Use single quotes (') instead. Unescaped double quotes will crash our JSON parser.
`;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Clean response just in case
        const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const insights = JSON.parse(jsonStr);

        console.log('\n💡 === AI Insights ===');
        console.log(JSON.stringify(insights, null, 2));

        // 6. Save Report
        const safeKeyword = keyword.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const fixReportPath = path.join(reportsDir, `fix-analysis-${safeKeyword}.json`);

        fs.writeFileSync(fixReportPath, JSON.stringify({
            keyword,
            page_url,
            competitor_urls: competitorUrls,
            analysis: insights
        }, null, 2));

        console.log(`\n✅ Saved comprehensive fix report to ${fixReportPath}`);

    } catch (error) {
        console.error("❌ AI Error:", error);
    }
}

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runGapFixer().catch(e => {
        console.error(e);
        process.exit(1);
    });
}
