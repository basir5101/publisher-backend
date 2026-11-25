import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import pLimit from "p-limit";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import showdown from "showdown";
import { fileURLToPath } from "url";

const converter = new showdown.Converter({
  noHeaderId: true,
  ghCodeBlocks: true,
  tables: true,
  simplifiedAutoLink: true,
  strikethrough: true,
});

const makeLinksNofollow = (html) => {
  if (!html || typeof html !== "string") return html;
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    let newAttrs = attrs;
    if (/\brel\s*=\s*["'][^"']*["']/i.test(newAttrs)) {
      newAttrs = newAttrs.replace(
        /\brel\s*=\s*(["'])([^"']*)\1/i,
        (m, quote, val) => {
          const parts = new Set(val.split(/\s+/).filter(Boolean));
          parts.add("nofollow");
          parts.add("noopener");
          parts.add("noreferrer");
          return `rel=${quote}${Array.from(parts).join(" ")}${quote}`;
        },
      );
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
  const { marketValue, unit } = getUnitValue(rawSize);
  if (marketValue > 0) {
    return `${marketValue} ${unit}`;
  }
  return rawSize;
};

const sanitizeRdContent = (content) => {
  if (!content || typeof content !== "string") return "";

  // 0. Remove any FAQ section if accidentally appended to rd_content (since FAQ has its own dedicated field)
  let text = content.replace(
    /##\s*(?:Frequently Asked Questions|FAQ|Common Questions)[\s\S]*$/i,
    "",
  );

  // 1. Remove entire ASCII box diagrams (e.g. +-------+ ... +-------+)
  // Matches multi-line or single-line blocks starting with +--- and ending after +---+
  text = text.replace(/\+[-=]{4,}\+[\s\S]*?\+[-=]{4,}\+/g, "");

  // Also remove any remaining +-----+ lines or trailing diagram fragments
  text = text.replace(/^[ \t]*\+[-=]{3,}\+[ \t]*$/gm, "");
  text = text.replace(/\+[-=]{4,}\+[^\n]*/g, "");

  const lines = text.split("\n");
  const cleanedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      if (
        cleanedLines.length > 0 &&
        cleanedLines[cleanedLines.length - 1] !== ""
      ) {
        cleanedLines.push("");
      }
      continue;
    }

    // Skip leftover ASCII box border or arrow lines
    if (/^\+[-=]{3,}\+$/.test(line) || /^\|?[-=]{4,}\|?$/.test(line)) {
      continue;
    }
    if (
      /^\|?\s*v\s+.*v\s*\|?$/i.test(line) ||
      /^\|?\s*v\s*\|?$/i.test(line) ||
      /^\(?Severe.*Bottlenecks\)?\s*v?$/i.test(line)
    ) {
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
    if (
      hasUnicodeBox &&
      (hasFlowArrows || /^[┌┐└┘├┤┬┴┼─═║\s\-_|/\\]+$/.test(line))
    ) {
      continue;
    }

    // Skip bracketed node diagrams (e.g. ▼ [Foundry Clusters: ...])
    if ((hasUnicodeBox || hasFlowArrows) && /\[.*?\]/.test(line)) {
      continue;
    }

    // Convert standard hierarchy tree markers like ├── or └── into clean bullet points
    if (/[├└]──\s*/.test(line)) {
      cleanedLines.push(
        line.replace(/[├└]──\s*/g, "- ").replace(/│\s*/g, "  "),
      );
      continue;
    }

    // Skip isolated unicode box-drawing lines without alphanumeric text
    if (hasUnicodeBox && !/[a-zA-Z0-9]/.test(line)) {
      continue;
    }

    // Strip inline unicode box characters if mixed into normal text
    if (hasUnicodeBox) {
      line = line
        .replace(/[┌┐└┘├┤┬┴┼═║]/g, "")
        .replace(/─{2,}/g, "")
        .trim();
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n");
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
function parseOrRepairJSON(raw, keyword = "") {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) {
    throw new Error(`Received empty response from LLM`);
  }
  if (typeof raw !== "string") {
    throw new Error(`Invalid JSON input (expected string, got ${typeof raw})`);
  }

  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  // Find outermost JSON structure boundaries
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
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
    const endChar = isObject ? "}" : "]";
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
  str = str.replace(/,\s*([\}\]])/g, "$1");

  try {
    return JSON.parse(str);
  } catch (e2) {
    // Proceed to structural repairs
  }

  // 3. Structural repair for truncated/unclosed JSON
  console.log(
    `   [${keyword}] ⚠️ JSON parse failed. Attempting structural repair...`,
  );
  let insideString = false;
  let escapeNext = false;
  const stack = [];

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      insideString = !insideString;
      continue;
    }
    if (!insideString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
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
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/g, "");
  repaired = repaired.replace(/:\s*$/g, ": null");
  repaired = repaired.replace(/,\s*$/g, "");
  repaired = repaired.replace(/:\s*""$/g, ": null");
  repaired = repaired.replace(/,\s*([\}\]])/g, "$1");

  while (stack.length > 0) {
    const openChar = stack.pop();
    repaired = repaired.replace(/,\s*$/g, "");
    if (openChar === "{") {
      repaired += "}";
    } else if (openChar === "[") {
      repaired += "]";
    }
  }
  repaired = repaired.replace(/,\s*([\}\]])/g, "$1");

  try {
    return JSON.parse(repaired);
  } catch (e3) {
    // 4. Try escaping raw unescaped control characters in string literals
    try {
      const sanitized = repaired.replace(/[\u0000-\u001f]/g, (c) => {
        if (c === "\n") return "\\n";
        if (c === "\r") return "\\r";
        if (c === "\t") return "\\t";
        return "";
      });
      return JSON.parse(sanitized);
    } catch (e4) {
      const errPos = parseInt(
        e4.message.match(/position (\d+)/)?.[1] || "-1",
        10,
      );
      let snippet = "";
      if (errPos >= 0) {
        const start = Math.max(0, errPos - 80);
        const end = Math.min(repaired.length, errPos + 80);
        snippet =
          `\nContext around position ${errPos}:\n` +
          repaired.substring(start, errPos) +
          " >>>HERE<<< " +
          repaired.substring(errPos, end);
      }
      throw new Error(`JSON parse and repair failed: ${e4.message}${snippet}`);
    }
  }
}

