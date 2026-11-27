import crypto from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { DEFAULT_REPORT_PRICE, getNoOfPages, isNewPublisher } from "./constants.js";
import pool from "./db.js";
import { publishNewReport } from "./publish_new_report.js";

dotenv.config();

/**
 * Generate a clean kebab-case URL slug from a market keyword
 */
export function generateSlug(keyword) {
  if (!keyword) return "market-report";
  let slug = keyword
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // remove non-word chars except spaces & hyphens
    .replace(/[\s_-]+/g, "-") // collapse whitespace & dashes
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes

  if (!slug.includes("market")) {
    slug += "-market";
  }
  return slug;
}

/**
 * Ensure the slug is unique for the given publisher
 */
async function ensureUniqueSlug(prefix, baseSlug, isNew) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    let checkQuery;
    let params;

    if (isNew) {
      checkQuery = `SELECT 1 FROM "report" WHERE publisher_code = $1 AND slug = $2 LIMIT 1`;
      params = [prefix, slug];
    } else {
      checkQuery = `SELECT 1 FROM "${prefix}_report" WHERE slug = $1 LIMIT 1`;
      params = [slug];
    }

    const res = await pool.query(checkQuery, params);
    if (res.rowCount === 0) {
      return slug;
    }

    // If duplicate, append random digits or counter
    counter++;
    slug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

/**
 * Process a single GSC keyword for a NEW publisher (imd, ira)
 */
