// Cloudflare Worker: Piped API CORS Proxy for KaraOK
// Deploy this to Cloudflare Workers (free tier: 100K requests/day)
//
// This worker proxies requests to Piped API instances and adds CORS headers,
// solving the browser CORS restriction that blocks direct Piped API calls.

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.in.projectsegfau.lt",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
  "https://api.piped.yt",
  "https://pipedapi.drgns.space",
  "https://pipedapi.darkness.services"
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request) {
    // Handle preflight OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Only allow GET requests
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Route: /search?q=...&filter=videos
    if (path === "/search") {
      const query = url.searchParams.get("q");
      const filter = url.searchParams.get("filter") || "videos";
      if (!query) {
        return jsonResponse({ error: "Missing 'q' parameter" }, 400);
      }
      return proxyToFirstAvailable(
        (instance) => `${instance}/search?q=${encodeURIComponent(query)}&filter=${filter}`
      );
    }

    // Route: /streams/:videoId
    if (path.startsWith("/streams/")) {
      const videoId = path.replace("/streams/", "");
      if (!videoId || videoId.length < 5) {
        return jsonResponse({ error: "Invalid video ID" }, 400);
      }
      return proxyToFirstAvailable(
        (instance) => `${instance}/streams/${videoId}`
      );
    }

    // Health check
    if (path === "/" || path === "/health") {
      return jsonResponse({ status: "ok", instances: PIPED_INSTANCES.length });
    }

    return jsonResponse({ error: "Not found. Use /search?q=... or /streams/:videoId" }, 404);
  }
};

async function proxyToFirstAvailable(buildUrl) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const targetUrl = buildUrl(instance);
      const response = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "KaraOK-Proxy/1.0" }
      });

      if (!response.ok) continue;

      const data = await response.text();
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    } catch {
      continue;
    }
  }

  return jsonResponse({ error: "All Piped instances unavailable" }, 502);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}
