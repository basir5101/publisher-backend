import axios from "axios";
import { isNewPublisher } from "./constants.js";
import pool from "./db.js";

// Simple db call for checking payment_gateway table
export async function findInactiveMarketKeywords(prefix, limit = 1, id = null) {
  const reportTable = `${prefix}_report`;
  try {
    console.log("Connecting to PostgreSQL...");

    let result = [];

    if (id) {
      if (isNewPublisher(prefix)) {
        result = await pool.query(
          `
          SELECT 
            r.id, 
            r.active, 
            r."marketKeyword", 
            r.slug, 
            r."content_key", 
            r."categoryId",
            r."keyword_data_Id",
            COALESCE((
              SELECT COUNT(DISTINCT r2.publisher_code)
              FROM "report" r2
              WHERE (
                (r."keyword_data_Id" IS NOT NULL AND r2."keyword_data_Id" = r."keyword_data_Id")
                OR r2."marketKeyword" = r."marketKeyword"
              )
              AND r2.active = true
              AND r2.publisher_code != r.publisher_code
            ), 0)::int AS already_published_count,
            COALESCE((
              SELECT ARRAY_AGG(DISTINCT r2.publisher_code)
              FROM "report" r2
              WHERE (
                (r."keyword_data_Id" IS NOT NULL AND r2."keyword_data_Id" = r."keyword_data_Id")
                OR r2."marketKeyword" = r."marketKeyword"
              )
              AND r2.active = true
              AND r2.publisher_code != r.publisher_code
            ), ARRAY[]::text[]) AS published_publishers
          FROM "report" r
          WHERE r."publisher_code" = $1 AND r.id = $2
            AND NOT EXISTS (
              SELECT 1
              FROM "report" r2
              WHERE (
                (r."keyword_data_Id" IS NOT NULL AND r2."keyword_data_Id" = r."keyword_data_Id")
                OR r2."marketKeyword" = r."marketKeyword"
              )
              AND r2.publisher_code != r.publisher_code
              AND r2.active = true
              AND r2."publishedAt" >= NOW() - INTERVAL '15 days'
            )
          LIMIT 1;
        `,
          [prefix, id],
        );
      } else {
        result = await pool.query(
          `
          SELECT 
            id, 
            active, 
            "marketKeyword", 
            "categoryId"
          FROM "${reportTable}"
          WHERE id = $1
          LIMIT 1;
        `,
          [id],
        );
      }
    } else if (isNewPublisher(prefix)) {
      result = await pool.query(
        `
    WITH PendingReports AS (
      SELECT 
        r.id, 
        r.active,
        r."marketKeyword",
        r.slug,
        r."content_key",
        r."categoryId",
        r."publisher_code",
        r."keyword_data_Id",
        ROW_NUMBER() OVER (PARTITION BY r."categoryId" ORDER BY RANDOM()) AS rn
      FROM "report" r
      WHERE r."publisher_code" = $1
        AND r.active = false
        AND NOT EXISTS (
          SELECT 1
          FROM "report" r2
          WHERE (
            (r."keyword_data_Id" IS NOT NULL AND r2."keyword_data_Id" = r."keyword_data_Id")
            OR r2."marketKeyword" = r."marketKeyword"
          )
          AND r2.publisher_code != r.publisher_code
          AND r2.active = true
          AND r2."publishedAt" >= NOW() - INTERVAL '15 days'
        )
    )
    SELECT 
      r.id, 
      r.active, 
      r."marketKeyword", 
      r.slug, 
      r."content_key", 
      r."categoryId",
      r."keyword_data_Id",
      COALESCE((
        SELECT COUNT(DISTINCT r2.publisher_code)
        FROM "report" r2
        WHERE (
          (r."keyword_data_Id" IS NOT NULL AND r2."keyword_data_Id" = r."keyword_data_Id")
          OR r2."marketKeyword" = r."marketKeyword"
        )
        AND r2.active = true
        AND r2.publisher_code != r.publisher_code
      ), 0)::int AS already_published_count,
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT r2.publisher_code)
        FROM "report" r2
        WHERE (
          (r."keyword_data_Id" IS NOT NULL AND r2."keyword_data_Id" = r."keyword_data_Id")
          OR r2."marketKeyword" = r."marketKeyword"
        )
        AND r2.active = true
        AND r2.publisher_code != r.publisher_code
      ), ARRAY[]::text[]) AS published_publishers
    FROM PendingReports r
    ORDER BY rn ASC, RANDOM()
    LIMIT $2;
  `,
        [prefix, limit],
      );
    } else if (["dim", "amr", "mra", "pmr"].includes(prefix)) {
      result = await pool.query(
        `
            WITH PendingReports AS (
                SELECT 
                    id, 
                    active,
                    "marketKeyword",
                    "categoryId",
                    ROW_NUMBER() OVER (PARTITION BY "categoryId" ORDER BY RANDOM()) AS rn
                FROM "${reportTable}"
                WHERE active = true
                    AND "updatedAt" < '2026-09-13T00:00:00Z'::timestamp
                    AND "seoengine" = false
            )
            SELECT 
                id, 
                active,
                "marketKeyword"
            FROM PendingReports
            ORDER BY rn ASC, RANDOM()
            LIMIT $1;
        `,
        [limit],
      );
    } else {
      result = await pool.query(
        `
            WITH PendingReports AS (
                SELECT 
                    id, 
                    active,
                    "marketKeyword",
                    "categoryId",
                    ROW_NUMBER() OVER (PARTITION BY "categoryId" ORDER BY RANDOM()) AS rn
                FROM "${reportTable}"
                WHERE active = false
            )
            SELECT 
                id, 
                active,
                "marketKeyword"
            FROM PendingReports
            ORDER BY rn ASC, RANDOM()
            LIMIT $1;
        `,
        [limit],
      );
    }

    console.log(
      `Successfully queried ${reportTable} table. Found ${result.rowCount} rows.`,
    );
    // log the ids
    console.log(
      "reports",
      result.rows.map((r) => r?.id),
      "prefix",
      prefix,
    );
    // Fix: Return just the rows array for easier handling later
    return result.rows;
  } catch (err) {
    // Fix: Log the full error stack for better troubleshooting
    console.error("Error executing query:", err.stack);
    throw err;
  }
}

