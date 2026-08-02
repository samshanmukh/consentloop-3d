import assert from "node:assert/strict";
import test from "node:test";

import {
  consentGuideAgentConfig,
  consentGuidePrompt,
  createConsentVoiceSessionConfig,
  createDeepgramTokenFactory,
  createVoiceNarrationBarrier,
  getCurrentVisualContext,
  getNextApprovedVoiceAction,
  getVoiceFunctionProtocolErrors,
  getVoiceNarrationCue,
  getVoiceVisualizationSequenceError,
  isFullProcedureWalkthroughRequest,
  isVisualizationVoiceToolCall,
  kneeArthroscopyVoiceWalkthrough,
  normalizeVoiceToolCall,
  planVoiceVisualizationCommands,
  recoverLiteralVisualizationToolCall,
  reduceVoiceNarrationBarrier,
  serializeVoiceToolResult,
  voiceToolToVisualizationCommand,
  voiceToolDefinitions,
  voiceToolNames,
} from "../app/lib/voice-agent";
import {
  getProcedureStep,
  procedureStepIds,
} from "../app/lib/procedure-visualization";
import { initialVisualizationSnapshot } from "../app/lib/visualization-controller";

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
  assert.match(consentGuidePrompt, /current consent experience/i);
  assert.match(consentGuidePrompt, /information prepared for your consent session/i);
  assert.doesNotMatch(
    consentGuidePrompt,
    /\bdemo\b|\bsynthetic\b|educational illustration|not patient-specific|not your actual record/i,
  );
  assert.match(consentGuidePrompt, /WHOLE-KNEE MISCONCEPTION SEQUENCE/);
  assert.match(
    consentGuidePrompt,
    /misconception-comparison[\s\S]*patient-teachback/,
  );
  assert.match(consentGuidePrompt, /whole person first, blue right-knee highlight second, camera zoom\/detail third/i);
  assert.match(consentGuidePrompt, /exactly ONE visual function per function-call request/);
  assert.match(consentGuidePrompt, /native function calling only/i);
  assert.doesNotMatch(consentGuidePrompt, /show_body_overview \{\"view\"/);
  assert.match(consentGuidePrompt, /settled\.transitionCompleted=true/);
  assert.match(consentGuidePrompt, /Visual requests are destination-based/);
  assert.match(consentGuidePrompt, /safely restore the required whole-body/);
  assert.match(consentGuidePrompt, /ALWAYS call inspect_current_visual before answering/);
  assert.match(consentGuidePrompt, /yellow part/);
  assert.match(consentGuidePrompt, /misconception comparison is optional/i);
  assert.match(consentGuidePrompt, /cannot update a clinical record/i);
  assert.equal(consentGuideAgentConfig.listen.provider.model, "flux-general-en");
  assert.equal(consentGuideAgentConfig.speak.provider.model, "aura-2-thalia-en");
  assert.equal(consentGuideAgentConfig.think.provider.model, "gpt-5.4-mini");
  assert.doesNotMatch(
    getProcedureStep("knee-arthroscopy", "important-risk")?.narration ?? "",
    /educational|demo|patient-specific prediction/i,
  );
});

test("literal visualization pseudo-calls are recovered without widening tool access", () => {
  const recovered = recoverLiteralVisualizationToolCall(
    '{show_body_overview {"view":"three-quarter"}}',
    "literal-1",
  );
  assert.equal(recovered?.ok, true);
  if (!recovered?.ok) assert.fail("Expected the screenshot pseudo-call to recover");
  assert.equal(recovered.call.name, "show_body_overview");
  assert.deepEqual(recovered.call.arguments, { view: "three-quarter" });

  assert.equal(
    recoverLiteralVisualizationToolCall(
      '{request_human {"destination":"clinician","confirmed_by_user":true}}',
    ),
    null,
  );
  assert.equal(
    recoverLiteralVisualizationToolCall("Please show the knee when ready."),
    null,
  );

  const invalid = recoverLiteralVisualizationToolCall(
    '{focus_body_region {"regionId":"left-knee"}}',
  );
  assert.equal(invalid?.ok, false);
});

