import dotenv from "dotenv";
import fs from "fs";
import { google } from "googleapis";
import pLimit from "p-limit";
import path from "path";
import { fileURLToPath } from "url";
import { callOpenRouter } from "./ai_calls.js";
import pool from "./db.js";

dotenv.config();

// ── Publisher Configuration ──────────────────────────────────────────────────
export const PUBLISHER_SITES = [
  // --- Old / Legacy Publishers ---
  {
    domain: "archivemarketresearch.com",
    siteUrl: "sc-domain:archivemarketresearch.com",
    publisherCode: "amr",
    type: "old",
  },
  {
    domain: "datainsightsmarket.com",
    siteUrl: "sc-domain:datainsightsmarket.com",
    publisherCode: "dim",
    type: "old",
  },
  {
    domain: "promarketreports.com",
    siteUrl: "sc-domain:promarketreports.com",
    publisherCode: "pmr",
    type: "old",
  },
  {
    domain: "marketreportanalytics.com",
    siteUrl: "sc-domain:marketreportanalytics.com",
    publisherCode: "mra",
    type: "old",
  },
  {
    domain: "datainsightsreports.com",
    siteUrl: "sc-domain:datainsightsreports.com",
    publisherCode: "dir",
    type: "old",
  },
  {
    domain: "marketlensiq.com",
    siteUrl: "sc-domain:marketlensiq.com",
    publisherCode: "miq",
    type: "old",
  },
  {
    domain: "sectordatainsights.com",
    siteUrl: "sc-domain:sectordatainsights.com",
    publisherCode: "sdi",
    type: "old",
  },
  {
    domain: "marketdatapulse.com",
    siteUrl: "sc-domain:marketdatapulse.com",
    publisherCode: "mpu",
    type: "old",
  },
  {
    domain: "industrydatainsights.com",
    siteUrl: "sc-domain:industrydatainsights.com",
    publisherCode: "idi",
    type: "old",
  },
  {
    domain: "researchinsighthub.com",
    siteUrl: "sc-domain:researchinsighthub.com",
    publisherCode: "rih",
    type: "old",
  },

  // --- New Publishers ---
  {
    domain: "insightmarketdata.com",
    siteUrl: "sc-domain:insightmarketdata.com",
    publisherCode: "imd",
    type: "new",
  },
  {
    domain: "industryresearchanalytics.com",
    siteUrl: "sc-domain:industryresearchanalytics.com",
    publisherCode: "ira",
    type: "new",
  },
];

// ── Google Search Console Auth ───────────────────────────────────────────────
async function getGscService() {
  const credentialsPath = path.resolve(
    process.env.GSC_CLIENT_SECRET_FILE || "credentials.json",
  );
  const tokenPath = path.resolve("token.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`GSC credentials file not found at ${credentialsPath}`);
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`GSC token.json file not found at ${tokenPath}`);
  }

  const credString = fs.readFileSync(credentialsPath, "utf8");
  const credentials = JSON.parse(credString);
  const { client_secret, client_id, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : "http://localhost:3000",
  );

  const tokenString = fs.readFileSync(tokenPath, "utf8");
  const token = JSON.parse(tokenString);
  oAuth2Client.setCredentials(token);

  // Refresh access token if expired
  await oAuth2Client.getAccessToken();

  return google.searchconsole({ version: "v1", auth: oAuth2Client });
}

// ── Fetch Raw GSC Queries ────────────────────────────────────────────────────
async function fetchGscData(service, siteUrl, days = 30) {
  // GSC has a 2-3 day processing lag for search data.
  // Setting endDate to 2 days ago targets the most recent available date window.
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 2);

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - Math.max(1, days) + 1);

  const formatDate = (date) => date.toISOString().split("T")[0];

  const body = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    dimensions: ["query", "page"],
    dataState: "all",
    rowLimit: 5000,
    startRow: 0,
  };

  console.log(`   📅 Date range: ${body.startDate} to ${body.endDate} (${days} day${days > 1 ? "s" : ""})`);

  const response = await service.searchanalytics.query({
    siteUrl,
    requestBody: body,
  });

  return response.data.rows || [];
}

// ── Fetch Category Slugs by Publisher ────────────────────────────────────────
async function fetchCategories(publisher) {
  if (publisher.type === "new") {
    const res = await pool.query(
      `
      SELECT c.label, c.slug 
      FROM "category" c 
      JOIN "publisher" p ON c."publisherId" = p.id 
      WHERE p.code = $1 
      ORDER BY c.label ASC
      `,
      [publisher.publisherCode],
    );
    return res.rows;
  } else {
    const res = await pool.query(
      `
      SELECT label, link AS slug 
      FROM "categories" 
      WHERE prefix = $1 
      ORDER BY label ASC
      `,
      [publisher.publisherCode],
    );
    return res.rows;
  }
}

