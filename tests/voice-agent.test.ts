import assert from "node:assert/strict";
import test from "node:test";

import { getDemoAnswer } from "../app/lib/demo-data";

import {
  consentGuideAgentConfig,
  consentGuidePrompt,
  createConsentVoiceSessionConfig,
  createDeepgramTokenFactory,
  isVisualizationVoiceToolCall,
  normalizeVoiceToolCall,
  voiceToolToVisualizationCommand,
  voiceToolDefinitions,
  voiceToolNames,
} from "../app/lib/voice-agent";

test("browser demo answers stay medically bounded", () => {
  assert.match(getDemoAnswer("Can stem cells regrow it?"), /investigational/i);
  assert.match(getDemoAnswer("Repair versus trimming"), /surgeon decides/i);
});

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
  assert.match(consentGuidePrompt, /distinguish established care from investigational care/i);
  assert.match(consentGuidePrompt, /Never imply that stem-cell or regenerative injections are FDA-approved/i);
  assert.match(consentGuidePrompt, /educational illustration/i);
  assert.match(consentGuidePrompt, /WHOLE-KNEE MISCONCEPTION SEQUENCE/);
  assert.match(
    consentGuidePrompt,
    /misconception-comparison[\s\S]*patient-teachback/,
  );
  assert.match(consentGuidePrompt, /cannot update a clinical record/i);
  assert.equal(consentGuideAgentConfig.listen.provider.model, "flux-general-en");
  assert.equal(consentGuideAgentConfig.speak.provider.model, "aura-2-thalia-en");
});

function visualizationCommand(
  name: string,
  args: Record<string, unknown>,
) {
  const normalized = normalizeVoiceToolCall(wireCall(name, args));
  if (!normalized.ok) {
    assert.fail(`Expected ${name} to normalize: ${normalized.error}`);
  }
  if (!isVisualizationVoiceToolCall(normalized.call)) {
    assert.fail(`Expected ${name} to be a visualization tool`);
  }
  return voiceToolToVisualizationCommand(normalized.call);
}

test("all seven visual tool calls map to exact high-level commands", () => {
  assert.deepEqual(
    visualizationCommand("show_body_overview", { view: "back" }),
    { type: "SHOW_BODY_OVERVIEW", view: "back" },
  );
  assert.deepEqual(
    visualizationCommand("show_body_overview", {}),
    { type: "SHOW_BODY_OVERVIEW" },
  );
  assert.deepEqual(
    visualizationCommand("focus_body_region", { regionId: "right-knee" }),
    { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
  );
  assert.deepEqual(
    visualizationCommand("enter_procedure", { procedureId: "knee-arthroscopy" }),
    { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
  );
  assert.deepEqual(
    visualizationCommand("play_procedure_step", {
      procedureId: "knee-arthroscopy",
      stepId: "misconception-comparison",
    }),
    {
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId: "misconception-comparison",
    },
  );
  assert.deepEqual(
    visualizationCommand("highlight_structure", {
      structureId: "treated-meniscus",
      color: "orange",
    }),
    {
      type: "HIGHLIGHT_STRUCTURE",
      structureId: "treated-meniscus",
      color: "orange",
    },
  );
  assert.deepEqual(
    visualizationCommand("set_visual_mode", { mode: "isolated" }),
    { type: "SET_VISUAL_MODE", mode: "isolated" },
  );
  assert.deepEqual(
    visualizationCommand("return_to_overview", {}),
    { type: "RETURN_TO_OVERVIEW" },
  );
});

test("nonvisual tool calls retain strict normalization", () => {
  assert.deepEqual(
    normalizeVoiceToolCall(
      wireCall("focus_option", { option: "regenerative" }),
    ),
    {
      ok: true,
      call: {
        id: "call-1",
        name: "focus_option",
        arguments: { option: "regenerative" },
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
      wireCall("show_body_overview", {}, { raw: "not json" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("show_body_overview", { view: "inside" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("focus_body_region", { regionId: "brain" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("enter_procedure", { procedureId: "brain-surgery" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("play_procedure_step", {
        procedureId: "knee-arthroscopy",
        stepId: "invented-step",
      }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("highlight_structure", {
        structureId: "unknown-structure",
        color: "orange",
      }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("highlight_structure", {
        structureId: "whole-knee",
        color: "purple",
      }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("set_visual_mode", { mode: "wireframe" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("return_to_overview", { view: "front" }),
    ).ok,
    false,
  );
  assert.equal(
    normalizeVoiceToolCall(
      wireCall("focus_anatomy", { target: "tear" }),
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
