import { chromium } from 'playwright';

const bannerData = {
  "theme": {
    "primaryDark": "#0f172a",
    "tealMain": "#10b981",
    "tealDark": "#047857",
    "slateDark": "#334155",
    "bgGradientStart": "#eff6f9",
    "bgGradientEnd": "#dbe7ec",
    "baseHeaderStart": "#168a69",
    "baseHeaderEnd": "#106f54",
    "forecastHeaderStart": "#375769",
    "forecastHeaderEnd": "#264353",
    "chartBadgeBg": "#3e5062",
    "chartStroke": "#10b981"
  },
  "content": {
    "pageTitle": "Green Pepper Sauce Market - Valuation Banner",
    "mainTitle": "Green Pepper Sauce Market",
    "subTitle": "Market Valuation Analysis",
    "logoSrc": "https://www.datainsightsreports.com/logo2.png",
    "baseYear": {
      "title": "2025 Base Year Valuation",
      "value": "$3.2B",
      "subtext": "Total Market Size"
    },
    "cagr": {
      "rate": "6.4% CAGR",
      "desc": "Compound Annual Growth Rate"
    },
    "forecastYear": {
      "title": "2034 Forecast Valuation",
      "value": "$5.6B",
      "subtext": "Projected Market Size"
    },
    "chart": {
      "yAxisLabels": [
        "$6B",
        "$5B",
        "$4B",
        "$3B",
        "$2B",
        "$1B",
        "$0"
      ],
      "xAxisLabels": [
        "2025",
        "2027",
        "2029",
        "2031",
        "2032",
        "2034"
      ],
      "startBadge": "2025: $3.2B",
      "endBadge": "2034: $5.6B"
    },
    "dynamics": {
      "title": "Key Market Dynamics",
      "driver": {
        "badge": "Driver",
        "text": "Rising consumer demand for ethnic spicy condiments and clean-label seasonings."
      },
      "restraint": {
        "badge": "Restraint",
        "text": "Raw material price volatility and shelf-life preservation challenges."
      }
    }
  }
};

