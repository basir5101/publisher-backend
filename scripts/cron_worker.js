import dotenv from 'dotenv';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { publishNewReport } from './publish_new_report.js';

dotenv.config();

// =============================================================================
// 🌙 DEEPSEEK OFF-PEAK ENFORCEMENT
// DeepSeek peak hours (UTC): Mon–Fri 01:00–04:00 and 06:00–10:00
// Exception: Chinese public holidays are fully off-peak.
// Source: https://platform.deepseek.com/sign_in (pricing page)
// =============================================================================

// ISO date strings (YYYY-MM-DD) of Chinese public holidays for 2025–2026.
// Update annually. Weekends are handled separately by dayOfWeek check.
const CHINESE_PUBLIC_HOLIDAYS = new Set([
    // 2025
    '2025-01-01', // New Year's Day
    '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', // Spring Festival
    '2025-02-03', '2025-02-04',
    '2025-04-04', '2025-04-05', '2025-04-06', // Qingming
    '2025-05-01', '2025-05-02', '2025-05-05', // Labour Day
    '2025-05-31', '2025-06-02',               // Dragon Boat
    '2025-10-01', '2025-10-02', '2025-10-03', // National Day / Golden Week
    '2025-10-06', '2025-10-07', '2025-10-08',
    // 2026
    '2026-01-01', // New Year's Day
    '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', // Spring Festival
    '2026-02-23', '2026-02-24',
    '2026-04-05', '2026-04-06',               // Qingming
    '2026-05-01', '2026-05-04', '2026-05-05', // Labour Day
    '2026-06-19', '2026-06-22',               // Dragon Boat
    '2026-09-24', '2026-09-25',               // Mid-Autumn
    '2026-10-01', '2026-10-02', '2026-10-05', // National Day / Golden Week
    '2026-10-06', '2026-10-07', '2026-10-08',
]);

/**
 * Returns true when it is safe (cheap) to call DeepSeek API.
 * Peak hours (UTC, Mon–Fri, excl. Chinese public holidays):
 *   01:00–04:00  and  06:00–10:00
 * Everything else — weekends, holidays, and all other hours — is off-peak.
 */
function isDeepSeekOffPeak(now = new Date()) {
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
    { prefix: "amr", minute: 5, limit: 8 },
    { prefix: "mra", minute: 10, limit: 8 },
    { prefix: "dim", minute: 15, limit: 12 },
    { prefix: "dir", minute: 20, limit: 16 },
    { prefix: "sdi", minute: 25, limit: 6 },
    { prefix: "miq", minute: 30, limit: 6 },
    { prefix: "pmr", minute: 35, limit: 8 },
    { prefix: "mpu", minute: 40, limit: 5 },
    { prefix: "idi", minute: 45, limit: 5 },
    { prefix: "rih", minute: 50, limit: 5 },
]

let isRunning = false;
let lastTriggeredMinute = -1;
let tickTimer = null;

