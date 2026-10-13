import dotenv from 'dotenv';
import fs from 'fs';
import { google } from 'googleapis';
import http from 'http';
import path from 'path';
import url from 'url';

dotenv.config();

const LOOKBACK_DAYS = parseInt(process.env.GSC_DAYS, 10) || 30;
const MIN_POSITION = parseFloat(process.env.GSC_MIN_POSITION) || 5;
const MAX_POSITION = parseFloat(process.env.GSC_MAX_POSITION) || 80;

// ── Google Search Console auth ──────────────────────────────────────────────
async function getGscService() {
    const credentialsPath = path.resolve(process.env.GSC_CLIENT_SECRET_FILE || 'credentials.json');
    const tokenPath = path.resolve('token.json');

    const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];

    let credentials;
    try {
        const credString = fs.readFileSync(credentialsPath, 'utf8');
        credentials = JSON.parse(credString);
    } catch (err) {
        throw new Error(`Error loading client secret file at ${credentialsPath}: ${err.message}`);
    }

    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

    if (!client_secret || !client_id) {
        throw new Error("Invalid credentials JSON format. Expected 'installed' or 'web' property with client_id and client_secret.");
    }

    let redirectUri = 'http://localhost:3000';
    let localPort = 3000;

    if (redirect_uris && redirect_uris.length > 0) {
        try {
            const parsedUrl = new url.URL(redirect_uris[0]);
            if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
                localPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3000;
                redirectUri = `http://${parsedUrl.hostname}:${localPort}${parsedUrl.pathname}`;
            }
        } catch (e) {
            // Ignore URL parsing errors and stick to fallback
        }
    }

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    try {
        const tokenString = fs.readFileSync(tokenPath, 'utf8');
        const token = JSON.parse(tokenString);
        oAuth2Client.setCredentials(token);

        // Automatically verify token and refresh if needed.
        await oAuth2Client.getAccessToken();
    } catch (err) {
        console.log("Token not found or invalid, need to re-authenticate.");
        await getNewToken(oAuth2Client, scopes, tokenPath, localPort, redirectUri);
    }

    return google.searchconsole({ version: 'v1', auth: oAuth2Client });
}

function getNewToken(oAuth2Client, scopes, tokenPath, port, redirectUri) {
    return new Promise((resolve, reject) => {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
        });
        console.log('Authorize this app by visiting this url:', authUrl);

        const redirectUrl = new url.URL(redirectUri);

        const server = http.createServer(async (req, res) => {
            try {
                if (req.url.indexOf(redirectUrl.pathname) > -1) {
                    const qs = new url.URL(req.url, `http://localhost:${port}`).searchParams;
                    const code = qs.get('code');
                    res.end('Authentication successful! Please return to the console.');
                    server.destroy();

                    if (code) {
                        const { tokens } = await oAuth2Client.getToken(code);
                        oAuth2Client.setCredentials(tokens);
                        fs.writeFileSync(tokenPath, JSON.stringify(tokens));
                        console.log('Token stored to', tokenPath);
                        resolve(oAuth2Client);
                    } else {
                        reject(new Error("No code found in response"));
                    }
                }
            } catch (e) {
                reject(e);
            }
        });

        const connections = new Set();
        server.on('connection', (conn) => {
            connections.add(conn);
            conn.on('close', () => connections.delete(conn));
        });

        server.destroy = () => {
            for (const conn of connections) {
                conn.destroy();
            }
            server.close();
        };

        server.listen(port, () => {
            console.log(`Listening for authorization code on port ${port}...`);
        });
    });
}

// ── GSC Data fetch logic ───────────────────────────────────────────────────
async function fetchGscData(service, siteUrl, days = LOOKBACK_DAYS) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const formatDate = (date) => date.toISOString().split('T')[0];

    const body = {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensions: ['query', 'page'],
        rowLimit: 5000,
        startRow: 0,
    };

    const response = await service.searchanalytics.query({
        siteUrl: siteUrl,
        requestBody: body,
    });

    return response.data.rows || [];
}

// ── Main analysis ────────────────────────────────────────────────────────────
async function runGapAnalysis() {
    const siteUrl = process.env.GSC_SITE_URL;
    if (!siteUrl) {
        throw new Error('GSC_SITE_URL not set in .env file');
    }

    console.log(`🔍 Connecting to Google Search Console for ${siteUrl}...`);
    const service = await getGscService();

    console.log(`📊 Fetching ${LOOKBACK_DAYS}-day ranking data...`);
    const rows = await fetchGscData(service, siteUrl, LOOKBACK_DAYS);

    if (!rows || rows.length === 0) {
        console.log('⚠️  No data returned from GSC. Check your site URL and permissions.');
        return;
    }

    console.log(`✅ Retrieved ${rows.length} keywords. Identifying gap zone (positions ${MIN_POSITION}–${MAX_POSITION})...`);

    const gapZone = [];
    for (const row of rows) {
        const position = row.position || 0;
        const impressions = row.impressions || 0;
        const clicks = row.clicks || 0;
        const ctr = row.ctr || 0;
        const query = row.keys[0];
        const page = row.keys[1];

        let pathname = '';
        try {
            pathname = new URL(page).pathname;
        } catch (e) {
            pathname = '';
        }

        const isReportPage = pathname.startsWith('/reports/') || /^\/[a-z-]+\/reports\//i.test(pathname);

        if (position >= MIN_POSITION && position <= MAX_POSITION && impressions >= 1 && isReportPage) {
            gapZone.push({
                keyword: query,
                page_url: page,
                impressions: Math.round(impressions),
                position: Math.round(position * 10) / 10,
                clicks: Math.round(clicks),
                ctr: Math.round(ctr * 1000) / 10,
            });
        }
    }

    gapZone.sort((a, b) => b.impressions - a.impressions);

    console.log(`🎯 Found ${gapZone.length} gap zone keywords.`);

    // ── Save JSON (for dashboard) ─────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const reportsDir = path.resolve('reports');

    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const jsonPath = path.join(reportsDir, `gap-analysis-${today}.json`);
    const totalImpressions = rows.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const totalClicks = rows.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const avgPosition = rows.length > 0 ? (rows.reduce((sum, r) => sum + (r.position || 0), 0) / rows.length) : 0;

    const outputData = {
        date: today,
        site_url: siteUrl,
        total_gap_keywords: gapZone.length,
        top_opportunity: gapZone.length > 0 ? gapZone[0] : null,
        keywords: gapZone,
        kpis: {
            total_impressions: totalImpressions,
            gap_zone_count: gapZone.length,
            avg_position: Math.round(avgPosition * 10) / 10,
            total_clicks: totalClicks,
        },
    };

    fs.writeFileSync(jsonPath, JSON.stringify(outputData, null, 2));

    console.log(`\n✅ Report saved:`);
    console.log(`   ${jsonPath}`);

    if (gapZone.length > 0) {
        console.log(`\n📋 Top opportunity: "${gapZone[0].keyword}" at position ${gapZone[0].position}`);
    } else {
        console.log(`\n📋 No gap zone keywords found. Your keywords may all be outside positions ${MIN_POSITION}–${MAX_POSITION} or below 50 impressions.`);
    }

    return outputData;
}

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runGapAnalysis().catch((err) => {
        console.error("❌ Error running gap analysis:", err);
        process.exit(1);
    });
}