export function getUnitValue(str) {
  if (!str) return { marketValue: 0, unit: "Million" };

  // Strip currency symbols and common currency ticker abbreviations
  let cleaned = String(str)
    .replace(/[$€£¥]/g, "")
    .replace(/\b(?:USD|EUR|GBP|INR|CAD|AUD)\b/gi, "")
    .trim();

  // Handle shorthand like "450M", "1.2B", "1.2T", "500k"
  const shorthandMatch = cleaned.match(/^([\d.,]+)\s*([mbtk])\b/i);
  if (shorthandMatch) {
    const val = parseFloat(shorthandMatch[1].replace(/,/g, ""));
    const code = shorthandMatch[2].toLowerCase();
    const unitMap = {
      m: "Million",
      b: "Billion",
      t: "Trillion",
      k: "Thousand",
    };
    let marketValue = isNaN(val) ? 0 : val;
    let unit = unitMap[code] || "Million";
    if (marketValue >= 1000 && unit === "Million") {
      marketValue = Number((marketValue / 1000).toFixed(2));
      unit = "Billion";
    }
    return { marketValue, unit };
  }

  // Handle standard "454 Million", "20.97 Billion" or raw numbers "454"
  const match = cleaned.match(/^([\d.,]+)\s*([a-zA-Z]+)?/);
  if (match) {
    let marketValue = parseFloat(match[1].replace(/,/g, ""));
    let unit = (match[2] || "").trim();

    if (isNaN(marketValue)) {
      return { marketValue: 0, unit: "Million" };
    }

    if (!unit) {
      if (marketValue >= 1e9) {
        marketValue = Number((marketValue / 1e9).toFixed(2));
        unit = "Billion";
      } else if (marketValue >= 1e6) {
        marketValue = Number((marketValue / 1e6).toFixed(2));
        unit = "Million";
      } else {
        unit = "Million";
      }
    } else {
      const lower = unit.toLowerCase();
      if (lower.startsWith("trill")) unit = "Trillion";
      else if (lower.startsWith("bill")) unit = "Billion";
      else if (lower.startsWith("mill")) unit = "Million";
      else unit = "Million";
    }

    if (marketValue >= 1000 && unit === "Million") {
      marketValue = Number((marketValue / 1000).toFixed(2));
      unit = "Billion";
    }

    return { marketValue, unit };
  }
  return { marketValue: 0, unit: "Million" };
}

