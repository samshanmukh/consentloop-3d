import assert from "node:assert/strict";
import test from "node:test";

import {
  consentGuideAgentConfig,
  consentGuidePrompt,
  createConsentVoiceSessionConfig,
  createDeepgramTokenFactory,
  normalizeVoiceToolCall,
  voiceToolDefinitions,
  voiceToolNames,
} from "../app/lib/voice-agent";

function wireCall(
  name: string,
  args: Record<string, unknown>,
  overrides: { id?: string; client_side?: boolean; raw?: string } = {},
) {
  return {
    id: overrides.id ?? "call-1",
    name,
    arguments: overrides.raw ?? JSON.stringify(args),
    client_side: overrides.client_side ?? true,
  };
}

test("agent configuration is grounded and exposes client-side tools only", () => {
  assert.deepEqual(
    voiceToolDefinitions.map((tool) => tool.name),
    voiceToolNames,
  );
  assert.ok(voiceToolDefinitions.every((tool) => !("endpoint" in tool)));
  assert.match(consentGuidePrompt, /Jordan Lee/);
  assert.match(consentGuidePrompt, /\$2,045–\$3,120/);
  assert.match(consentGuidePrompt, /Do not diagnose/);
  assert.match(consentGuidePrompt, /preference is not consent/i);
  assert.match(consentGuidePrompt, /Present every available option with equal weight/);
  assert.equal(consentGuideAgentConfig.listen.provider.model, "flux-general-en");
  assert.equal(consentGuideAgentConfig.speak.provider.model, "aura-2-thalia-en");
});

test("tool calls normalize into a validated UI command union", () => {
  assert.deepEqual(
    normalizeVoiceToolCall(
      wireCall("focus_anatomy", { target: "tear", camera: "zoom_in" }),
    ),
    {
      ok: true,
      call: {
        id: "call-1",
        name: "focus_anatomy",
        arguments: { target: "tear", camera: "zoom_in" },
      },
    },
  );

  assert.deepEqual(
    normalizeVoiceToolCall(
      wireCall("open_consent_section", { section: "costs" }),
    ),
    {
      ok: true,
      call: {
        id: "call-1",
        name: "open_consent_section",
        arguments: { section: "costs" },
      },
    },
  );

  assert.deepEqual(
    normalizeVoiceToolCall(
      wireCall("request_human", {
        destination: "clinician",
        reason: "I still have a question",
        confirmed_by_user: true,
      }),
    ),
    {
      ok: true,
      call: {
        id: "call-1",
        name: "request_human",
        arguments: {
          destination: "clinician",
          reason: "I still have a question",
          confirmed_by_user: true,
        },
      },
    },
  );
});

test("tool calls reject malformed, ungrounded, or unconfirmed actions", () => {
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("focus_anatomy", {}, { raw: "not json" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("focus_anatomy", { target: "brain" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("focus_option", { option: "trim", selected: true }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("request_human", {
        destination: "clinician",
        confirmed_by_user: false,
      }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("open_consent_section", { section: "review" }, { client_side: false }),
    ).ok,
    false,
  );
});

test("token factory requests a same-origin, uncached, short-lived credential", async () => {
  let requestInput: RequestInfo | URL | undefined;
  let requestInit: RequestInit | undefined;
  const factory = createDeepgramTokenFactory(
    "/api/deepgram-token",
    async (input, init) => {
      requestInput = input;
      requestInit = init;
      return new Response("temporary-token\n", { status: 200 });
    },
  );

  assert.equal(await factory(), "temporary-token");
  assert.equal(requestInput, "/api/deepgram-token");
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.credentials, "same-origin");

  const sessionConfig = createConsentVoiceSessionConfig(factory);
  assert.ok("tokenFactory" in sessionConfig.auth);
  assert.equal(sessionConfig.audio?.input?.sampleRate, 16_000);
  assert.equal(sessionConfig.audio?.output?.sampleRate, 24_000);
});

test("token factory does not accept failed or empty responses", async () => {
  const failed = createDeepgramTokenFactory(
    "/api/deepgram-token",
    async () => new Response("unavailable", { status: 503 }),
  );
  await assert.rejects(failed(), /voice service is unavailable/i);

  const empty = createDeepgramTokenFactory(
    "/api/deepgram-token",
    async () => new Response("   ", { status: 200 }),
  );
  await assert.rejects(empty(), /was empty/);
});
