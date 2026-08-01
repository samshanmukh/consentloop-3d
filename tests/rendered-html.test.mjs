import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ConsentLoop patient experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Patient consent journey · ConsentLoop 3D<\/title>/i);
  assert.match(html, /ConsentLoop/);
  assert.match(html, /Make the decision clear/);
  assert.match(html, /Synthetic demo/);
  assert.match(html, /right meniscus tear/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("renders accessible journey navigation and non-speech controls", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /aria-label="Consent journey"/);
  assert.match(html, /Interactive 3D knee anatomy/);
  assert.match(html, /Start guided session/);
  assert.match(html, /Compare options/);
  assert.match(html, /Ask for help/);
});