test("only explicit full-procedure requests opt into automatic walkthrough progression", () => {
  assert.equal(isFullProcedureWalkthroughRequest("Walk me through it"), true);
  assert.equal(
    isFullProcedureWalkthroughRequest("Walk me through the whole knee procedure"),
    true,
  );
  assert.equal(isFullProcedureWalkthroughRequest("Resume the walkthrough"), true);
  assert.equal(isFullProcedureWalkthroughRequest("What is this yellow part?"), false);
  assert.equal(isFullProcedureWalkthroughRequest("Show the damaged part"), false);
});

test("guided walkthrough highlights the knee before zooming and advances one configured step at a time", () => {
  assert.deepEqual(
    kneeArthroscopyVoiceWalkthrough.slice(0, 3).map(({ stepId, toolName }) => ({
      stepId,
      toolName,
    })),
    [
      { stepId: "body-overview", toolName: "show_body_overview" },
      { stepId: "affected-knee", toolName: "focus_body_region" },
      { stepId: "normal-anatomy", toolName: "enter_procedure" },
    ],
  );
  assert.deepEqual(
    kneeArthroscopyVoiceWalkthrough.map((action) => action.stepId),
    procedureStepIds.filter(
      (stepId) =>
        stepId !== "misconception-comparison" && stepId !== "completion",
    ),
  );
  assert.equal(
    kneeArthroscopyVoiceWalkthrough.some(
      (action) => action.stepId === "misconception-comparison",
    ),
    false,
  );
  assert.ok(
    kneeArthroscopyVoiceWalkthrough
      .slice(3)
      .every((action) => action.toolName === "play_procedure_step"),
  );
});

test("voice destinations recover their visual prerequisites while completion stays protected", () => {
  const normalizeVisual = (name: string, args: Record<string, unknown>) => {
    const normalized = normalizeVoiceToolCall(wireCall(name, args));
    assert.equal(normalized.ok, true);
    if (!normalized.ok || !isVisualizationVoiceToolCall(normalized.call)) {
      assert.fail(`Expected ${name} to be a visual call`);
    }
    return normalized.call;
  };
  const procedureContext = {
    viewMode: "knee" as const,
    visualState: "procedure" as const,
    stepId: "normal-anatomy",
  };

  const directStep = planVoiceVisualizationCommands(
    normalizeVisual("play_procedure_step", {
      procedureId: "knee-arthroscopy",
      stepId: "access-point",
    }),
    procedureContext,
  );
  assert.equal(directStep.ok, true);
  if (!directStep.ok) assert.fail("Expected a direct visual plan");
  assert.deepEqual(directStep.commands, [
    {
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId: "access-point",
    },
  ]);
  assert.equal(directStep.preparationApplied, false);

  const fromNoScene = planVoiceVisualizationCommands(
    normalizeVisual("play_procedure_step", {
      procedureId: "knee-arthroscopy",
      stepId: "damaged-structure",
    }),
    null,
  );
  assert.equal(fromNoScene.ok, true);
  if (!fromNoScene.ok) assert.fail("Expected a recovered visual plan");
  assert.deepEqual(fromNoScene.commands.map((command) => command.type), [
    "SHOW_BODY_OVERVIEW",
    "FOCUS_BODY_REGION",
    "ENTER_PROCEDURE",
    "PLAY_PROCEDURE_STEP",
  ]);
  assert.equal(fromNoScene.preparationApplied, true);

  assert.match(
    getVoiceVisualizationSequenceError(
      normalizeVisual("play_procedure_step", {
        procedureId: "knee-arthroscopy",
        stepId: "completion",
      }),
      { ...procedureContext, visualState: "asking-teachback", stepId: "patient-teachback" },
    ) ?? "",
    /controlled by the application/i,
  );

  const firstStepAlias = planVoiceVisualizationCommands(
    normalizeVisual("play_procedure_step", {
      procedureId: "knee-arthroscopy",
      stepId: "affected-knee",
    }),
    procedureContext,
  );
  assert.equal(firstStepAlias.ok, true);
  if (!firstStepAlias.ok) assert.fail("Expected an aliased focus plan");
  assert.deepEqual(firstStepAlias.commands.map((command) => command.type), [
    "SHOW_BODY_OVERVIEW",
    "FOCUS_BODY_REGION",
  ]);
});

