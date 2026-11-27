import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory and files
const outputDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const txtOutputFile = path.join(outputDir, "unique_keywords.txt");
const jsonOutputFile = path.join(outputDir, "unique_keywords.json");

// Configuration
const BATCH_SIZE = 10000;      // 10,000 rows per cursor batch
const SLEEP_MS_BETWEEN_BATCHES = 15; // 15ms pause to prevent RDS CPU spikes

const tables = [
  { name: "amr_report", col: "marketKeyword" },
  { name: "mra_report", col: "marketKeyword" },
  { name: "dim_report", col: "marketKeyword" },
  { name: "dir_report", col: "marketKeyword" },
  { name: "sdi_report", col: "marketKeyword" },
  { name: "miq_report", col: "marketKeyword" },
  { name: "pmr_report", col: "marketKeyword" },
  { name: "mpu_report", col: "marketKeyword" },
  { name: "idi_report", col: "marketKeyword" },
  { name: "rih_report", col: "marketKeyword" },
  { name: "keyword_data", col: "keyword" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function extractAllUniqueKeywords() {
  console.log("=======================================================");
  console.log("🚀 STARTING KEYWORD EXTRACTION & DEDUPLICATION");
  console.log(`📦 Tables: ${tables.length} tables (~3.7M total rows)`);
  console.log(`⚡ Method: Keyset / Cursor Pagination (WHERE id > lastId)`);
  console.log(`💾 Output: ${txtOutputFile}`);
  console.log("=======================================================\n");

  const startTime = Date.now();
  
  // Track seen normalized keywords for O(1) deduplication
  const seenSet = new Set();
  
  // We stream unique keywords to disk progressively so memory stays low
  const writeStream = fs.createWriteStream(txtOutputFile, { flags: "w", encoding: "utf8" });

  let totalRowsProcessed = 0;

  for (let tIndex = 0; tIndex < tables.length; tIndex++) {
    const { name: tableName, col: columnName } = tables[tIndex];
    console.log(`\n[${tIndex + 1}/${tables.length}] Processing "${tableName}"...`);

    let lastId = 0;
    let tableRows = 0;
    let tableUniqueAdded = 0;

    while (true) {
      // Keyset pagination using the Primary Key B-Tree Index -> Instant O(log N) lookup
      const queryText = `
        SELECT id, "${columnName}" AS kw
        FROM "${tableName}"
        WHERE id > $1
        ORDER BY id ASC
        LIMIT $2
      `;

      const result = await pool.query(queryText, [lastId, BATCH_SIZE]);
      const rows = result.rows;

      if (rows.length === 0) {
        break; // All rows in this table completed
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        lastId = row.id;
        tableRows++;
        totalRowsProcessed++;

        const rawKw = row.kw;
        if (!rawKw || typeof rawKw !== "string") continue;

        const trimmed = rawKw.trim();
        if (trimmed.length === 0) continue;

        // Normalize (lowercase) for strict uniqueness check
        const normalized = trimmed.toLowerCase();

        if (!seenSet.has(normalized)) {
          seenSet.add(normalized);
          tableUniqueAdded++;
          // Write to text file immediately (1 keyword per line)
          writeStream.write(trimmed + "\n");
        }
      }

      // Memory monitor
      const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      process.stdout.write(
        `\r   ↳ Scanned: ${tableRows.toLocaleString()} rows | Added: ${tableUniqueAdded.toLocaleString()} unique | Total Unique: ${seenSet.size.toLocaleString()} | Heap: ${memMB}MB`
      );

      // Brief yield to avoid starving RDS CPU or event loop
      if (SLEEP_MS_BETWEEN_BATCHES > 0) {
        await sleep(SLEEP_MS_BETWEEN_BATCHES);
      }
    }

    console.log(`\n   ✔ Finished "${tableName}": ${tableRows.toLocaleString()} rows scanned.`);
  }

  // Close write stream
  writeStream.end();

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n=======================================================");
  console.log("🎉 EXTRACTION COMPLETED SUCCESSFULLY!");
  console.log("=======================================================");
  console.log(`Total Rows Scanned:   ${totalRowsProcessed.toLocaleString()}`);
  console.log(`Total Unique Keywords: ${seenSet.size.toLocaleString()}`);
  console.log(`Elapsed Time:          ${totalTimeSec} seconds`);
  console.log(`Saved text file:       ${txtOutputFile}`);
  console.log("=======================================================\n");

  return Array.from(seenSet);
}

// Allow standalone execution: node scripts/extract_unique_keywords.js
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  extractAllUniqueKeywords()
    .then(() => {
      console.log("Done.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n❌ Fatal Error:", err);
      process.exit(1);
    });
}