// ── Check Existing Keywords in DB (Batch Exclusion) ─────────────────────────
async function filterOutExistingKeywords(candidateQueries, publisher) {
  if (candidateQueries.length === 0) return [];

  const lowerQueries = candidateQueries.map((q) =>
    q.keyword.trim().toLowerCase(),
  );

  // 1. Check already in GSCKeywords for this publisher
  const gscRes = await pool.query(
    `
    SELECT LOWER(market_keyword) AS kw 
    FROM "GSCKeywords" 
    WHERE publisher_code = $1 
      AND LOWER(market_keyword) = ANY($2)
    `,
    [publisher.publisherCode, lowerQueries],
  );
  const existingSet = new Set(gscRes.rows.map((r) => r.kw));

  // 2. Check already in report table
  if (publisher.type === "new") {
    const reportRes = await pool.query(
      `
      SELECT LOWER("marketKeyword") AS kw 
      FROM "report" 
      WHERE publisher_code = $1 
        AND LOWER("marketKeyword") = ANY($2)
      `,
      [publisher.publisherCode, lowerQueries],
    );
    reportRes.rows.forEach((r) => existingSet.add(r.kw));
  } else {
    const chunkSize = 500;
    for (let i = 0; i < lowerQueries.length; i += chunkSize) {
      const slice = lowerQueries.slice(i, i + chunkSize);
      const reportRes = await pool.query(
        `
        SELECT LOWER("marketKeyword") AS kw 
        FROM "${publisher.publisherCode}_report" 
        WHERE LOWER("marketKeyword") = ANY($1)
        `,
        [slice],
      );
      reportRes.rows.forEach((r) => existingSet.add(r.kw));
    }
  }

  return candidateQueries.filter(
    (c) => !existingSet.has(c.keyword.trim().toLowerCase()),
  );
}

// ── Post-process and Normalize Keyword Casing ──────────────────────────────
function formatMarketKeyword(keyword) {
  if (!keyword) return "";
  let formatted = keyword.trim();

  // Ensure country codes, regions, and standard industry acronyms are strictly uppercase
  const uppercaseWords = [
    "US", "UK", "USA", "UAE", "EU", "APAC", "GCC", "MENA", "LATAM", "KSA", "ASEAN",
    "MRO", "EV", "PLC", "LAN", "AI", "SAML", "HSS", "FMCG", "B2B", "3PL", "GPS", "IoT", "RFID"
  ];

  for (const word of uppercaseWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    formatted = formatted.replace(regex, word);
  }

  return formatted;
}

// ── Streamlined AI Evaluation with OpenRouter DeepSeek ──────────────────────
async function evaluateKeywordsWithAI(batch, categorySlugs) {
  const prompt = `You are a B2B Market Research Analyst.
Filter and classify search queries ranking on our market research website into valid syndicated market research report titles.

Allowed Category Slugs:
${JSON.stringify(categorySlugs)}

Input Queries with landing page:
${JSON.stringify(batch, null, 2)}

Instructions:
1. Include ONLY queries that represent a viable B2B commercial market research report keyword (e.g., "Abemaciclib Market", "Japan Diabetic Retinopathy Market").
2. Exclude navigational noise ("careers", "contact us", "login"), search syntax/operators, and generic informational questions.
3. For each valid market keyword:
   - Convert into Title Case (e.g., "Tall Oil Fatty Acid Market").
   - Country codes, country names, and regional acronyms MUST be fully uppercase: write "US" (NOT "Us"), "UK" (NOT "Uk"), "USA", "UAE", "EU", "APAC", "GCC", "MENA", "LATAM", "KSA". Example: "US Tall Oil Fatty Acid Market", "UK Banking As A Service Market".
   - Common industry acronyms must also be uppercase where appropriate (e.g., "MRO", "EV", "PLC", "LAN", "AI", "SAML", "HSS", "FMCG").
   - Assign the single best matching category_slug from Allowed Category Slugs.
4. Output strictly a JSON array of valid objects:
[
  {
    "market_keyword": "Standardized Title Case Market Keyword",
    "category_slug": "exact-matching-category-slug"
  }
]`;

  const response = await callOpenRouter(prompt, "deepseek/deepseek-chat", {
    temperature: 0.1,
    max_tokens: 4096,
  });

  let parsed = [];
  try {
    let cleanText = response.text.trim();
    if (cleanText.startsWith("```json")) {
      cleanText = cleanText
        .replace(/^```json/, "")
        .replace(/```$/, "")
        .trim();
    } else if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```/, "").replace(/```$/, "").trim();
    }
    parsed = JSON.parse(cleanText);
    if (!Array.isArray(parsed) && parsed.results) {
      parsed = parsed.results;
    }
  } catch (err) {
    console.error("⚠️ Failed to parse AI JSON response:", response.text);
    return [];
  }

  const validCategorySlugs = new Set(categorySlugs);
  return (parsed || [])
    .filter(
      (item) => item.market_keyword && validCategorySlugs.has(item.category_slug),
    )
    .map((item) => ({
      ...item,
      market_keyword: formatMarketKeyword(item.market_keyword),
    }));
}