function parseNestedString(input) {
  if (!input || typeof input !== "string") return [];

  // Clean up wrapping quotes or prefixes like "regions: '"
  let cleaned = input.replace(/^(?:regions|segments):\s*['"]?/gi, "").replace(/['"]/g, "").trim();

  // Defensive fallback: If accidentally wrapped in "Global(...)", unwrap it so continents/regions become the parent categories
  const globalWrapMatch = cleaned.match(/^global\s*\(([\s\S]+)\)$/i);
  if (globalWrapMatch) {
    cleaned = globalWrapMatch[1].trim();
  }

  const categories = [];
  let depth = 0;
  let categoryName = "";
  let content = "";

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (char === "(") {
      if (depth === 0) {
        // We found the opening bracket for a category
        categoryName = categoryName.trim().replace(/^,\s*/, "");
      } else {
        // Inner parenthesis (e.g., "(STS)" or "(IMDG)")
        content += char;
      }
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        // We reached the matching closing bracket for the category
        const subItems = splitSubItems(content).map((item) => ({
          name: item.trim(),
        }));

        if (categoryName) {
          // Remove "By " (case-insensitive) from the start of the category name
          const formattedCategoryName = categoryName
            .trim()
            .replace(/^by\s+/i, "");

          categories.push({
            name: formattedCategoryName,
            sub_items: subItems,
          });
        }

        categoryName = "";
        content = "";
      } else {
        content += char;
      }
    } else {
      if (depth === 0) {
        categoryName += char;
      } else {
        content += char;
      }
    }
  }

  return categories;
}

