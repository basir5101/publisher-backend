import axios from "axios";
import dotenv from "dotenv";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { publishNewReport } from "./publish_new_report.js";

dotenv.config();

// =============================================================================
// ⚡ AI PROVIDER & DEEPSEEK / OPENROUTER CONFIGURATION
// Default platform: OpenRouter (DeepSeek). OpenRouter operates 24/7 at flat rates
// without off-peak hour restrictions.
//
// Native DeepSeek (api.deepseek.com) peak hours (UTC): Mon–Fri 01:00–04:00 and 06:00–10:00
// Exception: Chinese public holidays are fully off-peak.
// Source: https://platform.deepseek.com/sign_in (pricing page)
// =============================================================================

export const DEFAULT_PROVIDER = (process.env.AI_PROVIDER || "openrouter").toLowerCase();
export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017";

// ISO date strings (YYYY-MM-DD) of Chinese public holidays for 2025–2026.
// Update annually. Weekends are handled separately by dayOfWeek check.
const CHINESE_PUBLIC_HOLIDAYS = new Set([
  // 2025
  "2025-01-01", // New Year's Day
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-01-31", // Spring Festival
  "2025-02-03",
  "2025-02-04",
  "2025-04-04",
  "2025-04-05",
  "2025-04-06", // Qingming
  "2025-05-01",
  "2025-05-02",
  "2025-05-05", // Labour Day
  "2025-05-31",
  "2025-06-02", // Dragon Boat
  "2025-10-01",
  "2025-10-02",
  "2025-10-03", // National Day / Golden Week
  "2025-10-06",
  "2025-10-07",
  "2025-10-08",
  // 2026
  "2026-01-01", // New Year's Day
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20", // Spring Festival
  "2026-02-23",
  "2026-02-24",
  "2026-04-05",
  "2026-04-06", // Qingming
  "2026-05-01",
  "2026-05-04",
  "2026-05-05", // Labour Day
  "2026-06-19",
  "2026-06-22", // Dragon Boat
  "2026-09-24",
  "2026-09-25", // Mid-Autumn
  "2026-10-01",
  "2026-10-02",
  "2026-10-05", // National Day / Golden Week
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
]);

/**
 * Returns true when it is safe (cheap) to call Native DeepSeek API.
 * Peak hours (UTC, Mon–Fri, excl. Chinese public holidays):
 *   01:00–04:00  and  06:00–10:00
 * Everything else — weekends, holidays, and all other hours — is off-peak.
 * Note: Only checked when using native DeepSeek API directly. OpenRouter runs 24/7.
 */
export function isDeepSeekOffPeak(now = new Date()) {
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend) return true;

  const dateStr = now.toISOString().slice(0, 10);
  if (CHINESE_PUBLIC_HOLIDAYS.has(dateStr)) return true;

  const hour = now.getUTCHours();
  const isPeak = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  return !isPeak;
}

// =============================================================================
// 🗓️ PUBLISHER SCHEDULE CONFIGURATION
// Configure prefix, designated minute of each hour, and report query limit.
// Example:
// - 'dim' runs every hour at :05 with limit 10 (01:05, 02:05, ...)
// - 'dir' runs every hour at :10 with limit 7  (01:10, 02:10, ...)
// - 'amr' runs every hour at :15 with limit 5  (01:15, 02:15, ...)
// =============================================================================
export const PUBLISHER_SCHEDULES = [
  { prefix: "amr", minute: 5, limit: 16 },
  { prefix: "mra", minute: 10, limit: 16 },
  { prefix: "dim", minute: 15, limit: 24 },
  { prefix: "dir", minute: 20, limit: 32 },
  { prefix: "sdi", minute: 25, limit: 12 },
  { prefix: "miq", minute: 30, limit: 12 },
  { prefix: "pmr", minute: 35, limit: 16 },
  { prefix: "mpu", minute: 40, limit: 10 },
  { prefix: "idi", minute: 45, limit: 10 },
  { prefix: "rih", minute: 50, limit: 10 },
  { prefix: "imd", minute: 55, limit: 5 },
];