test("voice focus regression returns from knee detail and highlights the right knee", () => {
  const normalizeVisual = (name: string, args: Record<string, unknown>) => {
    const normalized = normalizeVoiceToolCall(wireCall(name, args));
    assert.equal(normalized.ok, true);
    if (!normalized.ok || !isVisualizationVoiceToolCall(normalized.call)) {
      assert.fail(`Expected ${name} to be a visual call`);
    }
    return normalized.call;
  };

  const focusKnee = normalizeVisual("focus_body_region", {
    regionId: "right-knee",
  });
  const focusPlan = planVoiceVisualizationCommands(focusKnee, {
    viewMode: "knee",
    visualState: "procedure",
    stepId: "damaged-structure",
    procedureId: "knee-arthroscopy",
    activeRegionId: "right-knee",
  });
  assert.equal(focusPlan.ok, true);
  if (!focusPlan.ok) assert.fail("Expected a recovered focus plan");
  assert.deepEqual(focusPlan.commands, [
    { type: "SHOW_BODY_OVERVIEW", view: "three-quarter" },
    { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
  ]);
  assert.equal(focusPlan.preparationApplied, true);
  assert.equal(
    getVoiceVisualizationSequenceError(focusKnee, {
      viewMode: "knee",
      visualState: "procedure",
      stepId: "damaged-structure",
    }),
    undefined,
  );
});

test("misconception clarification auto-enters detail and preserves teach-back control", () => {
  const normalizeVisual = (name: string, args: Record<string, unknown>) => {
    const normalized = normalizeVoiceToolCall(wireCall(name, args));
    assert.equal(normalized.ok, true);
    if (!normalized.ok || !isVisualizationVoiceToolCall(normalized.call)) {
      assert.fail(`Expected ${name} to be a visual call`);
    }
    return normalized.call;
  };

  const showMisconception = normalizeVisual("play_procedure_step", {
    procedureId: "knee-arthroscopy",
    stepId: "misconception-comparison",
  });
  const branchPlan = planVoiceVisualizationCommands(showMisconception, {
    viewMode: "body",
    visualState: "overview",
    stepId: "affected-knee",
  });
  assert.equal(branchPlan.ok, true);
  if (!branchPlan.ok) assert.fail("Expected a recovered comparison plan");
  assert.deepEqual(branchPlan.commands.map((command) => command.type), [
    "ENTER_PROCEDURE",
    "PLAY_PROCEDURE_STEP",
  ]);
  assert.match(
    getNextApprovedVoiceAction(showMisconception) ?? "",
    /patient-teachback/,
  );

  const askTeachback = normalizeVisual("play_procedure_step", {
    procedureId: "knee-arthroscopy",
    stepId: "patient-teachback",
  });
  const teachbackPlan = planVoiceVisualizationCommands(askTeachback, {
    viewMode: "knee",
    visualState: "misconception-detected",
    stepId: "misconception-comparison",
  });
  assert.equal(teachbackPlan.ok, true);
  if (!teachbackPlan.ok) assert.fail("Expected a teach-back plan");
  assert.deepEqual(teachbackPlan.commands.map((command) => command.type), [
    "PLAY_PROCEDURE_STEP",
  ]);
  assert.match(
    getVoiceVisualizationSequenceError(
      normalizeVisual("play_procedure_step", {
        procedureId: "knee-arthroscopy",
        stepId: "completion",
      }),
      {
        viewMode: "knee",
        visualState: "asking-teachback",
        stepId: "patient-teachback",
      },
    ) ?? "",
    /controlled by the application/i,
  );
});

test("visual inspection grounds yellow-part, damage, and current-action questions", () => {
  const damaged = getCurrentVisualContext({
    ...initialVisualizationSnapshot,
    visualState: "procedure",
    viewMode: "knee",
    procedureId: "knee-arthroscopy",
    stepId: "damaged-structure",
    stage: "tear",
    target: "tear",
    visualMode: "isolated",
    highlights: [{ structureId: "meniscus-tear", color: "orange" }],
    revision: 4,
  });

  assert.equal(damaged.ready, true);
  assert.equal(damaged.viewMode, "knee");
  assert.equal(damaged.stepTitle, "Damaged meniscus");
  assert.equal(damaged.primaryHighlight?.structureId, "meniscus-tear");
  assert.match(damaged.primaryHighlight?.colorDescription ?? "", /yellow/i);
  assert.match(damaged.primaryHighlight?.whatItIs ?? "", /torn area/i);
  assert.match(damaged.damagedArea, /torn part of the right meniscus/i);
  assert.equal(
    damaged.whatIsHappening,
    getProcedureStep("knee-arthroscopy", "damaged-structure")?.narration,
  );
  assert.match(damaged.careTeamConfirmation, /care team confirms/i);
  assert.doesNotMatch(
    damaged.careTeamConfirmation,
    /educational|not patient-specific|not your actual record/i,
  );
});

test("visual inspection reflects only genuinely visible highlights", () => {
  const overview = getCurrentVisualContext({
    ...initialVisualizationSnapshot,
    visualState: "overview",
    target: "body",
  });
  assert.equal(overview.primaryHighlight, null);
  assert.equal(overview.visibleHighlights.length, 0);

  const focused = getCurrentVisualContext({
    ...initialVisualizationSnapshot,
    visualState: "overview",
    target: "knee",
    stepId: "affected-knee",
  });
  assert.equal(focused.primaryHighlight?.structureId, "whole-knee");
  assert.equal(focused.primaryHighlight?.color, "blue");

  const unavailable = getCurrentVisualContext(null, false);
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.viewerVisible, false);
  assert.equal(unavailable.viewMode, "unavailable");
});