export async function executePublishingJob(prefix, limit) {
    if (!isDeepSeekOffPeak()) {
        const now = new Date();
        console.log(`💤 [${now.toISOString()}] PEAK HOURS — Skipping [${prefix}]. DeepSeek charges full rate now. Will resume in off-peak window.`);
        return;
    }

    if (isRunning) {
        console.log(`⚠️ [${new Date().toISOString()}] Previous publishing job still active. Skipping [${prefix}] to prevent overlapping.`);
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    console.log(`\n------------------------------------------------------`);
    console.log(`⏰ [${new Date().toISOString()}] Dispatching Job: Prefix [${prefix}], Limit [${limit}]`);
    console.log(`------------------------------------------------------`);

    try {
        await publishNewReport(prefix, limit);
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [${new Date().toISOString()}] Job completed for [${prefix}] in ${durationSec}s`);
    } catch (err) {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`❌ [${new Date().toISOString()}] Job failed for [${prefix}] after ${durationSec}s:`, err.message || err);
    } finally {
        isRunning = false;
    }
}

// Mode 1: Run all scheduled publishers sequentially in one pass
export async function runAllSequentially(overrideLimit) {
    console.log(`🚀 Starting sequential execution across all ${PUBLISHER_SCHEDULES.length} publishers...\n`);
    for (let i = 0; i < PUBLISHER_SCHEDULES.length; i++) {
        const schedule = PUBLISHER_SCHEDULES[i];
        const limit = overrideLimit || schedule.limit;

        console.log(`\n📌 (${i + 1}/${PUBLISHER_SCHEDULES.length}) Processing publisher: [${schedule.prefix}] with limit: ${limit}`);
        await executePublishingJob(schedule.prefix, limit);

        if (i < PUBLISHER_SCHEDULES.length - 1) {
            console.log(`⏳ Pausing 5 seconds before next publisher...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    console.log(`\n🏁 All publishers processed successfully.`);
}

// Mode 2: Minute tick dispatcher
export function startMinuteDispatcher() {
    console.log(`🕒 Clock dispatcher started. Listening for scheduled minutes of the hour...\n`);

    // Check every 30 seconds to accurately catch minute transitions
    tickTimer = setInterval(async () => {
        const now = new Date();
        const currentMinute = now.getMinutes();

        // Avoid firing multiple times within the same clock minute
        if (currentMinute === lastTriggeredMinute) {
            return;
        }

        // Find matching schedule for this exact minute of the hour
        const matchingSchedule = PUBLISHER_SCHEDULES.find(s => s.minute === currentMinute);
        if (matchingSchedule) {
            lastTriggeredMinute = currentMinute;
            console.log(`\n🔔 Hourly Schedule Trigger at :${String(currentMinute).padStart(2, '0')}: Publisher [${matchingSchedule.prefix}] (limit: ${matchingSchedule.limit})`);
            await executePublishingJob(matchingSchedule.prefix, matchingSchedule.limit);
        }
    }, 30 * 1000);
}

// Graceful termination handling
process.on('SIGINT', () => {
    console.log(`\n🛑 Received SIGINT. Shutting down worker gracefully...`);
    if (tickTimer) clearInterval(tickTimer);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(`\n🛑 Received SIGTERM. Shutting down worker gracefully...`);
    if (tickTimer) clearInterval(tickTimer);
    process.exit(0);
});

// Direct CLI entry point
// Resolve both paths to handle symlinks and PM2 argv manipulation
let isMain = false;
try {
    const _resolvedArgv = realpathSync(process.argv[1]);
    const _resolvedSelf = realpathSync(fileURLToPath(import.meta.url));
    isMain = (_resolvedArgv === _resolvedSelf);
} catch (e) {
    // Ignore errors if process.argv[1] is undefined
}

// Execute if it's the main module OR if running inside PM2
if (isMain || process.env.PM2_HOME) {
    const args = process.argv.slice(2);
    const isAll = args.includes('--all');
    const isOnce = args.includes('--once');
    const overrideLimitArg = args.find(a => a.startsWith('--limit='));

    let customPrefix = null;
    let customLimit = null;

    const nonFlagArgs = args.filter(a => !a.startsWith('--'));
    if (nonFlagArgs.length > 0) {
        customPrefix = nonFlagArgs[0].trim();
        if (nonFlagArgs[1]) {
            customLimit = parseInt(nonFlagArgs[1], 10);
        }
    }

    console.log(`\n======================================================`);
    console.log(`🤖 Multi-Publisher SEO Automation Daemon Initialized`);
    console.log(`======================================================`);

    if (isAll) {
        console.log(`   Mode:           Sequential Loop through ALL publishers (--all)`);
        console.log(`   Prefixes:       ${PUBLISHER_SCHEDULES.map(s => `${s.prefix} (limit ${s.limit})`).join(', ')}`);
    } else if (customPrefix) {
        console.log(`   Mode:           Ad-hoc single publisher [${customPrefix}]`);
        console.log(`   Limit:          ${customLimit || 'default (1)'}`);
        console.log(`   One-time:       ${isOnce ? 'Yes' : 'No'}`);
    } else {
        console.log(`   DeepSeek:       Off-peak only (UTC peak: Mon–Fri 01–04 & 06–10, excl. CN holidays)`);
        console.log(`   Currently:      ${isDeepSeekOffPeak() ? '✅ OFF-PEAK (will run)' : '🔴 PEAK HOURS (will skip until off-peak)'}`);
        console.log(`   Mode:           Hourly Minute Dispatcher (Continuous 24/7 Daemon)`);
        console.log(`   Schedules:`);
        for (const item of PUBLISHER_SCHEDULES) {
            const minStr = String(item.minute).padStart(2, '0');
            console.log(`     - [${item.prefix}]: Every hour at :${minStr} (Query Limit: ${item.limit})`);
        }
    }
    console.log(`   Environment:    ${process.env.NODE_ENV || 'production'}`);
    console.log(`======================================================\n`);

    (async () => {
        if (isAll) {
            const overrideLimit = overrideLimitArg ? parseInt(overrideLimitArg.split('=')[1], 10) : null;
            await runAllSequentially(overrideLimit);
            process.exit(0);
        } else if (customPrefix) {
            const targetLimit = customLimit || 1;
            await executePublishingJob(customPrefix, targetLimit);
            if (isOnce) {
                process.exit(0);
            }
        } else {
            startMinuteDispatcher();
        }
    })();
}