import { callAI, callDeepSeek, callOpenRouter } from "./ai_calls.js";
import {
  buildBannerData,
  generateBannerScreenshot,
} from "./banner_generator.js";
import { isNewPublisher } from "./constants.js";
import { getSearchLocation, selectPromptForReport } from "./prompts.js";
import pool from "./db.js";
import { updateR2Asset, updateR2Content, updateR2Rd } from "./r2_helper.js";
import {
  buildMarketSizeInMillions,
  findInactiveMarketKeywords,
  getUnitValue,
  updateReport,
} from "./report_queries.js";

dotenv.config();

// Apply stealth plugin
chromium.use(stealthPlugin());

const EXCLUDED_DOMAINS = [
  "datainsightsreports.com",
  "google.com",
  "yahoo.com",
  "bloomberg.com",
  "globenewswire.com",
  "prnewswire.com",
  "businesswire.com",
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "pinterest.com",
  "instagram.com",
  "gartner.com",
  "numeric.io",
  "covestro.com",
];

const extractSEOData = (html) => {
  const $ = cheerio.load(html);
  const title = $("title").text().trim();
  const metaDesc = $('meta[name="description"]').attr("content") || "";
  let headers = [];
  $("h1, h2, h3").each((i, el) => {
    if (i < 20)
      headers.push(`${el.tagName.toUpperCase()}: ${$(el).text().trim()}`);
  });
  $("script, style, nav, footer, header, noscript, svg, iframe").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);
  return JSON.stringify({ title, metaDesc, headers, text });
};