async function publishNewPublisherGSCKeyword(gscRecord, options = {}) {
  const { id: gscId, market_keyword, publisher_code, category_slug } = gscRecord;
  console.log(`\n============================================================`);
  console.log(`🚀 [GSC -> ${publisher_code.toUpperCase()}] Processing: "${market_keyword}"`);
  console.log(`   Category Slug: ${category_slug} (GSC Keyword ID: ${gscId})`);
  console.log(`============================================================`);

  let reportId = null;

  try {
    // 1. Mark status as 'processing'
    await pool.query(
      `UPDATE "GSCKeywords" SET status = 'processing', "updatedAt" = NOW() WHERE id = $1`,
      [gscId]
    );

    // 2. Step 1: Upsert into keyword_data
    console.log(`📝 Upserting into "keyword_data"...`);
    const kwRes = await pool.query(
      `
      INSERT INTO "keyword_data" ("keyword", "category_slug", "sources", "createdAt", "updatedAt")
      VALUES ($1, $2, ARRAY['gsc'], NOW(), NOW())
      ON CONFLICT ("keyword") DO UPDATE 
        SET "sources" = CASE 
          WHEN 'gsc' = ANY("keyword_data"."sources") THEN "keyword_data"."sources"
          ELSE array_append("keyword_data"."sources", 'gsc')
        END,
        "updatedAt" = NOW()
      RETURNING id;
      `,
      [market_keyword.trim(), category_slug]
    );
    const keywordDataId = kwRes.rows[0].id;
    console.log(`   ✓ "keyword_data" ID: ${keywordDataId}`);

    // 3. Step 2: Resolve categoryId from "category" table
    console.log(`📂 Resolving categoryId for publisher "${publisher_code}"...`);
    const catRes = await pool.query(
      `
      SELECT c.id, c.label FROM "category" c
      JOIN "publisher" p ON c."publisherId" = p.id
      WHERE p.code = $1 AND c.slug = $2
      LIMIT 1;
      `,
      [publisher_code, category_slug]
    );

    let categoryId = null;
    if (catRes.rows.length > 0) {
      categoryId = catRes.rows[0].id;
      console.log(`   ✓ Matched Category: "${catRes.rows[0].label}" (ID: ${categoryId})`);
    } else {
      console.warn(`   ⚠️ No exact category found for slug "${category_slug}". Falling back to first publisher category.`);
      const fallbackCat = await pool.query(
        `SELECT c.id FROM "category" c JOIN "publisher" p ON c."publisherId" = p.id WHERE p.code = $1 LIMIT 1`,
        [publisher_code]
      );
      if (fallbackCat.rows.length > 0) {
        categoryId = fallbackCat.rows[0].id;
      }
    }

    // 4. Step 3: Check if report already exists for this keyword and publisher
    const existingReport = await pool.query(
      `SELECT id, active FROM "report" WHERE publisher_code = $1 AND "keyword_data_Id" = $2 LIMIT 1`,
      [publisher_code, keywordDataId]
    );

    if (existingReport.rows.length > 0) {
      reportId = existingReport.rows[0].id;
      if (existingReport.rows[0].active) {
        console.log(`ℹ️ Report ID: ${reportId} is already ACTIVE in "report". Marking GSCKeyword as approved.`);
        await pool.query(
          `UPDATE "GSCKeywords" SET status = 'approved', "updatedAt" = NOW() WHERE id = $1`,
          [gscId]
        );
        return { success: true, reportId, alreadyActive: true };
      }
      console.log(`ℹ️ Found existing inactive draft in "report" with ID: ${reportId}`);
    } else {
      // 5. Step 4: Insert draft row into "report"
      const baseSlug = generateSlug(market_keyword);
      const uniqueSlug = await ensureUniqueSlug(publisher_code, baseSlug, true);
      const pages = parseInt(getNoOfPages(), 10);

      console.log(`📄 Creating inactive draft in "report" table (slug: "${uniqueSlug}", pages: ${pages})...`);
      const insertRes = await pool.query(
        `
        INSERT INTO "report" (
          publisher_code,
          slug,
          "marketKeyword",
          active,
          price,
          "noOfPages",
          "keyword_data_Id",
          "categoryId",
          segments,
          regions,
          companies,
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, false, $4::jsonb, $5, $6, $7, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], NOW(), NOW())
        RETURNING id;
        `,
        [
          publisher_code,
          uniqueSlug,
          market_keyword.trim(),
          JSON.stringify(DEFAULT_REPORT_PRICE),
          pages,
          keywordDataId,
          categoryId,
        ]
      );
      reportId = insertRes.rows[0].id;
      console.log(`   ✓ Draft created in "report" with ID: ${reportId}`);
    }

    // If dry run requested, don't execute full AI generation
    if (options.dryRun) {
      console.log(`[DRY RUN] Would execute publishNewReport for report ID: ${reportId}`);
      // Clean up the draft row created during dry-run
      await pool.query(`DELETE FROM "report" WHERE publisher_code = $1 AND id = $2 AND active = false`, [publisher_code, reportId]);
      await pool.query(
        `UPDATE "GSCKeywords" SET status = 'pending', "updatedAt" = NOW() WHERE id = $1`,
        [gscId]
      );
      return { success: true, reportId, dryRun: true };
    }

    // 6. Step 5: Execute publishNewReport engine
    console.log(`⚡ Triggering publication engine for report ID: ${reportId}...`);
    await publishNewReport(publisher_code, 1, reportId, null, { ...options, skipGSC: true });

    // 7. Step 6: Verify report was successfully activated
    const checkActive = await pool.query(
      `SELECT active FROM "report" WHERE publisher_code = $1 AND id = $2`,
      [publisher_code, reportId]
    );

    const isPublished = checkActive.rows[0]?.active === true;
    if (isPublished) {
      console.log(`🎉 SUCCESS! Report ID: ${reportId} is published (active = true).`);
      await pool.query(
        `UPDATE "GSCKeywords" SET status = 'approved', "updatedAt" = NOW() WHERE id = $1`,
        [gscId]
      );
      return { success: true, reportId };
    } else {
      throw new Error(`Report ID: ${reportId} was not activated during publishNewReport.`);
    }
  } catch (err) {
    console.error(`❌ Error publishing GSC keyword "${market_keyword}":`, err.message);
    await pool.query(
      `UPDATE "GSCKeywords" SET status = 'rejected', "updatedAt" = NOW() WHERE id = $1`,
      [gscId]
    );
    return { success: false, error: err.message, reportId };
  }
}

/**
 * Process a single GSC keyword for a LEGACY publisher (amr, dir, dim...)
 */