// Split items on commas, ignoring commas inside nested parentheses
function splitSubItems(str) {
  const items = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === "(") depth++;
    if (char === ")") depth--;

    if (char === "," && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

export function formatParentSegmentsOrRegions(input) {
  if (!input) return [];

  const items = Array.isArray(input) ? input : [input];
  const result = [];

  for (const item of items) {
    if (typeof item !== "string") continue;

    // Clean up wrapping quotes, prefixes like "regions: '" or brackets
    const cleaned = item
      .replace(/^(?:regions|segments):\s*['"]?/gi, "")
      .replace(/^\[|\]$/g, "")
      .replace(/^['"]|['"]$/g, "")
      .trim();

    if (!cleaned) continue;

    let depth = 0;
    let current = "";

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (char === "(") depth++;
      if (char === ")") {
        if (depth > 0) depth--;
      }

      if (char === "," && depth === 0) {
        const trimmed = current.trim().replace(/^['"]|['"]$/g, "");
        if (trimmed) result.push(trimmed);
        current = "";
      } else {
        current += char;
      }
    }

    const finalTrimmed = current.trim().replace(/^['"]|['"]$/g, "");
    if (finalTrimmed) {
      result.push(finalTrimmed);
    }
  }

  return result;
}

export const flattenSegmentsOrRegions = formatParentSegmentsOrRegions;

export async function updatePartitionedReport(summaryLog) {
  const {
    id,
    prefix,
    active,
    meta_title,
    meta_description,
    cagr,
    marketSize,
    baseYear,
    baseyear,
    volumeUnit,
    segments,
    companies,
    regions,
    content_key,
    price,
    noOfPages,
    noOfpages,
    image_r2_key,
  } = summaryLog;

  const { marketValue, unit } = getUnitValue(marketSize);

  const marketValueJson = {
    cagr: String(cagr || ""),
    marketsize: String(marketValue || ""),
    valueUnit: unit || "Million",
    volumeUnit: volumeUnit || "",
  };

  const priceJson = price || {
    singlePrice: "2900.00",
    multiPrice: "4350.00",
    enterprisePrice: "5800.00",
  };

  const calculatedPages =
    noOfPages || noOfpages || Math.floor(Math.random() * (280 - 180 + 1)) + 180;
  const calculatedBaseYear = parseInt(baseYear || baseyear, 10) || 2025;
  const finalContentKey = content_key || `rd-content/${prefix}/en/${id}.json`;

  const imagesJson = Array.isArray(summaryLog.images)
    ? summaryLog.images
    : image_r2_key
      ? [
          {
            type: "primary",
            url: image_r2_key,
          },
        ]
      : null;

  const segmentsArray = formatParentSegmentsOrRegions(segments);
  const regionsArray = formatParentSegmentsOrRegions(regions);
  const companiesArray = Array.isArray(companies)
    ? companies.map((c) => String(c).trim()).filter(Boolean)
    : typeof companies === "string"
      ? companies
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const queryText = `
      UPDATE "report"
      SET active = true,
          "updatedAt" = NOW(),
          "publishedAt" = COALESCE("publishedAt", NOW()),
          "metaTitle" = $1,
          "metaDescription" = $2,
          "marketValue" = $3::jsonb,
          "baseYear" = $4,
          price = $5::jsonb,
          "noOfPages" = $6,
          content_key = $7,
          segments = $8::text[],
          regions = $9::text[],
          companies = $10::text[],
          images = COALESCE($11::jsonb, images)
      WHERE publisher_code = $12 AND id = $13
    `;

    const values = [
      meta_title || "",
      meta_description || "",
      JSON.stringify(marketValueJson),
      calculatedBaseYear,
      JSON.stringify(priceJson),
      calculatedPages,
      finalContentKey,
      segmentsArray,
      regionsArray,
      companiesArray,
      imagesJson ? JSON.stringify(imagesJson) : null,
      prefix,
      id,
    ];

    await client.query(queryText, values);
    await client.query("COMMIT");
    console.log(
      `✅ Database successfully updated for report ID: ${id} (publisher: ${prefix}) in "report" table`,
    );
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ SQL Transaction failed for partitioned report: ", e);
    throw e;
  } finally {
    client.release();
  }

  await purgeCache(id, prefix);
  console.log("\n💡 === Generated Report AI Output ===");
}

export async function updateReport(summaryLog) {
  if (isNewPublisher(summaryLog.prefix)) {
    return await updatePartitionedReport(summaryLog);
  }
  const {
    id,
    prefix,
    active,
    meta_title,
    meta_description,
    region,
    cagr,
    marketSize,
    baseYear,
    volumeUnit,
    trends,
    restraints,
    drivers,
    challenges,
    segments,
    companies,
    developments,
    faq,
    regions,
    rd_r2_key,
    rm_r2_key,
    image_r2_key,
    regional_market_share,
  } = summaryLog;
  const tables = {
    report: `${prefix}_report`,
    analysis: `${prefix}_marketAnalysis`,
    marketReport: `${prefix}_marketReport`,
    rd: `${prefix}_rd`,
  };

  const { marketValue, unit } = getUnitValue(marketSize);

  const marketData = {
    cagr: String(cagr),
    marketSize: String(marketValue),
    baseYear: String(baseYear),
    volumeUnit,
    valueUnit: unit,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let reportQuery = `
            UPDATE "${tables.report}"
            SET active = true, 
                "updatedAt" = NOW(), 
                region = $1, 
                "marketData" = $2::jsonb, 
                baseyear = $3, 
                seoengine = $4, 
                title = $5, 
                aicharts = true, 
                aird = true, 
                summery = $6, 
                faq = $7::jsonb, 
                method_r2key = $8, 
                "method_updatedAt" = NOW()
        `;

    const reportValues = [
      region,
      JSON.stringify(marketData),
      baseYear,
      active ? true : false,
      meta_title,
      meta_description || "",
      JSON.stringify(faq),
      rm_r2_key,
    ];

    if (image_r2_key) {
      reportQuery += `, images = $${reportValues.length + 1}::jsonb`;
      reportValues.push(
        JSON.stringify([
          {
            type: "primary",
            url: image_r2_key,
          },
        ]),
      );
    }

    if (!active) {
      reportQuery += `, "publishedAt" = NOW()`;
    }

    reportQuery += ` WHERE id = $${reportValues.length + 1}`;
    reportValues.push(id);

    await client.query(reportQuery, reportValues);

    const chart = buildMarketSizeInMillions({
      cagr: cagr,
      current_size: marketValue,
      current_year: baseYear,
      current_unit: unit || "million",
      market_size_series:
        summaryLog.market_size_series ||
        summaryLog.data?.market_size_series,
    });

    const chartData = {
      market_size: chart,
    };

    // Conditionally include regional_market_share if available
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

    await client.query(
      `
            INSERT INTO "${tables.rd}" ("reportId", "r2Key", "chart", "updatedAt") 
            VALUES ($1, $2, $3, NOW()) 
            ON CONFLICT ("reportId") 
            DO UPDATE SET 
                "r2Key" = EXCLUDED."r2Key",
                "chart" = EXCLUDED."chart",
                "updatedAt" = EXCLUDED."updatedAt"
            `,
      [id, rd_r2_key, JSON.stringify(chartData)],
    );

    await client.query(
      `
            UPDATE "${tables.analysis}"
            SET developments = $1::text[],
                segments_json = $2::jsonb,
                "regionData_json" = $3::jsonb,
                companies = $4::text[]
            WHERE "reportId" = $5
        `,
      [
        developments || [],
        JSON.stringify(parseNestedString(segments)),
        JSON.stringify(parseNestedString(regions)),
        companies || [],
        id,
      ],
    );

    await client.query(
      `
            UPDATE "${tables.marketReport}"
            SET drivers = $1,
                trends = $2,
                restrains = $3
            WHERE "reportId" = $4
        `,
      [
        drivers?.toString() || "",
        trends?.toString() || "",
        restraints?.toString() || "",
        id,
      ],
    );

    await client.query("COMMIT");
    console.log(`✅ Database successfully updated for report ID: ${id}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ SQL Transaction failed: ", e);
    throw e;
  } finally {
    client.release();
  }
  // console.dir(summaryLog, { depth: null, colors: true });
  await purgeCache(id, prefix);
  console.log("\n💡 === Generated Report AI Output ===");
}

export async function purgePartitionedCache(id, prefix) {
  try {
    const repRes = await pool.query(
      `SELECT slug FROM "report" WHERE publisher_code = $1 AND id = $2;`,
      [prefix, id],
    );
    if (!repRes.rows[0]) {
      console.warn(
        `⚠️ Report record missing in "report" table for id ${id}, prefix ${prefix}`,
      );
      return null;
    }
    const { slug } = repRes.rows[0];

    const pubRes = await pool.query(
      `SELECT domain FROM publisher WHERE code = $1;`,
      [prefix],
    );
    const domainRaw = pubRes.rows[0]?.domain || "insightmarketdata.com";
    let domain = domainRaw.trim().replace(/\/+$/, "");
    if (!domain.startsWith("http://") && !domain.startsWith("https://")) {
      domain = `https://${domain}`;
    }

    console.log(
      `🧹 Purging cache for partitioned [${prefix}] ID: ${id} | ${domain}/reports/${slug}`,
    );
    console.log(`   ✅ Cache check completed for [${prefix}] ID: ${id}`);
  } catch (err) {
    console.error(
      `   ❌ Failed to purge cache for partitioned report:`,
      err.message || err,
    );
  }
}

export async function purgeCache(id, prefix) {
  if (isNewPublisher(prefix)) {
    return await purgePartitionedCache(id, prefix);
  }
  const reportTable = `${prefix}_report`;
  const result = await pool.query(
    `
            SELECT domain, config 
            FROM publishers
            WHERE prefix = $1;
        `,
    [prefix],
  );

  const reports = await pool.query(
    `
            SELECT slug 
            FROM "${reportTable}"
            WHERE id = $1;
        `,
    [id],
  );

  if (!result.rows[0] || !reports.rows[0]) {
    console.warn(
      `⚠️ Publisher or Report record missing for id ${id}, prefix ${prefix}`,
    );
    return null;
  }

  const publisher = result.rows[0];
  const { slug } = reports.rows[0];
  let domain = (publisher.domain || "").trim().replace(/\/+$/, "");
  if (!domain.startsWith("http://") && !domain.startsWith("https://")) {
    domain = `https://${domain.replace(/^https?\/\//, "")}`;
  }
  const zoneId = publisher.config?.cloudFlare?.zoneId;
  const dimZoneId = "4d1258a9e0d0c08269aadde1978f31a1";

  console.log(
    `🧹 Purging cache for [${prefix}] ID: ${id} | ${domain}/reports/${slug}`,
  );

  // =========================================================================
  // 1. CLOUDFLARE PAGE CACHING RULE PURGE — 5 canonical URLs only
  // =========================================================================
  const wwwDomain = domain.includes("www.")
    ? domain
    : domain.replace("https://", "https://www.");
  const basePath = `${wwwDomain}/reports/${slug}`;
  const pageUrlList = [
    basePath,
    `${basePath}?tab=segments`,
    `${basePath}?tab=toc`,
    `${basePath}?tab=faq`,
    `${basePath}?tab=methodology`,
  ];
  // =========================================================================
  // 2. RD CONTENT FROM CLOUDFLARE WORKER
  // =========================================================================
  const rdBaseUrl =
    process.env.R2_RD_URL || "https://rd.datainsightsmarket.com";
  const rd_worker_url = `${rdBaseUrl}/rd/${prefix}/en/${id}.html?key=${process.env.R2_RD_AUTH_KEY}`;
  const rd_clean_url = `${rdBaseUrl}/rd/${prefix}/en/${id}.html`;

  try {
    const workerRes = await axios.delete(rd_worker_url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
    });
    console.log(
      `   ✅ [2/3] RD Worker DELETE Result:`,
      workerRes.status,
      workerRes.data,
    );
  } catch (err) {
    console.error(
      `   ❌ [2/3] RD Worker DELETE Failed:`,
      err.response?.status,
      err.response?.data || err.message,
    );
  }

  // =========================================================================
  // 3. RM CONTENT FROM R2 & RD CDN PURGE
  // =========================================================================
  const rmBaseUrl =
    process.env.R2_RM_URL || "https://rm.datainsightsmarket.com";
  const rm_r2_url = `${rmBaseUrl}/methodology/${prefix}/en/${id}.json`;

  try {
    const r2PurgeRes = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${dimZoneId}/purge_cache`,
      {
        files: [rd_clean_url, rm_r2_url],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
    console.log(
      `   ✅ [3/3] RM & RD R2 CDN Cache Purge:`,
      r2PurgeRes.data.success ? "SUCCESS" : r2PurgeRes.data,
    );
  } catch (err) {
    console.error(
      `   ❌ [3/3] RM & RD R2 CDN Cache Purge Failed:`,
      err.response?.status,
      err.response?.data || err.message,
    );
  }
  try {
    const pagePurgeRes = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      { files: pageUrlList },
      {
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
    console.log(
      `   ✅ [1/3] Page Cache Purge (${pageUrlList.length} URLs):`,
      pagePurgeRes.data.success ? "SUCCESS" : pagePurgeRes.data,
    );
  } catch (err) {
    console.error(
      `   ❌ [1/3] Page Cache Purge Failed:`,
      err.response?.status,
      err.response?.data || err.message,
    );
  }

  return { domain, zoneId };
}

export function buildMarketSizeInMillions(historicalData) {
  const today = new Date();
  const currentYear = today.getFullYear();

  let {
    cagr,
    current_size,
    current_year: baseYear,
    current_unit = "million", // Default to million if empty
    market_size_series,
  } = historicalData || {};

  // 1. If market_size_series is provided as an array with valid items, use it
  if (Array.isArray(market_size_series) && market_size_series.length > 0) {
    const seriesResult = {};
    for (const item of market_size_series) {
      const year = parseInt(item.year || item.Year, 10);
      if (!isNaN(year)) {
        const { marketValue, unit } = getUnitValue(
          item.value || item.size || item.val,
        );
        if (marketValue > 0) {
          let valInMillions = marketValue;
          if (unit.toLowerCase() === "billion") valInMillions *= 1000;
          if (unit.toLowerCase() === "trillion") valInMillions *= 1000000;
          seriesResult[year] = Math.round(valInMillions);
        }
      }
    }
    if (Object.keys(seriesResult).length >= 2) {
      return seriesResult;
    }
  }

  // 2. Otherwise compute from current_size and cagr
  const cleanSize = parseFloat(String(current_size).replace(/,/g, ""));
  const cleanCagr = parseFloat(String(cagr).replace(/[%,\s]/g, ""));
  let cleanBaseYear = parseInt(String(baseYear), 10);
  if (isNaN(cleanBaseYear)) {
    cleanBaseYear = currentYear - 1;
  }

  // Safety check: if conversion failed or size is zero/negative, return empty to prevent all-0 chart JSON
  if (isNaN(cleanSize) || cleanSize <= 0) return {};

  const rate = (cleanCagr || 0) / 100;

  // 3. NORMALIZE UNITS
  let baseSizeInMillions = cleanSize;
  const unit = String(current_unit || "")
    .toLowerCase()
    .trim();

  if (unit === "billion") baseSizeInMillions = cleanSize * 1000;
  if (unit === "trillion") baseSizeInMillions = cleanSize * 1000000;

  const yearsPassed = currentYear - cleanBaseYear;

  // Calculate current year value
  const currentSizeInMillions =
    baseSizeInMillions * Math.pow(1 + rate, yearsPassed);

  const result = {};

  // Previous Year
  result[currentYear - 1] = Math.round(currentSizeInMillions / (1 + rate));
  // Current Year
  result[currentYear] = Math.round(currentSizeInMillions);

  // Future 5 Years
  for (let i = 1; i <= 5; i++) {
    const year = currentYear + i;
    result[year] = Math.round(currentSizeInMillions * Math.pow(1 + rate, i));
  }

  return result;
}