export function ensureMarketWord(keyword) {
  if (!keyword || typeof keyword !== "string") return "market";

  // Trims extra spacing
  const trimmed = keyword.trim();

  // Checks if the case-insensitive word "market" already exists in the string
  if (/market/i.test(trimmed)) {
    return trimmed;
  }

  // Appends "market" with a clean space if missing
  return `${trimmed} market`;
}
export async function publishNewReport(
  prefix = "dim",
  limit = 1,
  id = null,
  customSegments = null,
  options = {},
) {
  const CONCURRENCY = parseInt(process.env.PUBLISH_CONCURRENCY, 10) || 3;
  const activeProvider = (
    (typeof options === "string" ? options : options?.provider) ||
    process.env.AI_PROVIDER ||
    "deepseek"
  ).toLowerCase();

  const activeModel =
    (typeof options === "object" ? options?.model : null) ||
    (activeProvider === "openrouter"
      ? process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017"
      : activeProvider === "gemini"
        ? process.env.GEMINI_MODEL || "gemini-3.8-flash"
        : process.env.DEEPSEEK_MODEL || "deepseek-chat");

  try {
    console.log(
      `\n🚀 [${prefix}] Publishing ${id ? `report ID: ${id}` : `${limit} report(s)`} — AI: ${activeProvider} (${activeModel}) — concurrency: ${CONCURRENCY}`,
    );
    const reports = await findInactiveMarketKeywords(prefix, limit, id);
    if (!reports || reports.length === 0) {
      console.log(
        `❌ No inactive market keywords found for prefix "${prefix}"${id ? ` with ID ${id}` : ""}.`,
      );
      return;
    }

    const isHeadless = process.env.HEADLESS !== "false";
    let browser = null;
    try {
      browser = await chromium.launch({
        headless: isHeadless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      const limiter = pLimit(CONCURRENCY);

      const processReport = async (report, index) => {
        const {
          id,
          marketKeyword,
          categoryId,
          active,
          slug,
          content_key: originalContentKey,
          already_published_count = 0,
          published_publishers = [],
        } = report;
        const keyword = ensureMarketWord(marketKeyword || report.markeKeyword);
        const searchLocation = getSearchLocation(prefix, already_published_count);
        // Each concurrent job uses its own page
        const jobPage = await context.newPage();

        if (isNewPublisher(prefix)) {
          const pubInfo =
            already_published_count > 0
              ? `already active in ${already_published_count} publisher(s): [${published_publishers.join(", ")}] | Search location: ${searchLocation.name}`
              : `fresh keyword (0 active publishers) | Search location: ${searchLocation.name}`;
          console.log(
            `🎯 [${index + 1}/${reports.length}] "${keyword}" — ${pubInfo}`,
          );
        } else {
          console.log(`🎯 [${index + 1}/${reports.length}] "${keyword}"`);
        }

        try {
          // 1. Search Serper API
          let competitorUrls = [];
          try {
            const serperData = {
              q: `${keyword} size & cagr`,
              num: 10,
              ...(searchLocation
                ? { gl: searchLocation.gl, location: searchLocation.location }
                : {}),
            };
            const serperResponse = await axios({
              method: "post",
              url: "https://google.serper.dev/search",
              headers: {
                "X-API-KEY": process.env.SERPER_API_KEY,
                "Content-Type": "application/json",
              },
              data: serperData,
              timeout: 30000,
            });
            const items = serperResponse.data?.organic || [];
            const validCompetitors = items.filter(
              (item) =>
                item.link &&
                !EXCLUDED_DOMAINS.some((domain) =>
                  item.link.toLowerCase().includes(domain.toLowerCase()),
                ),
            );
            competitorUrls = validCompetitors
              .slice(0, 5)
              .map((item) => item.link);
            console.log("competitorUrls", competitorUrls);
          } catch (e) {
            console.error(`[${keyword}] ❌ Serper error:`, e.message);
          }

          if (competitorUrls.length === 0) {
            console.error(
              `[${keyword}] ❌ No competitor URLs found. Skipping.`,
            );
            return;
          }

          // 1.5 Brainstorm & Fetch Trusted Primary Sources
          let trustedSources = [];
          try {
            const brainstormPrompt = `You are a researcher looking for primary market data on the "${keyword}". Generate ONE optimal Google search query using advanced operators to find the most authoritative, raw trade/business data. You MUST force the query to prioritize global trade databases if applicable by using operators like (site:comtradeplus.un.org OR site:trademap.org OR site:wits.worldbank.org OR site:oecd.org OR site:dataweb.usitc.gov OR site:ec.europa.eu). You MUST also include business metrics like ("market size" OR "revenue" OR "export" OR "import"). DO NOT use "filetype:pdf", we need standard HTML pages. You MUST exclude Wikipedia by adding "-site:wikipedia.org". Return ONLY a JSON array containing this one search string. Example: ["(site:comtradeplus.un.org OR site:wits.worldbank.org OR site:.gov) \\"pneumatic valves\\" AND (\\"import\\" OR \\"market size\\") -site:wikipedia.org"]. No backticks, no markdown. Just the array.`;
            const { text: brainstormText } = await callAI(
              brainstormPrompt,
              {
                provider: activeProvider,
                model: activeModel,
                response_format: null,
              },
            );
            const parsedBrainstorm = parseOrRepairJSON(brainstormText, keyword);
            trustedSources = Array.isArray(parsedBrainstorm)
              ? parsedBrainstorm
              : [parsedBrainstorm];
          } catch (error) {
            console.error(
              `[${keyword}] ❌ Brainstorm query failed:`,
              error.message,
            );
          }

          let primaryEvidenceContent = "";
          let primarySourceUrls = [];
          if (trustedSources.length > 0) {
            try {
              const topQuery = trustedSources[0];
              const primarySerperData = {
                q: topQuery,
                num: 3,
                ...(searchLocation
                  ? { gl: searchLocation.gl, location: searchLocation.location }
                  : {}),
              };
              const primarySerper = await axios({
                method: "post",
                url: "https://google.serper.dev/search",
                headers: {
                  "X-API-KEY": process.env.SERPER_API_KEY,
                  "Content-Type": "application/json",
                },
                data: primarySerperData,
                timeout: 30000,
              });
              const primaryItems = primarySerper.data?.organic || [];
              // Exclude .pdf for now to avoid robust binary parsing breaks, stick to HTML articles
              primarySourceUrls = primaryItems
                .filter(
                  (item) =>
                    item.link && !item.link.toLowerCase().endsWith(".pdf"),
                )
                .slice(0, 2)
                .map((i) => i.link);
              console.log("primarySourceUrls", primarySourceUrls);
            } catch (e) {
              console.error(
                `[${keyword}] ❌ Primary Serper search error:`,
                e.message,
              );
            }
          }

          if (primarySourceUrls.length > 0) {
            for (let i = 0; i < primarySourceUrls.length; i++) {
              const pUrl = primarySourceUrls[i];
              try {
                await jobPage.goto(pUrl, { waitUntil: "load", timeout: 20000 });
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
            let compHtml = "";

            try {
              await jobPage.goto(compUrl, {
                waitUntil: "load",
                timeout: 30000,
              });
              await jobPage.waitForTimeout(2000);
              const title = await jobPage.title();
              if (
                title.toLowerCase().includes("just a moment") ||
                title.toLowerCase().includes("attention required") ||
                title.toLowerCase().includes("cloudflare")
              ) {
                throw new Error("Bot verification (Cloudflare) detected");
              }
              compHtml = await jobPage.content();
            } catch (e) {
              try {
                const zyteResponse = await axios({
                  method: "post",
                  url: "https://api.zyte.com/v1/extract",
                  auth: { username: process.env.ZYTE_API_KEY, password: "" },
                  data: { url: compUrl, browserHtml: true },
                  headers: { "Accept-Encoding": "gzip" },
                  timeout: 60000,
                });
                if (zyteResponse.data?.browserHtml) {
                  compHtml = zyteResponse.data.browserHtml;
                }
              } catch (fallbackError) {
                console.error(
                  `[${keyword}] ❌ Scrape failed for ${compUrl}:`,
                  fallbackError.message,
                );
              }
            }

            if (compHtml) {
              const seoData = extractSEOData(compHtml);
              allCompetitorContent += `\n--- Industry Reference Data Document ${i + 1} ---\n${seoData}\n`;
            }
          }

          // 3. AI Generation
          const {
            prompt: selectedPrompt,
            promptName,
            promptIndex,
          } = selectPromptForReport({
            prefix,
            keyword,
            allCompetitorContent,
            primaryEvidenceContent,
            customSegments,
            activeOtherPublishersCount: already_published_count,
          });

          if (isNewPublisher(prefix)) {
            console.log(
              `   [${keyword}] 📝 Assigned ${promptName} (Variation #${promptIndex})`,
            );
          }

          let insights;
          try {
            console.log(
              `   [${keyword}] 🤖 Requesting report from ${activeProvider} (${activeModel})...`,
            );
            const { text, usage, finishReason } = await callAI(
              selectedPrompt,
              {
                provider: activeProvider,
                model: activeModel,
              },
            );

            if (finishReason === "length") {
              console.warn(
                `   [${keyword}] ⚠️ ${activeProvider} reached max_tokens limit (8192). JSON might be truncated.`,
              );
            }

            insights = parseOrRepairJSON(text, keyword);

            if (insights.data?.marketSize) {
              insights.data.marketSize = normalizeMarketSize(
                insights.data.marketSize,
              );
            }

            const methodologyHtml = makeLinksNofollow(
              converter.makeHtml(insights.methodology || ""),
            );
            const finalMethodology = {
              methodology_content: methodologyHtml,
              chart_data_companies: insights.chart_data_companies || [],
              chart_data_stakeholders: insights.chart_data_stakeholders || [],
            };

            // 4. Generate and Upload Valuation Banner Image
            let imageR2Key = null;
            const bannerPage = await context.newPage();
            try {
              const bannerConfig = buildBannerData({
                prefix: prefix,
                marketKeyword: marketKeyword || report.markeKeyword,
                title: insights.metadata?.title,
                cagr: insights.data?.cagr,
                marketSize: insights.data?.marketSize,
                baseYear: insights.data?.baseYear,
                drivers: insights.data?.drivers || insights.drivers,
                restraints:
                  insights.data?.restraints ||
                  insights.data?.restrains ||
                  insights.restraints ||
                  insights.restrains,
              });

              const bannerResult = await generateBannerScreenshot({
                page: bannerPage,
                bannerData: bannerConfig,
              });

              if (bannerResult?.buffer) {
                const imageKey = `${prefix}/images/en/${id}.png`;
                const imageUpload = await updateR2Content(
                  imageKey,
                  bannerResult.buffer,
                  "image/png",
                  "image",
                );
                if (imageUpload.success) {
                  imageR2Key = imageKey;
                } else {
                  console.error(
                    `[${keyword}] ❌ Banner R2 upload failed:`,
                    imageUpload.error,
                  );
                }
              }
            } catch (bannerErr) {
              console.error(
                `[${keyword}] ❌ Banner generation failed:`,
                bannerErr.message,
              );
            } finally {
              await bannerPage.close().catch(() => {});
            }

            // Save to Cloudflare R2
            const sanitizedRdContent = sanitizeRdContent(
              insights.rd_content || "",
            );
            const rawRdHtml = converter.makeHtml(sanitizedRdContent);
            const rdHtml = makeLinksNofollow(rawRdHtml);
            if (isNewPublisher(prefix)) {
              // 1. Build Chart Data
              const { marketValue, unit } = getUnitValue(
                insights.data?.marketSize,
              );
              const chart = buildMarketSizeInMillions({
                cagr: insights.data?.cagr,
                current_size: marketValue,
                current_year: insights.data?.baseYear,
                current_unit: unit || "million",
                market_size_series:
                  insights.data?.market_size_series ||
                  insights.market_size_series,
              });

              const chartData = {
                market_size: chart,
              };

              const regional_market_share =
                insights.regional_market_share ||
                insights.data?.regional_market_share ||
                null;
              if (
                regional_market_share &&
                typeof regional_market_share === "object" &&
                !Array.isArray(regional_market_share)
              ) {
                const entries = Object.entries(regional_market_share);
                if (entries.length > 0) {
                  const sum = entries.reduce(
                    (acc, [, v]) => acc + (parseFloat(v) || 0),
                    0,
                  );
                  const cleaned = {};
                  for (const [rName, rVal] of entries) {
                    const num = parseFloat(rVal) || 0;
                    cleaned[rName] =
                      sum > 1.5
                        ? Math.round((num / sum) * 100) / 100
                        : Math.round(num * 100) / 100;
                  }
                  chartData.regional_market_share = cleaned;
                }
              }

              // 2. Build Single JSON bundle for R2 in "rd-content" bucket
              const r2Bundle = {
                rd: {
                  content: rdHtml,
                  chart: chartData,
                },
                methodology: {
                  methodology_content: finalMethodology.methodology_content,
                  chart_data_companies: finalMethodology.chart_data_companies,
                  chart_data_stakeholders:
                    finalMethodology.chart_data_stakeholders,
                },
                faq: insights.faq || [],
                dynamics: {
                  drivers: insights.data?.drivers || [],
                  trends: insights.data?.trends || [],
                  restrains: insights.data?.restraints || [],
                  restraints: insights.data?.restraints || [],
                  challenges: insights.data?.challenges || [],
                },
                developments: insights.data?.developments || [],
              };

              const bundleKey = `rd-content/${prefix}/en/${id}.json`;
              const bundleJson = JSON.stringify(r2Bundle, null, 2);

              const uploadResult = await updateR2Content(
                bundleKey,
                bundleJson,
                "application/json",
                "rd-content",
              );

              if (uploadResult.success) {
                console.log(
                  `✅ [${keyword}] Published JSON bundle to R2 "rd-content": ${bundleKey}`,
                );
              } else {
                console.error(
                  `[${keyword}] ❌ R2 bundle upload failed:`,
                  uploadResult.error,
                );
              }

              const summaryLog = {
                prefix: prefix,
                id: id,
                active,
                marketKeyword: keyword,
                categoryId: categoryId,
                meta_title: insights.metadata?.title,
                meta_description: insights.metadata?.meta_description,
                ...(insights.data || {}),
                content_key: bundleKey,
                image_r2_key: imageR2Key,
                price: {
                  singlePrice: "2900.00",
                  multiPrice: "4350.00",
                  enterprisePrice: "5800.00",
                },
                noOfPages: Math.floor(Math.random() * (280 - 180 + 1)) + 180,
                noOfpages: Math.floor(Math.random() * (280 - 180 + 1)) + 180,
                regional_market_share: regional_market_share,
              };

              await updateReport(summaryLog);
            } else {
              const rdKey = `rd/${prefix}/en/${id}.html`;
              const rmKey = `methodology/${prefix}/en/${id}.json`;

              const rdUpload = await updateR2Rd(rdKey, rdHtml, "text/html");
              const rmUpload = await updateR2Asset(
                rmKey,
                JSON.stringify(finalMethodology, null, 2),
                "application/json",
              );

              if (rdUpload.success && rmUpload.success) {
                console.log(`✅ [${keyword}] Published successfully.`);
              } else {
                console.error(
                  `[${keyword}] ❌ R2 upload failed:`,
                  rdUpload.error || rmUpload.error,
                );
              }

              const rawDrivers =
                insights.data?.drivers || insights.drivers || [];
              const rawTrends =
                insights.data?.trends || insights.trends || [];
              const rawRestraints =
                insights.data?.restraints ||
                insights.data?.restrains ||
                insights.restraints ||
                insights.restrains ||
                [];
              const rawChallenges =
                insights.data?.challenges || insights.challenges || [];
              const rawCompanies =
                insights.data?.companies || insights.companies || [];
              const rawDevelopments =
                insights.data?.developments || insights.developments || [];

              const summaryLog = {
                prefix: prefix,
                id: id,
                active,
                marketKeyword: marketKeyword,
                categoryId: categoryId,
                meta_title: insights.metadata?.title,
                meta_description: insights.metadata?.meta_description,
                ...(insights.data || {}),
                drivers: rawDrivers,
                trends: rawTrends,
                restraints: rawRestraints,
                restrains: rawRestraints,
                challenges: rawChallenges,
                companies: rawCompanies,
                developments: rawDevelopments,
                faq: insights.faq || [],
                rd_r2_key: rdKey,
                rm_r2_key: rmKey,
                image_r2_key: imageR2Key,
                regional_market_share:
                  insights.regional_market_share ||
                  insights.data?.regional_market_share ||
                  null,
              };

              await updateReport(summaryLog);
            }

            if (usage) {
              console.log(
                `   [${keyword}] Tokens: ${usage.totalTokenCount} (in: ${usage.promptTokenCount}, out: ${usage.candidatesTokenCount})`,
              );
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
        reports.map((report, index) =>
          limiter(() => processReport(report, index)),
        ),
      );
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  } catch (err) {
    console.error("Error executing query:", err.stack);
    throw err;
  }
}

// Run the check when this script is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));

  const targetPrefix = positional[0] || "dim";
  const targetLimit = parseInt(positional[1], 10) || 1;
  const targetId = positional[2]
    ? parseInt(positional[2], 10) || positional[2]
    : null;
  let targetSegments = null;
  if (positional[3]) {
    try {
      targetSegments = JSON.parse(positional[3]);
    } catch (e) {
      targetSegments = [positional[3]];
    }
  }

  const providerFlag = flags
    .find((arg) => arg.startsWith("--provider="))
    ?.split("=")[1];
  const modelFlag = flags
    .find((arg) => arg.startsWith("--model="))
    ?.split("=")[1];
  const isFlagOpenRouter = flags.includes("--openrouter");
  const cliProvider =
    providerFlag ||
    (isFlagOpenRouter ? "openrouter" : positional[4] || null);

  publishNewReport(targetPrefix, targetLimit, targetId, targetSegments, {
    provider: cliProvider,
    model: modelFlag,
  })
    .then(() => {
      console.log(
        `🏁 Execution finished for prefix: ${targetPrefix} (limit: ${targetLimit}${targetId ? `, id: ${targetId}` : ""})`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Execution failed:", err);
      process.exit(1);
    })
    .finally(() => {
      pool.end();
    });
}