async function publishLegacyPublisherGSCKeyword(gscRecord, options = {}) {
  const { id: gscId, market_keyword, publisher_code: prefix, category_slug } = gscRecord;
  console.log(`\n============================================================`);
  console.log(`🚀 [GSC -> ${prefix.toUpperCase()}] Processing: "${market_keyword}"`);
  console.log(`   Category Slug: ${category_slug} (GSC Keyword ID: ${gscId})`);
  console.log(`============================================================`);

  let reportId = null;

  try {
    // 1. Mark status as 'processing'
    await pool.query(
      `UPDATE "GSCKeywords" SET status = 'processing', "updatedAt" = NOW() WHERE id = $1`,
      [gscId]
    );

    // 2. Resolve categoryId from "categories" table
    console.log(`📂 Resolving categoryId from "categories" for prefix "${prefix}"...`);
    const catRes = await pool.query(
      `SELECT id, label FROM "categories" WHERE prefix = $1 AND link = $2 LIMIT 1`,
      [prefix, category_slug]
    );

    let categoryId = null;
    if (catRes.rows.length > 0) {
      categoryId = catRes.rows[0].id;
      console.log(`   ✓ Matched Category: "${catRes.rows[0].label}" (ID: ${categoryId})`);
    } else {
      console.warn(`   ⚠️ No category found for link "${category_slug}". Falling back to first.`);
      const fallbackCat = await pool.query(
        `SELECT id FROM "categories" WHERE prefix = $1 LIMIT 1`,
        [prefix]
      );
      if (fallbackCat.rows.length > 0) categoryId = fallbackCat.rows[0].id;
    }

    // 3. Check if report already exists in ${prefix}_report
    const existing = await pool.query(
      `SELECT id, active, slug FROM "${prefix}_report" WHERE "marketKeyword" = $1 LIMIT 1`,
      [market_keyword.trim()]
    );

    const baseSlug = generateSlug(market_keyword);

    if (existing.rows.length > 0) {
      reportId = existing.rows[0].id;
      const currentSlug = existing.rows[0].slug;
      const expectedSuffix = `-${reportId}`;
      if (!currentSlug || !currentSlug.endsWith(expectedSuffix)) {
        const legacySlug = `${baseSlug}-${reportId}`;
        await pool.query(
          `UPDATE "${prefix}_report" SET slug = $1 WHERE id = $2`,
          [legacySlug, reportId]
        );
        console.log(`   ✓ Corrected slug in "${prefix}_report" to "${legacySlug}"`);
      }
      if (existing.rows[0].active) {
        console.log(`ℹ️ Report ID: ${reportId} already ACTIVE in "${prefix}_report". Marking approved.`);
        await pool.query(
          `UPDATE "GSCKeywords" SET status = 'approved', "updatedAt" = NOW() WHERE id = $1`,
          [gscId]
        );
        return { success: true, reportId, alreadyActive: true };
      }
    } else {
      const reportIdUuid = crypto.randomUUID();

      const pages = getNoOfPages();

      console.log(`📄 Creating inactive draft in "${prefix}_report" (keyword: "${market_keyword}", reportId: "${reportIdUuid}", pages: ${pages})...`);
      const insertRes = await pool.query(
        `
        INSERT INTO "${prefix}_report" (
          "reportId",
          "marketKeyword",
          "slug",
          "reportUrl",
          "marketData",
          "price",
          "noOfPages",
          "categoryId",
          active,
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, 'not available', '{}'::jsonb, $4::jsonb, $5, $6, false, NOW(), NOW())
        RETURNING id;
        `,
        [reportIdUuid, market_keyword.trim(), baseSlug, JSON.stringify(DEFAULT_REPORT_PRICE), pages, categoryId]
      );
      reportId = insertRes.rows[0].id;

      // Legacy publisher slug structure MUST be "slug-id" (e.g. "japanese-soy-milk-market-19857")
      const legacySlug = `${baseSlug}-${reportId}`;
      await pool.query(
        `UPDATE "${prefix}_report" SET slug = $1 WHERE id = $2`,
        [legacySlug, reportId]
      );
      console.log(`   ✓ Draft created in "${prefix}_report" with ID: ${reportId} (slug: "${legacySlug}")`);

      // Ensure relation table entries exist for legacy publisher
      await pool.query(
        `
        INSERT INTO "${prefix}_marketAnalysis" ("reportId", "createdAt", "updatedAt")
        VALUES ($1, NOW(), NOW())
        ON CONFLICT ("reportId") DO NOTHING;
        `,
        [reportId]
      );

      await pool.query(
        `
        INSERT INTO "${prefix}_marketReport" ("reportId", "createdAt", "updatedAt")
        VALUES ($1, NOW(), NOW())
        ON CONFLICT ("reportId") DO NOTHING;
        `,
        [reportId]
      );
    }

    if (options.dryRun) {
      console.log(`[DRY RUN] Would execute publishNewReport for report ID: ${reportId}`);
      await pool.query(`DELETE FROM "${prefix}_marketAnalysis" WHERE "reportId" = $1`, [reportId]).catch(() => {});
      await pool.query(`DELETE FROM "${prefix}_marketReport" WHERE "reportId" = $1`, [reportId]).catch(() => {});
      await pool.query(`DELETE FROM "${prefix}_rd" WHERE "reportId" = $1`, [reportId]).catch(() => {});
      await pool.query(`DELETE FROM "${prefix}_report" WHERE id = $1 AND active = false`, [reportId]);
      await pool.query(
        `UPDATE "GSCKeywords" SET status = 'pending', "updatedAt" = NOW() WHERE id = $1`,
        [gscId]
      );
      return { success: true, reportId, dryRun: true };
    }

    // 4. Trigger publishNewReport
    console.log(`⚡ Triggering publication engine for report ID: ${reportId}...`);
    await publishNewReport(prefix, 1, reportId, null, { ...options, skipGSC: true });

    // 5. Verify report is active
    const checkActive = await pool.query(
      `SELECT active FROM "${prefix}_report" WHERE id = $1`,
      [reportId]
    );

    if (checkActive.rows[0]?.active === true) {
      console.log(`🎉 SUCCESS! Report ID: ${reportId} is published in "${prefix}_report".`);
      await pool.query(
        `UPDATE "GSCKeywords" SET status = 'approved', "updatedAt" = NOW() WHERE id = $1`,
        [gscId]
      );
      return { success: true, reportId };
    } else {
      throw new Error(`Report ID: ${reportId} was not activated in "${prefix}_report".`);
    }
  } catch (err) {
    console.error(`❌ Error publishing GSC keyword "${market_keyword}":`, err.message);
    await pool.query(
      `UPDATE "GSCKeywords" SET status = 'rejected', "updatedAt" = NOW() WHERE id = $1`,
      [gscId]
    );
    return { success: false, error: err.message, reportId };
  }
}