test("misconception comparison reports both whole joint and treated tissue", () => {
  const comparison = getCurrentVisualContext({
    ...initialVisualizationSnapshot,
    visualState: "misconception-detected",
    viewMode: "knee",
    procedureId: "knee-arthroscopy",
    stepId: "misconception-comparison",
    stage: "treatment",
    target: "meniscus",
    visualMode: "isolated",
    highlights: [{ structureId: "treated-meniscus", color: "orange" }],
    comparison: true,
    revision: 9,
  });

  assert.deepEqual(
    comparison.visibleHighlights.map(({ structureId, color }) => ({ structureId, color })),
    [
      { structureId: "whole-knee", color: "red" },
      { structureId: "treated-meniscus", color: "orange" },
    ],
  );
  assert.equal(comparison.primaryHighlight?.structureId, "treated-meniscus");
  assert.equal(comparison.comparisonVisible, true);
});

test("a Deepgram request may execute only one visual transition", () => {
  const errors = getVoiceFunctionProtocolErrors([
    wireCall("show_body_overview", { view: "three-quarter" }),
    wireCall("open_consent_section", { section: "anatomy" }),
    wireCall("focus_body_region", { regionId: "right-knee" }),
    wireCall("enter_procedure", { procedureId: "knee-arthroscopy" }),
  ]);
  assert.equal(errors[0], undefined);
  assert.equal(errors[1], undefined);
  assert.match(errors[2] ?? "", /Only one visual transition/);
  assert.match(errors[3] ?? "", /Narrate the first settled step/);
});

test("the next visual transition waits for audible narration or a patient interruption", () => {
  const awaiting = reduceVoiceNarrationBarrier("ready", "visual-settled");
  assert.equal(awaiting, "awaiting-narration");
  assert.equal(
    reduceVoiceNarrationBarrier(awaiting, "audio-finished"),
    "ready",
  );
  assert.equal(
    reduceVoiceNarrationBarrier(awaiting, "user-interrupted"),
    "ready",
  );
  assert.equal(reduceVoiceNarrationBarrier(awaiting, "reset"), "ready");
});

