import dotenv from "dotenv";
import http from "node:http";
import { publishNewReport } from "./scripts/publish_new_report.js";
import { startMinuteDispatcher, triggerSitemapGeneration } from "./scripts/cron_worker.js";

dotenv.config();

const PORT = parseInt(process.env.API_PORT || process.env.PORT || "4000", 10);
const API_SECRET =
  process.env.API_SECRET_KEY ||
  process.env.DASHBOARD_API_KEY ||
  "seo-secret-key-2026";

// Helper to send JSON responses with CORS headers
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  });
  res.end(JSON.stringify(data));
}

// Simple request body parser
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      // 1MB max body size
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request entity too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON format"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // 1. Handle CORS Preflight (OPTIONS request from browser dashboard)
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // 2. Health check route
  if (
    req.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/health")
  ) {
    return sendJSON(res, 200, {
      status: "ok",
      uptime: `${Math.floor(process.uptime())}s`,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Publish Endpoint
  if (req.method === "POST" && url.pathname === "/api/publish") {
    // Authenticate request
    const authHeader = req.headers["authorization"];
    const xApiKey = req.headers["x-api-key"];
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : xApiKey;

    if (API_SECRET && token !== API_SECRET) {
      return sendJSON(res, 401, {
        error: "Unauthorized",
        message:
          "Invalid or missing API key in Authorization or X-API-Key header.",
      });
    }

    try {
      const body = await parseBody(req);
      const prefix = (body.prefix || "dim").toLowerCase();
      const id = body.id !== undefined && body.id !== null ? body.id : null;
      const limit = parseInt(body.limit, 10) || 1;
      const rawSegments = body.segments;
      const segments = Array.isArray(rawSegments)
        ? rawSegments.map((s) => String(s).trim()).filter(Boolean)
        : null;

      // Respond immediately with 202 Accepted so the external dashboard doesn't time out
      sendJSON(res, 202, {
        success: true,
        message: id
          ? `Publish job accepted for ID: ${id} (prefix: ${prefix}). Running in background.`
          : `Publish job accepted for prefix: ${prefix} (limit: ${limit}). Running in background.`,
        data: {
          prefix,
          id,
          limit: id ? 1 : limit,
          ...(segments && prefix === "imd" ? { segments } : {}),
          acceptedAt: new Date().toISOString(),
        },
      });

      // Trigger publishNewReport in background asynchronously
      (async () => {
        console.log(
          `\n🔔 [API Trigger] Received request from dashboard: prefix=${prefix}, id=${id || "auto"}, limit=${limit}${segments ? `, segments=${JSON.stringify(segments)}` : ""}`,
        );
        try {
          await publishNewReport(prefix, limit, id, segments);
          console.log(
            `✅ [API Trigger] Finished publish job: prefix=${prefix}, id=${id || "auto"}`,
          );
        } catch (err) {
          console.error(
            `❌ [API Trigger] Error during publish job:`,
            err.message || err,
          );
        }
      })();
    } catch (err) {
      return sendJSON(res, 400, { error: "Bad Request", message: err.message });
    }
    return;
  }

  // 4. Sitemap Generation Endpoint (Manual Trigger)
  if (req.method === "POST" && url.pathname === "/api/sitemap/generate") {
    // Authenticate request
    const authHeader = req.headers["authorization"];
    const xApiKey = req.headers["x-api-key"];
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : xApiKey;

    if (API_SECRET && token !== API_SECRET) {
      return sendJSON(res, 401, {
        error: "Unauthorized",
        message:
          "Invalid or missing API key in Authorization or X-API-Key header.",
      });
    }

    sendJSON(res, 202, {
      success: true,
      message: "Sitemap generation triggered. Running in background.",
      acceptedAt: new Date().toISOString(),
    });

    (async () => {
      try {
        await triggerSitemapGeneration();
      } catch (err) {
        console.error("❌ Error in manual sitemap trigger:", err.message || err);
      }
    })();
    return;
  }

  // 5. 404 for unknown routes
  sendJSON(res, 404, { error: "Not Found", path: url.pathname });
});

server.listen(PORT, () => {
  console.log(
    `\n🚀 Publishing Trigger Server running at http://localhost:${PORT}`,
  );
  console.log(`   Endpoint: POST http://localhost:${PORT}/api/publish`);
  console.log(`   Endpoint: POST http://localhost:${PORT}/api/sitemap/generate`);
  console.log(`   Health:   GET  http://localhost:${PORT}/health`);
  console.log(
    `   Auth Key: ${API_SECRET ? "Configured (" + API_SECRET.slice(0, 4) + "***)" : "None"}\n`,
  );

  const isCronEnabled = process.env.ENABLE_CRON !== "false";
  if (isCronEnabled) {
    console.log("⏰ Starting embedded hourly publisher cron daemon...");
    startMinuteDispatcher();
  } else {
    console.log("⏸️ Embedded cron is disabled (ENABLE_CRON=false).");
  }
});