/**
 * Main Publisher orchestrator
 */
export async function publishFromGSC(options = {}) {
  const publisherCode = (options.publisher || "imd").toLowerCase();
  const limit = options.limit || 1;
  const isNew = isNewPublisher(publisherCode);

  console.log(`\n============================================================`);
  console.log(`🎯 GSC KEYWORDS REPORT PUBLISHER`);
  console.log(`   Target Publisher: ${publisherCode.toUpperCase()} (${isNew ? "NEW" : "LEGACY"})`);
  console.log(`   Batch Limit: ${limit}`);
  if (options.id) console.log(`   Specific GSC Keyword ID: ${options.id}`);
  if (options.dryRun) console.log(`   Mode: DRY RUN (no generation)`);
  console.log(`============================================================`);

  // Fetch pending records from GSCKeywords
  let queryText;
  let params;

  if (options.id) {
    queryText = `SELECT * FROM "GSCKeywords" WHERE id = $1`;
    params = [options.id];
  } else {
    queryText = `
      SELECT * FROM "GSCKeywords" 
      WHERE publisher_code = $1 AND status = 'pending'
      ORDER BY id ASC 
      LIMIT $2
    `;
    params = [publisherCode, limit];
  }

  const res = await pool.query(queryText, params);
  const records = res.rows;

  if (records.length === 0) {
    console.log(`ℹ️ No pending keywords found in "GSCKeywords" for publisher: ${publisherCode}`);
    return { processed: 0, successful: 0, failed: 0 };
  }

  console.log(`📋 Found ${records.length} pending keyword(s) to publish.`);

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    console.log(`\n👉 Processing ${i + 1}/${records.length} (GSC ID: ${record.id})`);

    const result = isNew
      ? await publishNewPublisherGSCKeyword(record, options)
      : await publishLegacyPublisherGSCKeyword(record, options);

    if (result.success) {
      successful++;
    } else {
      failed++;
    }
  }

  console.log(`\n============================================================`);
  console.log(`🏁 Summary for ${publisherCode.toUpperCase()}:`);
  console.log(`   - Total Processed: ${records.length}`);
  console.log(`   - Successful: ${successful}`);
  console.log(`   - Failed: ${failed}`);
  console.log(`============================================================\n`);

  return { processed: records.length, successful, failed };
}

// ── CLI Execution ────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const publisherArg = args.find((a) => a.startsWith("--publisher="))?.split("=")[1] || "imd";
  const limitArg = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1], 10) || 1;
  const idArg = parseInt(args.find((a) => a.startsWith("--id="))?.split("=")[1], 10) || null;
  const dryRun = args.includes("--dry-run");

  const providerArg = args.find((a) => a.startsWith("--provider="))?.split("=")[1];
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];

  publishFromGSC({
    publisher: publisherArg,
    limit: limitArg,
    id: idArg,
    dryRun,
    provider: providerArg,
    model: modelArg,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Fatal publisher error:", err);
      process.exit(1);
    })
    .finally(() => {
      pool.end();
    });
}