import { chromium } from 'playwright';

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.pageTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --font-heading: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-body: 'Inter', system-ui, -apple-system, sans-serif;
      --primary-dark: #0f172a;
      --teal-main: #10b981;
      --teal-dark: #047857;
      --slate-dark: #334155;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: radial-gradient(circle at 10% 20%, ${theme.bgGradientStart} 0%, ${theme.bgGradientEnd} 100%);
      font-family: var(--font-body);
      color: var(--primary-dark);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
    }

    /* Ambient Constellation Background */
    .ambient-bg {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.5;
      background-image: 
        radial-gradient(circle at 92% 8%, rgba(16, 185, 129, 0.18) 0, transparent 40%),
        radial-gradient(circle at 8% 92%, rgba(56, 189, 248, 0.14) 0, transparent 40%);
      overflow: hidden;
      z-index: 0;
    }

    .ambient-svg {
      width: 100%;
      height: 100%;
    }

    /* Banner Card Container (Standard high-res banner scale) */
    .banner-container {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 1200px;
      background: #fbfdfe;
      border-radius: 28px;
      border: 1.5px solid rgba(255, 255, 255, 0.95);
      box-shadow: 
        0 24px 50px -12px rgba(15, 34, 58, 0.14),
        0 4px 18px rgba(0, 0, 0, 0.04);
      padding: 32px 40px;
    }

    /* Header */
    .banner-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 20px;
      margin-bottom: 24px;
      border-bottom: 1.5px solid #edf2f7;
    }

    .header-titles {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-wrap: wrap;
    }

    .main-title {
      font-family: var(--font-heading);
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.025em;
      color: #0f172a;
    }

    .title-divider {
      color: #94a3b8;
      font-weight: 300;
    }

    .sub-title {
      font-family: var(--font-heading);
      font-size: 19px;
      font-weight: 600;
      color: #475569;
    }

    .header-logo {
      height: 38px;
      width: auto;
      object-fit: contain;
    }

    /* 2-Column Content Grid */
    .banner-grid {
      display: grid;
      grid-template-columns: 330px 1fr;
      gap: 28px;
      align-items: stretch;
    }

    /* Left Column: Valuation Cards & Overlap Pill */
    .valuation-col {
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .val-card {
      background: #ffffff;
      border: 1.5px solid #d9e3ea;
      border-radius: 18px;
      padding: 16px 20px 22px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.02);
      display: flex;
      flex-direction: column;
    }

    .val-card.base {
      padding-bottom: 34px;
      margin-bottom: -18px;
      z-index: 1;
    }

    .val-card.forecast {
      padding-top: 36px;
      z-index: 1;
    }

    .val-card-header {
      border-radius: 9px;
      padding: 7px 14px;
      text-align: center;
      color: #ffffff;
      font-size: 13.5px;
      font-weight: 700;
      letter-spacing: 0.01em;
      margin-bottom: 16px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
    }

    .val-card.base .val-card-header {
      background: linear-gradient(135deg, ${theme.baseHeaderStart} 0%, ${theme.baseHeaderEnd} 100%);
    }

    .val-card.forecast .val-card-header {
      background: linear-gradient(135deg, ${theme.forecastHeaderStart} 0%, ${theme.forecastHeaderEnd} 100%);
    }

    .val-card-body {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .metric-badge {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #13a87f 0%, #0d7f5f 100%);
      color: #ffffff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      box-shadow: 0 8px 20px rgba(16, 168, 127, 0.32);
      flex-shrink: 0;
    }

    .metric-val {
      font-family: var(--font-heading);
      font-size: 27px;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }

    .metric-sub {
      font-size: 11px;
      font-weight: 500;
      opacity: 0.92;
      margin-top: 4px;
      max-width: 90px;
      line-height: 1.2;
    }

    .metric-illustration {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100px;
    }

    /* CAGR Overlapping Pill */
    .cagr-badge-wrap {
      position: relative;
      z-index: 5;
      margin: 0 auto;
      width: 96%;
    }

    .cagr-badge {
      background: linear-gradient(90deg, #10b981 0%, #059669 100%);
      border-radius: 9999px;
      padding: 9px 18px;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 10px 24px -4px rgba(16, 185, 129, 0.48), 0 0 0 4px #ffffff;
    }

    .cagr-icon-wrap {
      width: 36px;
      height: 36px;
      background: rgba(255, 255, 255, 0.22);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 1px dashed rgba(255, 255, 255, 0.6);
    }

    .cagr-text {
      display: flex;
      flex-direction: column;
    }

    .cagr-rate {
      font-family: var(--font-heading);
      font-size: 18px;
      font-weight: 800;
      line-height: 1.1;
    }

    .cagr-desc {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
      opacity: 0.95;
      text-transform: uppercase;
      white-space: nowrap;
    }

    /* Right Column: Chart & Dynamic Insights */
    .chart-col {
      background: #ffffff;
      border: 1.5px solid #d9e3ea;
      border-radius: 20px;
      padding: 24px 28px 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.02);
    }

    .chart-container {
      position: relative;
      width: 100%;
      height: 300px;
    }

    .chart-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .grid-line {
      stroke: #e2e8f0;
      stroke-width: 1.2;
      stroke-dasharray: 4, 4;
    }

    .axis-label {
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      fill: #64748b;
    }

    .chart-tooltip-badge {
      position: absolute;
      background: #3e5062;
      color: #ffffff;
      padding: 5px 10px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
      pointer-events: none;
      white-space: nowrap;
    }

    .chart-tooltip-badge::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 12px;
      width: 8px;
      height: 8px;
      background: #3e5062;
      transform: rotate(45deg);
    }

    .badge-2025 {
      top: 125px;
      left: 45px;
    }

    .badge-2034 {
      top: 14px;
      right: 20px;
    }

    .badge-2034::after {
      left: auto;
      right: 18px;
    }

    /* Chart Footer: Dynamics Section */
    .chart-footer {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1.5px solid #f1f5f9;
    }

    .dynamics-title {
      font-family: var(--font-heading);
      font-size: 14.5px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }

    .dynamics-tags-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .dynamics-tag {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.35;
    }

    .dynamics-tag.driver {
      background: #ecfdf5;
      color: #065f46;
      border-left: 3.5px solid #10b981;
    }

    .dynamics-tag.restraint {
      background: #f8fafc;
      color: #334155;
      border-left: 3.5px solid #94a3b8;
    }

    .tag-badge {
      font-family: var(--font-heading);
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .dynamics-tag.driver .tag-badge {
      background: #d1fae5;
      color: #047857;
    }

    .dynamics-tag.restraint .tag-badge {
      background: #e2e8f0;
      color: #475569;
    }

    .tag-text {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Responsive fallbacks */
    @media (max-width: 950px) {
      .banner-grid {
        grid-template-columns: 1fr;
      }
      .cagr-badge-wrap {
        margin: 10px 0;
        width: 100%;
      }
      .val-card.base {
        padding-bottom: 16px;
        margin-bottom: 0;
      }
      .val-card.forecast {
        padding-top: 16px;
      }
    }
  </style>
</head>
<body>

  <!-- Ambient Network Lines -->
  <div class="ambient-bg">
    <svg class="ambient-svg" xmlns="http://www.w3.org/2000/svg">
      <g stroke="rgba(148, 163, 184, 0.28)" stroke-width="1.2" fill="none">
        <line x1="8%" y1="16%" x2="22%" y2="8%"/>
        <line x1="22%" y1="8%" x2="42%" y2="18%"/>
        <line x1="72%" y1="10%" x2="90%" y2="5%"/>
        <line x1="90%" y1="5%" x2="97%" y2="28%"/>
        <line x1="4%" y1="80%" x2="18%" y2="92%"/>
        <line x1="18%" y1="92%" x2="34%" y2="85%"/>
      </g>
      <circle cx="8%" cy="16%" r="3.5" fill="#94a3b8" opacity="0.4"/>
      <circle cx="22%" cy="8%" r="4" fill="#10b981" opacity="0.5"/>
      <circle cx="42%" cy="18%" r="3" fill="#94a3b8" opacity="0.4"/>
      <circle cx="72%" cy="10%" r="4" fill="#94a3b8" opacity="0.4"/>
      <circle cx="90%" cy="5%" r="5" fill="#10b981" opacity="0.6"/>
      <circle cx="97%" cy="28%" r="3.5" fill="#94a3b8" opacity="0.4"/>
      <circle cx="18%" cy="92%" r="4.5" fill="#10b981" opacity="0.4"/>
    </svg>
  </div>

  <main class="banner-container">
    <!-- Header: Dynamic Title + Logo -->
    <header class="banner-header">
      <div class="header-titles">
        <h1 class="main-title">${content.mainTitle}</h1>
        <span class="title-divider">|</span>
        <span class="sub-title">${content.subTitle}</span>
      </div>
      <div class="header-logo-wrap">
        <img 
          src="${content.logoSrc}" 
          alt="Data Insights Reports Logo" 
          class="header-logo"
        />
      </div>
    </header>

    <!-- 2-Column Banner Body -->
    <div class="banner-grid">

      <!-- Left Column: Valuation Stats -->
      <section class="valuation-col" aria-label="Valuation Metrics">
        <!-- 2025 Base Year Card -->
        <div class="val-card base">
          <div class="val-card-header">${content.baseYear.title}</div>
          <div class="val-card-body">
            <div class="metric-badge">
              <span class="metric-val">$3.2B</span>
              <span class="metric-sub">${content.baseYear.subtext}</span>
            </div>
            <div class="metric-illustration">
              <!-- Globe SVG -->
              <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="42" cy="52" r="34" stroke="#486581" stroke-width="2.5" fill="#f8fafc" />
                <ellipse cx="42" cy="52" rx="16" ry="34" stroke="#627d98" stroke-width="2" fill="none" />
                <line x1="8" y1="52" x2="76" y2="52" stroke="#627d98" stroke-width="2" />
                <path d="M14 36 Q42 46 70 36" stroke="#627d98" stroke-width="1.8" fill="none" />
                <path d="M14 68 Q42 58 70 68" stroke="#627d98" stroke-width="1.8" fill="none" />
                <path d="M68 45 L68 18 M68 18 L58 28 M68 18 L78 28" stroke="#10b981" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M84 56 L84 36 M84 36 L76 44 M84 36 L92 44" stroke="#34d399" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Overlapping CAGR Pill -->
        <div class="cagr-badge-wrap">
          <div class="cagr-badge">
            <div class="cagr-icon-wrap">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="5" x2="5" y2="19"></line>
                <circle cx="7" cy="7" r="2.5" fill="currentColor"></circle>
                <circle cx="17" cy="17" r="2.5" fill="currentColor"></circle>
              </svg>
            </div>
            <div class="cagr-text">
              <span class="cagr-rate">${content.cagr.rate}</span>
              <span class="cagr-desc">${content.cagr.desc}</span>
            </div>
          </div>
        </div>

        <!-- 2034 Forecast Card -->
        <div class="val-card forecast">
          <div class="val-card-header">${content.forecastYear.title}</div>
          <div class="val-card-body">
            <div class="metric-badge">
              <span class="metric-val">$5.6B</span>
              <span class="metric-sub">${content.forecastYear.subtext}</span>
            </div>
            <div class="metric-illustration">
              <!-- Cloud with Growth Arrow SVG -->
              <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M26 68 H76 C84 68 89 62 88 54 C87 46 80 42 74 43 C72 32 63 26 52 27 C43 28 36 34 34 42 C27 42 22 47 22 55 C22 62 25 68 26 68 Z" 
                      fill="#f1f5f9" stroke="#627d98" stroke-width="2.5" stroke-linejoin="round" />
                <path d="M20 74 L38 62 L52 70 L78 44" stroke="#10b981" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M64 44 H78 V58" stroke="#10b981" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      <!-- Right Column: Trend Chart + Dynamic Dynamics -->
      <section class="chart-col" aria-label="Growth Trend Analysis">
        <div class="chart-container">
          <!-- 2025 Start Badge -->
          <div class="chart-tooltip-badge badge-2025">2025: $3.2B</div>
          
          <!-- 2034 End Badge -->
          <div class="chart-tooltip-badge badge-2034">2034: $5.6B</div>

          <svg class="chart-svg" viewBox="0 0 540 280" preserveAspectRatio="none">
            <defs>
              <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.32" />
                <stop offset="60%" stop-color="#34d399" stop-opacity="0.14" />
                <stop offset="100%" stop-color="#a7f3d0" stop-opacity="0.02" />
              </linearGradient>

              <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            <!-- Horizontal Grid Lines -->
            <line x1="50" y1="20" x2="510" y2="20" class="grid-line" />
            <text x="36" y="24" text-anchor="end" class="axis-label">$6B</text>

            <line x1="50" y1="60" x2="510" y2="60" class="grid-line" />
            <text x="36" y="64" text-anchor="end" class="axis-label">$5B</text>

            <line x1="50" y1="105" x2="510" y2="105" class="grid-line" />
            <text x="36" y="109" text-anchor="end" class="axis-label">$4B</text>

            <line x1="50" y1="150" x2="510" y2="150" class="grid-line" />
            <text x="36" y="154" text-anchor="end" class="axis-label">$3B</text>

            <line x1="50" y1="195" x2="510" y2="195" class="grid-line" />
            <text x="36" y="199" text-anchor="end" class="axis-label">$2B</text>

            <line x1="50" y1="240" x2="510" y2="240" class="grid-line" />
            <text x="36" y="244" text-anchor="end" class="axis-label">$1B</text>

            <line x1="50" y1="260" x2="510" y2="260" class="grid-line" />
            <text x="36" y="264" text-anchor="end" class="axis-label">$0</text>

            <!-- Vertical Year Lines -->
            <line x1="55" y1="20" x2="55" y2="260" class="grid-line" />
            <text x="55" y="275" text-anchor="middle" class="axis-label">2025</text>

            <line x1="145" y1="20" x2="145" y2="260" class="grid-line" />
            <text x="145" y="275" text-anchor="middle" class="axis-label">2027</text>

            <line x1="235" y1="20" x2="235" y2="260" class="grid-line" />
            <text x="235" y="275" text-anchor="middle" class="axis-label">2029</text>

            <line x1="285" y1="20" x2="285" y2="260" class="grid-line" />
            <text x="285" y="275" text-anchor="middle" class="axis-label">2031</text>

            <line x1="375" y1="20" x2="375" y2="260" class="grid-line" />
            <text x="375" y="275" text-anchor="middle" class="axis-label">2032</text>

            <line x1="495" y1="20" x2="495" y2="260" class="grid-line" />
            <text x="495" y="275" text-anchor="middle" class="axis-label">2034</text>

            <!-- Shaded Area Under Curve -->
            <path d="M 55 140
                     C 120 135, 180 120, 240 95
                     C 320 62, 420 48, 495 35
                     L 495 260
                     L 55 260 Z" 
                  fill="url(#areaGradient)" />

            <!-- Trajectory Path -->
            <path d="M 55 140
                     C 120 135, 180 120, 240 95
                     C 320 62, 420 48, 495 35" 
                  stroke="#10b981" 
                  stroke-width="5" 
                  fill="none" 
                  stroke-linecap="round"
                  filter="url(#neonGlow)" />

            <!-- End Markers -->
            <circle cx="55" cy="140" r="5" fill="#10b981" stroke="#ffffff" stroke-width="2.5" />
            <circle cx="495" cy="35" r="6" fill="#10b981" stroke="#ffffff" stroke-width="3" />
          </svg>
        </div>

        <!-- Dynamics Micro-Pills (Driver & Restraint) -->
        <div class="chart-footer">
          <h2 class="dynamics-title">${content.dynamics.title}</h2>
          <div class="dynamics-tags-group">
            <!-- Dynamic Driver -->
            <div class="dynamics-tag driver">
              <span class="tag-badge">${content.dynamics.driver.badge}</span>
              <span class="tag-text">${content.dynamics.driver.text}</span>
            </div>
            <!-- Dynamic Restraint -->
            <div class="dynamics-tag restraint">
              <span class="tag-badge">${content.dynamics.restraint.badge}</span>
              <span class="tag-text">${content.dynamics.restraint.text}</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  </main>

`;

async function generateBanner() {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.setContent(generateHtml(bannerData));

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    // Set viewport to banner dimensions
    await page.setViewportSize({ width: 1200, height: 630 });

    const elementHandle = await page.$('.banner-container');
    if (elementHandle) {
        await elementHandle.screenshot({ path: 'banner.png' });
        console.log('Banner saved as banner.png');
    } else {
        await page.screenshot({ path: 'banner.png', fullPage: true });
        console.log('Banner saved as banner.png (full page)');
    }

    await browser.close();
}

generateBanner().catch(console.error);
