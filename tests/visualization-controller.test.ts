import assert from "node:assert/strict";
import test from "node:test";

import {
  executeVisualizationCommand,
  executeVisualizationControl,
  getExpectedVisualizationRenderCommit,
  initialVisualizationSnapshot,
  isVisualizationRenderCommitSatisfied,
  settleVisualizationState,
  validateVisualizationCommand,
} from "../app/lib/visualization-controller";
import {
  bodyViewYaw,
  kneeArthroscopyProcedure,
} from "../app/lib/procedure-visualization";

test("body overview supports front and back presets", () => {
  const front = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "SHOW_BODY_OVERVIEW",
    view: "front",
  });
  assert.equal(front.ok, true);
  if (!front.ok) return;
  assert.equal(front.state.visualState, "overview");
  assert.equal(front.state.viewMode, "body");
  assert.equal(front.state.bodyView, "front");
  assert.equal(front.state.rotation, bodyViewYaw.front);

  const back = executeVisualizationCommand(front.state, {
    type: "SHOW_BODY_OVERVIEW",
    view: "back",
  });
  assert.equal(back.ok, true);
  if (!back.ok) return;
  assert.equal(back.state.bodyView, "back");
  assert.equal(back.state.rotation, Math.PI);
});

test("manual rotation and zoom stay bounded and pause idle rotation", () => {
  const rotated = executeVisualizationControl(initialVisualizationSnapshot, {
    type: "ROTATE_VISUALIZATION",
    direction: "right",
  });
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;
  assert.equal(rotated.state.autoRotate, false);
  assert.ok(rotated.state.rotation > initialVisualizationSnapshot.rotation);

  const zoomed = executeVisualizationControl(rotated.state, {
    type: "ZOOM_VISUALIZATION",
    direction: "in",
    factor: 100,
  });
  assert.equal(zoomed.ok, true);
  if (!zoomed.ok) return;
  assert.equal(zoomed.state.zoom, 2.4);
});

test("overview focuses the configured knee then enters the preserved procedure", () => {
  const focused = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "FOCUS_BODY_REGION",
    regionId: "right-knee",
  });
  assert.equal(focused.ok, true);
  if (!focused.ok) return;
  assert.equal(focused.state.visualState, "focusing-region");
  assert.equal(focused.state.viewMode, "body");
  assert.deepEqual(focused.state.highlights, [
    { structureId: "whole-knee", color: "blue" },
  ]);
  assert.equal(settleVisualizationState(focused.state).visualState, "overview");

  const entered = executeVisualizationCommand(focused.state, {
    type: "ENTER_PROCEDURE",
    procedureId: "knee-arthroscopy",
  });
  assert.equal(entered.ok, true);
  if (!entered.ok) return;
  assert.equal(entered.state.visualState, "entering-procedure");
  assert.equal(entered.state.viewMode, "knee");
  assert.equal(entered.state.stepId, "normal-anatomy");
  assert.ok(entered.state.zoom > focused.state.zoom);
  assert.equal(settleVisualizationState(entered.state).visualState, "procedure");
});

test("renderer acknowledgement requires the focused revision and camera phase", () => {
  const focused = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "FOCUS_BODY_REGION",
    regionId: "right-knee",
  });
  assert.equal(focused.ok, true);
  if (!focused.ok) return;

  const settledFocus = settleVisualizationState(focused.state);
  const expectedFocus = getExpectedVisualizationRenderCommit(settledFocus);
  assert.deepEqual(expectedFocus, {
    layer: "body",
    phase: "body-region",
    revision: 1,
    visualState: "overview",
    bodyAssetReady: true,
  });
  assert.equal(
    isVisualizationRenderCommitSatisfied(
      {
        layer: "body",
        phase: "body-region",
        revision: 0,
        visualState: "overview",
        bodyAssetReady: true,
      },
      expectedFocus,
    ),
    false,
    "a previously mounted body layer must not acknowledge a new focus command",
  );
  assert.equal(
    isVisualizationRenderCommitSatisfied(
      {
        layer: "body",
        phase: "body-overview",
        revision: 1,
        visualState: "overview",
        bodyAssetReady: true,
      },
      expectedFocus,
    ),
    false,
    "focus must commit the knee camera phase before enter can be queued",
  );
  assert.equal(
    isVisualizationRenderCommitSatisfied(
      {
        layer: "body",
        phase: "body-region",
        revision: 1,
        visualState: "focusing-region",
        bodyAssetReady: true,
      },
      expectedFocus,
    ),
    false,
    "the transient focus render must not release a reduced-motion command batch",
  );
  assert.equal(
    isVisualizationRenderCommitSatisfied(expectedFocus, expectedFocus),
    true,
  );
});

test("body renderer acknowledgement waits for delayed GLB readiness", () => {
  const expected = getExpectedVisualizationRenderCommit({
    ...initialVisualizationSnapshot,
    visualState: "overview",
    target: "knee",
    stepId: "affected-knee",
    revision: 7,
  });
  const fallbackCommit = {
    ...expected,
    bodyAssetReady: false,
  };

  assert.equal(
    isVisualizationRenderCommitSatisfied(fallbackCommit, expected),
    false,
    "the Suspense body fallback must not release the pending command",
  );
  assert.equal(
    isVisualizationRenderCommitSatisfied(
      { ...fallbackCommit, bodyAssetReady: true },
      expected,
    ),
    true,
    "the same revision becomes eligible when FullBodyModel reports ready",
  );
});

