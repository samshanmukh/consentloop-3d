import assert from "node:assert/strict";
import test from "node:test";

import { createDeepgramTokenHandler } from "../worker/deepgram-token";

const endpoint = "https://consentloop.example/api/deepgram-token";

function browserRequest(
  headers: Record<string, string> = {},
  method = "GET",
): Request {
  return new Request(endpoint, {
    method,
    headers: {
      "CF-Connecting-IP": "203.0.113.10",
      Origin: "https://consentloop.example",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
  });
}

test("returns only a short-lived Deepgram grant token to same-origin callers", async () => {
  let upstreamCalls = 0;
  const handler = createDeepgramTokenHandler({
    fetchImpl: async (input, init) => {
      upstreamCalls += 1;
      assert.equal(input, "https://api.deepgram.com/v1/auth/grant");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Token server-secret");
      assert.deepEqual(JSON.parse(String(init?.body)), { ttl_seconds: 60 });
      return Response.json({ access_token: "temporary-browser-token", expires_in: 60 });
    },
  });

  const response = await handler(browserRequest(), {
    DEEPGRAM_API_KEY: " server-secret ",
  });

  assert.equal(upstreamCalls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal(await response.text(), "temporary-browser-token");
});

test("rejects cross-origin and cross-site browser requests before granting a token", async () => {
  let upstreamCalls = 0;
  const handler = createDeepgramTokenHandler({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return Response.json({ access_token: "should-not-be-created" });
    },
  });

  const crossOrigin = await handler(
    browserRequest({
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    }),
    { DEEPGRAM_API_KEY: "server-secret" },
  );
  assert.equal(crossOrigin.status, 403);

  const siblingOrigin = await handler(
    browserRequest({ "Sec-Fetch-Site": "same-site" }),
    { DEEPGRAM_API_KEY: "server-secret" },
  );
  assert.equal(siblingOrigin.status, 403);
  assert.equal(upstreamCalls, 0);
});

test("returns sanitized configuration and upstream errors", async () => {
  const handler = createDeepgramTokenHandler({
    fetchImpl: async () =>
      new Response("upstream diagnostic containing sensitive details", {
        status: 401,
      }),
  });

  const unconfigured = await handler(browserRequest(), {});
  assert.equal(unconfigured.status, 503);
  assert.doesNotMatch(await unconfigured.text(), /DEEPGRAM_API_KEY|server-secret/);

  const upstreamFailure = await handler(browserRequest(), {
    DEEPGRAM_API_KEY: "server-secret",
  });
  const body = await upstreamFailure.text();
  assert.equal(upstreamFailure.status, 502);
  assert.doesNotMatch(body, /upstream diagnostic|server-secret/);
  assert.match(upstreamFailure.headers.get("Cache-Control") ?? "", /no-store/);
});

test("rate-limits grants per Cloudflare client IP within an isolate", async () => {
  let upstreamCalls = 0;
  const handler = createDeepgramTokenHandler({
    fetchImpl: async () => {
      upstreamCalls += 1;
      return Response.json({ access_token: `token-${upstreamCalls}` });
    },
    now: () => 1_000,
    rateLimit: 2,
    rateWindowMs: 30_000,
  });
  const env = { DEEPGRAM_API_KEY: "server-secret" };

  assert.equal((await handler(browserRequest(), env)).status, 200);
  assert.equal((await handler(browserRequest(), env)).status, 200);

  const limited = await handler(browserRequest(), env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "30");
  assert.equal(upstreamCalls, 2);
});

test("allows only GET requests", async () => {
  const handler = createDeepgramTokenHandler({
    fetchImpl: async () => Response.json({ access_token: "unused" }),
  });

  const response = await handler(browserRequest({}, "POST"), {
    DEEPGRAM_API_KEY: "server-secret",
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});