// ── Insert Keywords into GSCKeywords ─────────────────────────────────────────
async function insertKeywordsToDb(keywords, publisherCode, dryRun = false) {
  let insertedCount = 0;

  for (const item of keywords) {
    if (dryRun) {
      console.log(
        `   [DRY RUN] Would insert: "${item.market_keyword}" | Category: ${item.category_slug} | Publisher: ${publisherCode}`,
      );
      insertedCount++;
      continue;
    }

    try {
      const res = await pool.query(
        `
        INSERT INTO "GSCKeywords" (
          "market_keyword",
          "publisher_code",
          "category_slug",
          "status",
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, 'pending', NOW(), NOW())
        ON CONFLICT ("market_keyword", "publisher_code") DO NOTHING
        RETURNING id
        `,
        [item.market_keyword, publisherCode, item.category_slug],
      );

      if (res.rowCount > 0) {
        insertedCount++;
      }
    } catch (err) {
      console.error(
        `⚠️ Error inserting keyword "${item.market_keyword}": ${err.message}`,
      );
    }
  }

  return insertedCount;
}

// ── Process One Publisher ───────────────────────────────────────────────────
async function processPublisher(service, publisher, options) {
  console.log(`\n============================================================`);
  console.log(
    `🌐 Processing: ${publisher.domain} (${publisher.publisherCode.toUpperCase()} - ${publisher.type.toUpperCase()})`,
  );
  console.log(`   Site URL: ${publisher.siteUrl}`);
  console.log(`============================================================`);

  // 1. Fetch Categories
  console.log(`📂 Fetching categories from DB...`);
  const categories = await fetchCategories(publisher);
  const categorySlugs = categories.map((c) => c.slug);
  console.log(`✅ Loaded ${categorySlugs.length} categories.`);
  if (categorySlugs.length === 0) {
    console.warn(
      `⚠️ No categories found for publisher ${publisher.publisherCode}. Skipping.`,
    );
    return;
  }

  // 2. Fetch GSC Queries
  console.log(
    `🔍 Fetching GSC data (Lookback: ${options.days} days, Min Impressions: ${options.minImpressions})...`,
  );
  let rows = [];
  try {
    rows = await fetchGscData(service, publisher.siteUrl, options.days);
  } catch (err) {
    console.error(
      `❌ Failed to fetch GSC data for ${publisher.siteUrl}:`,
      err.message,
    );
    return;
  }

  console.log(`📊 Total GSC query-page rows returned: ${rows.length}`);
  if (rows.length === 0) {
    console.log(`ℹ️ No GSC queries found. Moving to next publisher.`);
    return;
  }

  // 3. Deduplicate
  const queryMap = new Map();
  for (const row of rows) {
    const keyword = (row.keys?.[0] || "").trim();
    const pageUrl = row.keys?.[1] || "";
    const impressions = row.impressions || 0;

    if (!keyword || keyword.length < 3) continue;
    if (impressions < options.minImpressions) continue;

    if (
      !queryMap.has(keyword) ||
      queryMap.get(keyword).impressions < impressions
    ) {
      queryMap.set(keyword, {
        keyword,
        page_url: pageUrl,
        impressions,
      });
    }
  }

  const candidateQueries = Array.from(queryMap.values()).sort(
    (a, b) => b.impressions - a.impressions,
  );
  console.log(
    `🎯 Unique candidate queries passing threshold: ${candidateQueries.length}`,
  );

  // 4. Pre-filter against DB
  console.log(
    `🔎 Checking database to exclude existing reports & GSCKeywords...`,
  );
  const unpublishedCandidates = await filterOutExistingKeywords(
    candidateQueries,
    publisher,
  );

  console.log(
    `✨ Fresh unpublished candidates: ${unpublishedCandidates.length} (Skipped ${candidateQueries.length - unpublishedCandidates.length} already in DB)`,
  );

  if (unpublishedCandidates.length === 0) {
    console.log(
      `🎉 All GSC queries are already in the database. Nothing new to add!`,
    );
    return;
  }

  // Limit if specified
  const toProcess = options.limit
    ? unpublishedCandidates.slice(0, options.limit)
    : unpublishedCandidates;

  // Split into batches
  const batches = [];
  for (let i = 0; i < toProcess.length; i += options.batchSize) {
    batches.push(toProcess.slice(i, i + options.batchSize));
  }

  console.log(
    `🤖 Sending ${toProcess.length} candidate queries to OpenRouter DeepSeek in ${batches.length} batch(es) of ~${options.batchSize} (Concurrency: ${options.concurrency})...`,
  );

  const limit = pLimit(options.concurrency);
  const approvedKeywords = [];

  const batchPromises = batches.map((batch, index) =>
    limit(async () => {
      const batchNum = index + 1;
      console.log(
        `   ⏳ Evaluating batch ${batchNum}/${batches.length} (${batch.length} queries)...`,
      );
      try {
        const validItems = await evaluateKeywordsWithAI(batch, categorySlugs);
        console.log(
          `      ✓ Approved ${validItems.length} valid market keywords in batch ${batchNum}`,
        );
        approvedKeywords.push(...validItems);
      } catch (err) {
        console.error(`      ❌ Batch ${batchNum} AI error:`, err.message);
      }
    }),
  );

  await Promise.all(batchPromises);

  console.log(
    `\n📋 AI Approval Summary: ${approvedKeywords.length} valid market keywords identified out of ${toProcess.length} candidates.`,
  );

  // 5. Insert into GSCKeywords
  console.log(
    `💾 Storing approved keywords into "GSCKeywords" table${options.dryRun ? " [DRY RUN]" : ""}...`,
  );
  const inserted = await insertKeywordsToDb(
    approvedKeywords,
    publisher.publisherCode,
    options.dryRun,
  );

  console.log(`\n✅ Finished ${publisher.domain}:`);
  console.log(`   - GSC Rows Analyzed: ${rows.length}`);
  console.log(`   - Unique Queries: ${candidateQueries.length}`);
  console.log(
    `   - Fresh Candidates (Not in DB): ${unpublishedCandidates.length}`,
  );
  console.log(`   - Approved by AI: ${approvedKeywords.length}`);
  console.log(`   - Inserted into GSCKeywords: ${inserted}`);

  if (approvedKeywords.length > 0) {
    console.log(
      `\n📌 Sample New Keywords for ${publisher.publisherCode.toUpperCase()}:`,
    );
    approvedKeywords.slice(0, 10).forEach((kw, idx) => {
      console.log(
        `   ${idx + 1}. "${kw.market_keyword}" -> Category: [${kw.category_slug}]`,
      );
    });
  }
}

