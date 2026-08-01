const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const DEFAULT_TOKEN_TTL_SECONDS = 60;
const DEFAULT_RATE_LIMIT = 6;
const DEFAULT_RATE_WINDOW_MS = 60_000;

export interface DeepgramTokenEnv {
  DEEPGRAM_API_KEY?: string;
}

interface RateLimitBucket {
  count: number;
  windowStartedAt: number;
}

interface DeepgramTokenHandlerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  rateLimit?: number;
  rateWindowMs?: number;
  tokenTtlSeconds?: number;
}

type DeepgramTokenHandler = (
  request: Request,
  env: DeepgramTokenEnv,
) => Promise<Response>;

function errorResponse(
  status: number,
  error: string,
  extraHeaders?: HeadersInit,
): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders,
      },
    },
  );
}

function isSameOriginBrowserRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get("Origin");

  if (originHeader !== null) {
    try {
      if (new URL(originHeader).origin !== requestOrigin) {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Modern browsers provide this header. Requiring `same-origin` whenever it
  // is present blocks cross-site and same-site sibling origins, while keeping
  // the endpoint usable by non-browser tooling that omits Fetch Metadata.
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  return fetchSite === undefined || fetchSite === "same-origin";
}

function clientIdentifier(request: Request): string {
  const cloudflareIp = request.headers.get("CF-Connecting-IP")?.trim();
  return cloudflareIp && cloudflareIp.length <= 64 ? cloudflareIp : "unknown";
}

function retryAfterSeconds(bucket: RateLimitBucket, now: number, windowMs: number): string {
  return String(Math.max(1, Math.ceil((bucket.windowStartedAt + windowMs - now) / 1_000)));
}

export function createDeepgramTokenHandler(
  options: DeepgramTokenHandlerOptions = {},
): DeepgramTokenHandler {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
  const tokenTtlSeconds = options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  const rateLimitBuckets = new Map<string, RateLimitBucket>();

  return async (request, env) => {
    if (request.method !== "GET") {
      return errorResponse(405, "Method not allowed", { Allow: "GET" });
    }

    if (!isSameOriginBrowserRequest(request)) {
      return errorResponse(403, "Request origin is not allowed");
    }

    const apiKey = env.DEEPGRAM_API_KEY?.trim();
    if (!apiKey) {
      return errorResponse(503, "Voice service is not configured");
    }

    const currentTime = now();
    const clientId = clientIdentifier(request);
    let bucket = rateLimitBuckets.get(clientId);

    if (!bucket || currentTime - bucket.windowStartedAt >= rateWindowMs) {
      bucket = { count: 0, windowStartedAt: currentTime };
      rateLimitBuckets.set(clientId, bucket);
    }

    if (bucket.count >= rateLimit) {
      return errorResponse(429, "Too many token requests", {
        "Retry-After": retryAfterSeconds(bucket, currentTime, rateWindowMs),
      });
    }

    bucket.count += 1;

    // Prevent an unusually busy isolate from retaining expired client buckets.
    if (rateLimitBuckets.size > 512) {
      for (const [key, candidate] of rateLimitBuckets) {
        if (currentTime - candidate.windowStartedAt >= rateWindowMs) {
          rateLimitBuckets.delete(key);
        }
      }
    }

    let grantResponse: Response;
    try {
      grantResponse = await fetchImpl(DEEPGRAM_GRANT_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl_seconds: tokenTtlSeconds }),
      });
    } catch {
      return errorResponse(502, "Voice service is temporarily unavailable");
    }

    if (!grantResponse.ok) {
      return errorResponse(502, "Voice service is temporarily unavailable");
    }

    let grant: unknown;
    try {
      grant = await grantResponse.json();
    } catch {
      return errorResponse(502, "Voice service returned an invalid response");
    }

    const accessToken =
      typeof grant === "object" &&
      grant !== null &&
      "access_token" in grant &&
      typeof grant.access_token === "string"
        ? grant.access_token.trim()
        : "";

    if (!accessToken) {
      return errorResponse(502, "Voice service returned an invalid response");
    }

    return new Response(accessToken, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "text/plain; charset=utf-8",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

export const handleDeepgramTokenRequest = createDeepgramTokenHandler();