// =============================================================================
// 📬 ASYNC FIFO JOB QUEUE
// Ensures no publisher job is ever skipped when prior jobs take > 5 minutes.
// Jobs are enqueued and executed sequentially in FIFO order without overlapping.
// =============================================================================

export const jobQueue = [];
let isProcessingQueue = false;
let lastTriggeredMinute = -1;
let tickTimer = null;

/**
 * Enqueue a job. Returns a Promise that resolves when this specific job completes.
 */
export function enqueueJob(prefix, limit, options = {}) {
  const activeProvider = (options.provider || DEFAULT_PROVIDER).toLowerCase();

  // Peak-hour restrictions only apply to native DeepSeek API (api.deepseek.com).
  // OpenRouter operates 24/7 with flat pricing and no off-peak restrictions.
  if (activeProvider === "deepseek" && !isDeepSeekOffPeak()) {
    const now = new Date();
    console.log(
      `💤 [${now.toISOString()}] PEAK HOURS (Native DeepSeek) — Skipping [${prefix}]. DeepSeek charges full rate now. Will resume in off-peak window.`,
    );
    return Promise.resolve({ skipped: true, reason: "peak_hours" });
  }

  return new Promise((resolve, reject) => {
    // Prevent duplicate queue entries for the same prefix
    const existingJob = jobQueue.find((j) => j.prefix === prefix);
    if (existingJob) {
      console.log(
        `ℹ️ [${new Date().toISOString()}] Publisher [${prefix}] is already in queue. Updating limit if higher.`,
      );
      if (limit > existingJob.limit) existingJob.limit = limit;
      if (options && Object.keys(options).length > 0) {
        existingJob.options = { ...existingJob.options, ...options };
      }
      const prevResolve = existingJob.resolve;
      existingJob.resolve = (val) => {
        prevResolve(val);
        resolve(val);
      };
      return;
    }

    jobQueue.push({
      prefix,
      limit,
      options,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    });

    console.log(
      `📥 [${new Date().toISOString()}] Enqueued job: [${prefix}] (limit: ${limit}) [${activeProvider}] | Queue depth: ${jobQueue.length}`,
    );
    processQueue();
  });
}

/**
 * Queue processor: processes queued publishing jobs one-by-one in FIFO order.
 */
