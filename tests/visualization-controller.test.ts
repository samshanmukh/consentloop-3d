import assert from "node:assert/strict";
import test from "node:test";

import {
  executeVisualizationCommand,
  executeVisualizationControl,
  initialVisualizationSnapshot,
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
  assert.equal(settleVisualizationState(entered.state).visualState, "procedure");
});

test("every approved procedure step is executable by id", () => {
  let current = initialVisualizationSnapshot;
  for (const procedureStep of kneeArthroscopyProcedure.steps) {
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

test("misconception comparison distinguishes whole joint and treated structure", () => {
  const result = executeVisualizationCommand(initialVisualizationSnapshot, {
    type: "PLAY_PROCEDURE_STEP",
    procedureId: "knee-arthroscopy",
    stepId: "misconception-comparison",
  });
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