test("renderer acknowledgement distinguishes consecutive commits on the knee layer", () => {
  const focused = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "FOCUS_BODY_REGION",
    regionId: "right-knee",
  });
  assert.equal(focused.ok, true);
  if (!focused.ok) return;
  const entered = executeVisualizationCommand(settleVisualizationState(focused.state), {
    type: "ENTER_PROCEDURE",
    procedureId: "knee-arthroscopy",
  });
  assert.equal(entered.ok, true);
  if (!entered.ok) return;

  const enteredState = settleVisualizationState(entered.state);
  const enteredCommit = getExpectedVisualizationRenderCommit(enteredState);
  const nextStep = executeVisualizationCommand(enteredState, {
    type: "PLAY_PROCEDURE_STEP",
    procedureId: "knee-arthroscopy",
    stepId: "damaged-structure",
  });
  assert.equal(nextStep.ok, true);
  if (!nextStep.ok) return;
  const expectedStepCommit = getExpectedVisualizationRenderCommit(
    settleVisualizationState(nextStep.state),
  );

  assert.equal(enteredCommit.layer, "knee");
  assert.equal(expectedStepCommit.layer, "knee");
  assert.equal(
    isVisualizationRenderCommitSatisfied(enteredCommit, expectedStepCommit),
    false,
    "the existing knee layer cannot acknowledge the next procedure step",
  );
  assert.equal(
    isVisualizationRenderCommitSatisfied(expectedStepCommit, expectedStepCommit),
    true,
  );
});

test("every approved procedure step is executable by id", () => {
  let current = initialVisualizationSnapshot;
  for (const procedureStep of kneeArthroscopyProcedure.steps.slice(0, 2)) {
    const result = executeVisualizationCommand(current, {
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId: procedureStep.id,
    });
    assert.equal(result.ok, true, procedureStep.id);
    if (!result.ok) return;
    current = result.state;
  }

  const entered = executeVisualizationCommand(current, {
    type: "ENTER_PROCEDURE",
    procedureId: "knee-arthroscopy",
  });
  assert.equal(entered.ok, true);
  if (!entered.ok) return;

  current = settleVisualizationState(entered.state);
  for (const procedureStep of kneeArthroscopyProcedure.steps.slice(2)) {
    const result = executeVisualizationCommand(current, {
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId: procedureStep.id,
    });
    assert.equal(result.ok, true, procedureStep.id);
    if (!result.ok) continue;
    assert.equal(result.state.stepId, procedureStep.id);
    assert.equal(result.state.stage, procedureStep.render.stage);
    current = result.state;
  }
});

test("procedure detail cannot bypass body orientation and knee focus", () => {
  const enteredTooEarly = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "ENTER_PROCEDURE",
    procedureId: "knee-arthroscopy",
  });
  assert.equal(enteredTooEarly.ok, false);
  if (enteredTooEarly.ok) return;
  assert.equal(enteredTooEarly.code, "INVALID_SEQUENCE");

  const playedTooEarly = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "PLAY_PROCEDURE_STEP",
    procedureId: "knee-arthroscopy",
    stepId: "damaged-structure",
  });
  assert.equal(playedTooEarly.ok, false);
  if (playedTooEarly.ok) return;
  assert.equal(playedTooEarly.code, "INVALID_SEQUENCE");

  const focused = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "FOCUS_BODY_REGION",
    regionId: "right-knee",
  });
  assert.equal(focused.ok, true);
  if (!focused.ok) return;
  const entering = executeVisualizationCommand(focused.state, {
    type: "ENTER_PROCEDURE",
    procedureId: "knee-arthroscopy",
  });
  assert.equal(entering.ok, true);
  if (!entering.ok) return;
  const playedDuringHandoff = executeVisualizationCommand(entering.state, {
    type: "PLAY_PROCEDURE_STEP",
    procedureId: "knee-arthroscopy",
    stepId: "damaged-structure",
  });
  assert.equal(playedDuringHandoff.ok, false);
  if (playedDuringHandoff.ok) return;
  assert.equal(playedDuringHandoff.code, "INVALID_SEQUENCE");
});

test("misconception comparison distinguishes whole joint and treated structure", () => {
  const result = executeVisualizationCommand(
    {
      ...initialVisualizationSnapshot,
      visualState: "procedure",
      viewMode: "knee",
      target: "knee",
      stepId: "normal-anatomy",
    },
    {
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId: "misconception-comparison",
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.visualState, "misconception-detected");
  assert.equal(result.state.comparison, true);
  assert.deepEqual(result.state.highlights, [
    { structureId: "treated-meniscus", color: "orange" },
  ]);
});

test("return restores the whole body and marks the region explained", () => {
  const result = executeVisualizationCommand(
    {
      ...initialVisualizationSnapshot,
      visualState: "procedure",
      viewMode: "knee",
      stepId: "completion",
    },
    { type: "RETURN_TO_OVERVIEW" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.visualState, "returning-to-overview");
  assert.equal(result.state.viewMode, "body");
  assert.deepEqual(result.state.highlights, [
    { structureId: "whole-knee", color: "green" },
  ]);
  assert.equal(settleVisualizationState(result.state).visualState, "overview");
});

test("runtime validation rejects unsupported commands and mismatched steps", () => {
  assert.deepEqual(
    validateVisualizationCommand({
      type: "FOCUS_BODY_REGION",
      regionId: "brain",
    }),
    { ok: false, code: "UNKNOWN_REGION", error: "Unknown body region." },
  );
  assert.equal(
    validateVisualizationCommand({
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId: "invented-operation",
    }).ok,
    false,
  );
  assert.equal(
    validateVisualizationCommand({
      type: "RETURN_TO_OVERVIEW",
      cameraPosition: [1, 2, 3],
    }).ok,
    false,
  );
});
