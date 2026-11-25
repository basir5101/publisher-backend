# SEO Analyser & Automated Publisher - CLI Commands Reference

A quick reference guide for running daemon workers, manual publishing jobs, and SEO scripts.

---

## 🚀 1. Core Daemon & Server Commands

### Run Cron Worker Daemon (24/7 Automation)
Runs the continuous hourly publisher scheduler using DeepSeek via OpenRouter:
```bash
npm run cron
# or
node scripts/cron_worker.js
```

### Run HTTP Trigger Server
Runs the webhooks / API trigger server (default port `3000`):
```bash
npm run server
# or
node server.js
```

### PM2 Process Manager (Background Services)
```bash
# Start cron worker under PM2
pm2 start scripts/cron_worker.js --name "seo-cron"

# Start API server under PM2
pm2 start server.js --name "seo-server"

# View status & logs
pm2 list
pm2 logs seo-cron
pm2 logs seo-server

# Restart or Stop
pm2 restart seo-cron
pm2 stop seo-cron
```

---

## ⏰ 2. Cron Worker Commands (`scripts/cron_worker.js`)

### Continuous Mode (Default)
Starts the hourly minute dispatcher. Runs 24/7 without peak-hour blocks:
```bash
node scripts/cron_worker.js
```

### Run a Single Publisher Ad-Hoc
Executes an immediate publishing batch for a specific publisher prefix:
```bash
# Syntax: node scripts/cron_worker.js <prefix> <limit> [--once]

# Example: Run 5 reports for 'dim' publisher and exit immediately
node scripts/cron_worker.js dim 5 --once

# Example: Run 1 report for 'dir' publisher
node scripts/cron_worker.js dir 1 --once
```

### Run ALL Publishers Sequentially (--all)
Loops through every publisher in the schedule in one pass:
```bash
# Run with each publisher's default limit
node scripts/cron_worker.js --all

# Run with a custom limit override for all publishers (e.g. 5 each)
node scripts/cron_worker.js --all --limit=5
```

### Provider & Model Flags
```bash
# Use OpenRouter explicitly (already default)
node scripts/cron_worker.js dim 2 --once --openrouter

# Override model
node scripts/cron_worker.js dim 2 --once --model=deepseek/deepseek-chat

# Fallback to native DeepSeek API (enforces off-peak UTC hours)
node scripts/cron_worker.js dim 2 --once --provider=deepseek
```

---

## 📝 3. Direct Publishing Commands (`scripts/publish_new_report.js`)

Used to test, debug, or publish specific reports directly:

```bash
# Syntax: node scripts/publish_new_report.js <prefix> [limit] [id] [segmentsJSON] [flags]

# 1. Publish 1 inactive report for prefix 'dim'
node scripts/publish_new_report.js dim 1

# 2. Publish 5 reports for prefix 'dir'
node scripts/publish_new_report.js dir 5

# 3. Publish a SPECIFIC report by ID
node scripts/publish_new_report.js dim 1 12345

# 4. Publish with custom segments
node scripts/publish_new_report.js dim 1 null '["Software", "Hardware"]'

# 5. Explicitly specify provider or model
node scripts/publish_new_report.js dim 1 --openrouter
node scripts/publish_new_report.js dim 1 --provider=openrouter --model=deepseek/deepseek-v4.1-flash-1017
```

---

## 🔍 4. SEO & Keyword Maintenance Scripts

### Sync Google Search Console Keywords
Fetches and syncs search console keywords to the database:
```bash
npm run sync-keywords
# or
node scripts/sync_gsc_keywords.js
```

### Gap Finder & Gap Fixer
Identifies and fixes gaps or missing sections across existing reports:
```bash
# Find gaps
node scripts/gap_finder.js

# Fix gaps
node scripts/gap_fixer.js
```

### Keyword Metrics
Fetch volume, CPC, and competition metrics:
```bash
node scripts/get_keyword_metrics.js
```

---

## 📋 5. Publisher Schedule & Prefix Reference

| Prefix | Designated Minute | Default Query Limit |
| :--- | :--- | :--- |
| **`amr`** | `:05` | 16 |
| **`mra`** | `:10` | 16 |
| **`dim`** | `:15` | 24 |
| **`dir`** | `:20` | 32 |
| **`sdi`** | `:25` | 12 |
| **`miq`** | `:30` | 12 |
| **`pmr`** | `:35` | 16 |
| **`mpu`** | `:40` | 10 |
| **`idi`** | `:45` | 10 |
| **`rih`** | `:50` | 10 |
| **`imd`** | `:55` | 5 |

*Daily sitemaps automatically trigger at `02:00 AM` and `02:00 PM` local server time.*

---

## ⚙️ 6. Environment Variables (`.env`)

Essential variables for OpenRouter and automation:

```env
AI_PROVIDER=openrouter
OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash-1017
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional OpenRouter Tuning
# OPENROUTER_PROVIDER_ORDER=DeepInfra
# OPENROUTER_ALLOW_FALLBACKS=true
# OPENROUTER_REASONING_EFFORT=none

# Headless browser mode (default: true)
# HEADLESS=true
```