test("an early visual call remains queued until audible narration finishes", async () => {
  const barrier = createVoiceNarrationBarrier();
  barrier.transition("visual-settled");

  let released = false;
  const waitingCall = barrier.waitUntilReady().then(() => {
    released = true;
  });
  await Promise.resolve();

  assert.equal(barrier.state, "awaiting-narration");
  assert.equal(released, false);

  barrier.transition("audio-finished");
  await waitingCall;

  assert.equal(barrier.state, "ready");
  assert.equal(released, true);
});

test("a patient interruption releases an early queued visual call", async () => {
  const barrier = createVoiceNarrationBarrier();
  barrier.transition("visual-settled");

  const waitingCall = barrier.waitUntilReady();
  barrier.transition("user-interrupted");
  await waitingCall;

  assert.equal(barrier.state, "ready");
});

test("reset releases narration waiters during session disposal", async () => {
  const barrier = createVoiceNarrationBarrier();
  barrier.transition("visual-settled");

  const waitingCalls = [
    barrier.waitUntilReady(),
    barrier.waitUntilReady(),
  ];
  barrier.transition("reset");
  await Promise.all(waitingCalls);

  assert.equal(barrier.state, "ready");
});

test("each walkthrough visual tool returns narration grounded in procedure configuration", () => {
  for (const action of kneeArthroscopyVoiceWalkthrough) {
    const normalized = normalizeVoiceToolCall(wireCall(action.toolName, action.arguments));
    assert.equal(normalized.ok, true);
    if (!normalized.ok || !isVisualizationVoiceToolCall(normalized.call)) continue;
    const cue = getVoiceNarrationCue(normalized.call);
    const configured = getProcedureStep("knee-arthroscopy", action.stepId);
    assert.ok(cue);
    assert.equal(cue.stepId, action.stepId);
    assert.equal(
      cue.text,
      action.stepId === "patient-teachback"
        ? configured?.patientQuestionPrompt
        : configured?.narration,
    );
    assert.equal(cue.speakAfterSettled, true);
  }

  const focus = normalizeVoiceToolCall(
    wireCall("focus_body_region", { regionId: "right-knee" }),
  );
  assert.equal(focus.ok, true);
  if (focus.ok && isVisualizationVoiceToolCall(focus.call)) {
    assert.match(getNextApprovedVoiceAction(focus.call) ?? "", /enter_procedure/);
  }

  const teachback = normalizeVoiceToolCall(
    wireCall("play_procedure_step", {
      procedureId: "knee-arthroscopy",
      stepId: "patient-teachback",
    }),
  );
  assert.equal(teachback.ok, true);
  if (teachback.ok && isVisualizationVoiceToolCall(teachback.call)) {
    assert.equal(getNextApprovedVoiceAction(teachback.call), undefined);
    assert.equal(
      getVoiceNarrationCue(teachback.call)?.text,
      "In your own words, what part of the knee may be treated?",
    );
  }
});

test("settled visualization metadata survives function response serialization", () => {
  const serialized = serializeVoiceToolResult({
    ok: true,
    message: "Right knee is highlighted.",
    settled: {
      transitionCompleted: true,
      stateRevision: 7,
      visualState: "focusing-region",
      viewMode: "body",
      activeRegionId: "right-knee",
      procedureId: "knee-arthroscopy",
      stepId: "affected-knee",
      stage: "overview",
    },
    narration: {
      procedureId: "knee-arthroscopy",
      stepId: "affected-knee",
      title: "Affected knee location",
      text: getProcedureStep("knee-arthroscopy", "affected-knee")!.narration,
      speakAfterSettled: true,
    },
  });
  const response = JSON.parse(serialized);
  assert.equal(response.settled.transitionCompleted, true);
  assert.equal(response.settled.stepId, "affected-knee");
  assert.equal(
    response.narration.text,
    getProcedureStep("knee-arthroscopy", "affected-knee")?.narration,
  );
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
    normalizeVoiceToolCall(wireCall("inspect_current_visual", {})),
    {
      ok: true,
      call: {
        id: "call-1",
        name: "inspect_current_visual",
        arguments: {},
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
      wireCall("inspect_current_visual", { structureId: "meniscus-tear" }),
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