async function processQueue() {
  if (isProcessingQueue) {
    return; // Active worker will process all queued items in loop
  }

  isProcessingQueue = true;

  try {
    while (jobQueue.length > 0) {
      const nextJob = jobQueue[0];
      const nextProvider = (nextJob.options?.provider || DEFAULT_PROVIDER).toLowerCase();

      // Peak-hour check only affects native DeepSeek
      if (nextProvider === "deepseek" && !isDeepSeekOffPeak()) {
        const now = new Date();
        console.log(
          `💤 [${now.toISOString()}] PEAK HOURS reached during queue processing (Native DeepSeek). Halting ${jobQueue.length} pending job(s) until off-peak.`,
        );
        while (jobQueue.length > 0) {
          const dropped = jobQueue.shift();
          dropped.resolve({ skipped: true, reason: "peak_hours" });
        }
        break;
      }

      const currentJob = jobQueue.shift();
      const { prefix, limit, options: jobOptions = {}, resolve, enqueuedAt } = currentJob;
      const waitTimeSec = ((Date.now() - enqueuedAt) / 1000).toFixed(1);
      const startTime = Date.now();

      const activeProvider = (jobOptions.provider || DEFAULT_PROVIDER).toLowerCase();
      const activeModel =
        jobOptions.model ||
        (activeProvider === "openrouter"
          ? process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017"
          : process.env.DEEPSEEK_MODEL || "deepseek-chat");

      console.log(`\n======================================================`);
      console.log(
        `🚀 [${new Date().toISOString()}] Executing Job: Prefix [${prefix}], Limit [${limit}] — AI: ${activeProvider} (${activeModel})`,
      );
      if (parseFloat(waitTimeSec) > 5) {
        console.log(
          `   (Waited ${waitTimeSec}s in queue behind prior job | Remaining in queue: ${jobQueue.length})`,
        );
      }
      console.log(`======================================================`);

      try {
        // Global watchdog: max 15 minutes per publishing batch to prevent infinite queue hang
        const JOB_TIMEOUT_MS = 15 * 60 * 1000;
        await Promise.race([
          publishNewReport(prefix, limit, null, null, {
            provider: activeProvider,
            model: activeModel,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`Timeout: Job for [${prefix}] exceeded 15 minutes`),
                ),
              JOB_TIMEOUT_MS,
            ),
          ),
        ]);
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `✅ [${new Date().toISOString()}] Job completed for [${prefix}] in ${durationSec}s`,
        );
        resolve({ success: true, durationSec });
      } catch (err) {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(
          `❌ [${new Date().toISOString()}] Job failed for [${prefix}] after ${durationSec}s:`,
          err.message || err,
        );
        resolve({ success: false, error: err.message, durationSec });
      }

      if (jobQueue.length > 0) {
        console.log(
          `⏳ Queue has ${jobQueue.length} pending job(s). Pausing 3 seconds before next job...`,
        );
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        console.log(
          `✨ Queue is now empty. Worker idle, waiting for next scheduled minute.\n`,
        );
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

export async function executePublishingJob(prefix, limit, options = {}) {
  return enqueueJob(prefix, limit, options);
}

// Mode 1: Run all scheduled publishers sequentially in one pass
export async function runAllSequentially(overrideLimit, options = {}) {
  const activeProvider = (options.provider || DEFAULT_PROVIDER).toLowerCase();
  const activeModel =
    options.model ||
    (activeProvider === "openrouter"
      ? process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017"
      : process.env.DEEPSEEK_MODEL || "deepseek-chat");

  console.log(
    `🚀 Starting sequential execution across all ${PUBLISHER_SCHEDULES.length} publishers using ${activeProvider} (${activeModel})...\n`,
  );
  for (let i = 0; i < PUBLISHER_SCHEDULES.length; i++) {
    const schedule = PUBLISHER_SCHEDULES[i];
    const limit = overrideLimit || schedule.limit;

    console.log(
      `\n📌 (${i + 1}/${PUBLISHER_SCHEDULES.length}) Processing publisher: [${schedule.prefix}] with limit: ${limit}`,
    );
    await executePublishingJob(schedule.prefix, limit, options);

    if (i < PUBLISHER_SCHEDULES.length - 1) {
      console.log(`⏳ Pausing 5 seconds before next publisher...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log(`\n🏁 All publishers processed successfully.`);
}

// =============================================================================
// 🗺️ SITEMAP GENERATION TRIGGER (Next.js Port 3000)
// Automatically triggered twice daily at 2:00 AM and 2:00 PM local server time.
// =============================================================================
export async function triggerSitemapGeneration() {
  const url =
    process.env.SITEMAP_API_URL ||
    "http://localhost:3000/api/v5/report/sitemap/generate";
  console.log(
    `🗺️ [${new Date().toISOString()}] Triggering Next.js sitemap generation at ${url}...`,
  );

  try {
    const response = await axios.post(
      url,
      {},
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 300000, // 5 minutes timeout (sitemap generation can take time)
      },
    );

    console.log(
      `✅ [${new Date().toISOString()}] Sitemap generated successfully (Status: ${response.status}).`,
    );
    return { success: true, status: response.status, data: response.data };
  } catch (error) {
    const errorDetails = error.response
      ? `Status ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message;
    console.error(
      `❌ [${new Date().toISOString()}] Failed to generate sitemap:`,
      errorDetails,
    );
    return { success: false, error: errorDetails };
  }
}

let lastSitemapTriggerKey = "";

// Mode 2: Minute tick dispatcher
export function startMinuteDispatcher(options = {}) {
  const activeProvider = (options.provider || DEFAULT_PROVIDER).toLowerCase();
  const activeModel =
    options.model ||
    (activeProvider === "openrouter"
      ? process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017"
      : process.env.DEEPSEEK_MODEL || "deepseek-chat");

  console.log(
    `🕒 Clock dispatcher started. Listening for scheduled minutes of the hour...\n`,
  );
  console.log(
    `🤖 AI Provider: ${activeProvider} (${activeModel}) ${activeProvider === "openrouter" ? "[24/7 flat rate, no peak restrictions]" : "[Off-peak only]"}\n`,
  );
  console.log(
    `🗺️ Daily sitemap generation scheduled at 02:00 AM and 02:00 PM local server time.\n`,
  );

  // Check every 30 seconds to accurately catch minute transitions
  tickTimer = setInterval(async () => {
    try {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const currentHour = now.getHours(); // Local server time (0-23)

      // Twice a day: 2:00 AM (hour 2) and 2:00 PM (hour 14) local server time
      if (currentMinute === 0 && (currentHour === 2 || currentHour === 14)) {
        const triggerKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${currentHour}`;
        if (lastSitemapTriggerKey !== triggerKey) {
          lastSitemapTriggerKey = triggerKey;
          console.log(
            `\n🗺️ [${now.toISOString()}] Scheduled Daily Trigger: Sitemap generation at ${currentHour === 2 ? "2:00 AM" : "2:00 PM"} local time.`,
          );
          triggerSitemapGeneration().catch((err) => {
            console.error(`❌ Error in sitemap trigger:`, err.message || err);
          });
        }
      }

      // Avoid firing multiple times within the same clock minute
      if (currentMinute === lastTriggeredMinute) {
        return;
      }

      // Find matching schedule for this exact minute of the hour
      const matchingSchedule = PUBLISHER_SCHEDULES.find(
        (s) => s.minute === currentMinute,
      );
      if (matchingSchedule) {
        lastTriggeredMinute = currentMinute;
        console.log(
          `\n🔔 Hourly Schedule Trigger at :${String(currentMinute).padStart(2, "0")}: Publisher [${matchingSchedule.prefix}] (limit: ${matchingSchedule.limit}) [${activeProvider}]`,
        );
        executePublishingJob(
          matchingSchedule.prefix,
          matchingSchedule.limit,
          options,
        ).catch((err) => {
          console.error(
            `❌ Background error for [${matchingSchedule.prefix}]:`,
            err.message || err,
          );
        });
      }
    } catch (tickErr) {
      console.error(
        `❌ Error in minute tick dispatcher:`,
        tickErr.message || tickErr,
      );
    }
  }, 30 * 1000);
}

// Global exception safety: log errors without crashing daemon
process.on("uncaughtException", (err) => {
  console.error(
    `💥 [${new Date().toISOString()}] Uncaught Exception:`,
    err.message || err,
  );
});

process.on("unhandledRejection", (reason) => {
  console.error(
    `💥 [${new Date().toISOString()}] Unhandled Rejection:`,
    reason?.message || reason,
  );
});

// Graceful termination handling
process.on("SIGINT", () => {
  console.log(`\n🛑 Received SIGINT. Shutting down worker gracefully...`);
  if (tickTimer) clearInterval(tickTimer);
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log(`\n🛑 Received SIGTERM. Shutting down worker gracefully...`);
  if (tickTimer) clearInterval(tickTimer);
  process.exit(0);
});

// Direct CLI entry point & PM2 execution detection
let isMain = false;
try {
  const _resolvedArgv = realpathSync(process.argv[1]);
  const _resolvedSelf = realpathSync(fileURLToPath(import.meta.url));
  isMain = _resolvedArgv === _resolvedSelf;
} catch (e) {
  // Ignore errors if process.argv[1] is undefined
}

// Running under PM2? Check standard PM2 environment indicators
const isRunningUnderPM2 = Boolean(
  process.env.pm_id !== undefined ||
  process.env.pm_exec_path !== undefined ||
  process.env.PM2_HOME ||
  process.env.PM2_USAGE,
);

const isInvokedDirectly =
  isMain ||
  (isRunningUnderPM2 && (process.argv[1] && process.argv[1].includes("cron_worker") || process.env.pm_exec_path && process.env.pm_exec_path.includes("cron_worker"))) ||
  (process.argv[1] && process.argv[1].includes("cron_worker"));

if (isInvokedDirectly) {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const nonFlagArgs = args.filter((a) => !a.startsWith("--"));

  const isAll = flags.includes("--all");
  const isOnce = flags.includes("--once");
  const isFlagOpenRouter = flags.includes("--openrouter");
  const isFlagDeepSeek = flags.includes("--deepseek");
  const overrideLimitArg = flags.find((a) => a.startsWith("--limit="));
  const providerFlag = flags
    .find((a) => a.startsWith("--provider="))
    ?.split("=")[1];
  const modelFlag = flags
    .find((a) => a.startsWith("--model="))
    ?.split("=")[1];

  let customPrefix = null;
  let customLimit = null;

  if (nonFlagArgs.length > 0) {
    customPrefix = nonFlagArgs[0].trim();
    if (nonFlagArgs[1]) {
      customLimit = parseInt(nonFlagArgs[1], 10);
    }
  }

  const activeProvider = (
    providerFlag ||
    (isFlagOpenRouter ? "openrouter" : null) ||
    (isFlagDeepSeek ? "deepseek" : null) ||
    DEFAULT_PROVIDER
  ).toLowerCase();

  const activeModel =
    modelFlag ||
    (activeProvider === "openrouter"
      ? process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017"
      : process.env.DEEPSEEK_MODEL || "deepseek-chat");

  const runOptions = {
    provider: activeProvider,
    model: activeModel,
  };

  // Warn if required API key is missing
  if (activeProvider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  WARNING: OPENROUTER_API_KEY is not defined in .env!");
  } else if (activeProvider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
    console.warn("⚠️  WARNING: DEEPSEEK_API_KEY is not defined in .env!");
  }

  console.log(`\n======================================================`);
  console.log(`🤖 Multi-Publisher SEO Automation Daemon Initialized`);
  console.log(`======================================================`);
  console.log(
    `   AI Provider:    ${activeProvider === "openrouter" ? "OpenRouter (DeepSeek)" : activeProvider}`,
  );
  console.log(`   Model:          ${activeModel}`);
  if (activeProvider === "openrouter") {
    console.log(
      `   Operation:      24/7 Continuous (OpenRouter flat rate, no peak restrictions)`,
    );
  } else if (activeProvider === "deepseek") {
    console.log(
      `   DeepSeek API:   Off-peak only (UTC peak: Mon–Fri 01–04 & 06–10, excl. CN holidays)`,
    );
    console.log(
      `   Currently:      ${isDeepSeekOffPeak() ? "✅ OFF-PEAK (will run)" : "🔴 PEAK HOURS (will skip until off-peak)"}`,
    );
  }

  if (isAll) {
    console.log(
      `   Mode:           Sequential Loop through ALL publishers (--all)`,
    );
    console.log(
      `   Prefixes:       ${PUBLISHER_SCHEDULES.map((s) => `${s.prefix} (limit ${s.limit})`).join(", ")}`,
    );
  } else if (customPrefix) {
    console.log(`   Mode:           Ad-hoc single publisher [${customPrefix}]`);
    console.log(`   Limit:          ${customLimit || "default (1)"}`);
    console.log(`   One-time:       ${isOnce ? "Yes" : "No"}`);
  } else {
    console.log(
      `   Mode:           Hourly Minute Dispatcher (Continuous 24/7 Daemon)`,
    );
    console.log(`   Schedules:`);
    for (const item of PUBLISHER_SCHEDULES) {
      const minStr = String(item.minute).padStart(2, "0");
      console.log(
        `     - [${item.prefix}]: Every hour at :${minStr} (Query Limit: ${item.limit})`,
      );
    }
  }
  console.log(`   Environment:    ${process.env.NODE_ENV || "production"}`);
  console.log(`======================================================\n`);

  (async () => {
    if (isAll) {
      const overrideLimit = overrideLimitArg
        ? parseInt(overrideLimitArg.split("=")[1], 10)
        : null;
      await runAllSequentially(overrideLimit, runOptions);
      process.exit(0);
    } else if (customPrefix) {
      const targetLimit = customLimit || 1;
      await executePublishingJob(customPrefix, targetLimit, runOptions);
      if (isOnce) {
        process.exit(0);
      }
    } else {
      startMinuteDispatcher(runOptions);
    }
  })();
}