// ── Main Entrypoint ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const publisherArg = args
    .find((a) => a.startsWith("--publisher="))
    ?.split("=")[1];
  const daysArg =
    parseInt(args.find((a) => a.startsWith("--days="))?.split("=")[1], 10) || 1;
  const minImpArg =
    parseInt(
      args.find((a) => a.startsWith("--min-impressions="))?.split("=")[1],
      10,
    ) || 1;
  const limitArg =
    parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1], 10) ||
    null;
  const batchSizeArg =
    parseInt(
      args.find((a) => a.startsWith("--batch-size="))?.split("=")[1],
      10,
    ) || 100;
  const concurrencyArg =
    parseInt(
      args.find((a) => a.startsWith("--concurrency="))?.split("=")[1],
      10,
    ) || 3;

  const options = {
    dryRun,
    days: daysArg,
    minImpressions: minImpArg,
    limit: limitArg,
    batchSize: batchSizeArg,
    concurrency: concurrencyArg,
  };

  console.log(`🚀 Starting GSC Keyword Harvester`);
  console.log(`⚙️  Options:`, options);

  const service = await getGscService();

  const targets = publisherArg
    ? PUBLISHER_SITES.filter(
        (p) =>
          p.publisherCode.toLowerCase() === publisherArg.toLowerCase() ||
          p.domain.toLowerCase().includes(publisherArg.toLowerCase()),
      )
    : PUBLISHER_SITES;

  if (targets.length === 0) {
    console.error(
      `❌ No matching publisher found for argument: ${publisherArg}`,
    );
    process.exit(1);
  }

  for (const publisher of targets) {
    await processPublisher(service, publisher, options);
  }

  console.log(`\n🎉 All publishers processed successfully.`);
  await pool.end();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌ Fatal Error:", err);
    pool.end();
    process.exit(1);
  });
}
