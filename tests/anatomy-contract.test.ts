import assert from "node:assert/strict";
import test from "node:test";

import {
  anatomyCommandToVisualizationControls,
  initialAnatomyState,
  reduceAnatomyCommand,
  visualizationSnapshotToAnatomyState,
} from "../app/lib/anatomy-commands";
import { initialVisualizationSnapshot } from "../app/lib/visualization-controller";
import {
  sceneCommandToVizCommand,
  translateVizCommand,
  vizCapabilities,
  type VizAction,
  type VizCommandV1,
} from "../app/lib/viz-contract";

function vizCommand(action: VizAction): VizCommandV1 {
  return {
    schema: "consentloop.viz-command.v1",
    id: "test-command",
    issuedAt: "2026-08-01T00:00:00.000Z",
    source: { kind: "demo" },
    action,
  };
}

test("anatomy state starts and resets at the whole-body overview", () => {
  assert.deepEqual(initialAnatomyState, {
    target: "body",
    stage: "overview",
    viewMode: "body",
    autoRotate: false,
    rotation: 0,
    zoom: 1,
  });

  const kneeState = reduceAnatomyCommand(initialAnatomyState, {
    type: "focus",
    target: "knee",
  });
  assert.equal(kneeState.viewMode, "knee");
  assert.deepEqual(
    reduceAnatomyCommand(kneeState, { type: "reset" }),
    initialAnatomyState,
  );
});

test("focus and stage commands keep body and knee views coherent", () => {
  const tearState = reduceAnatomyCommand(initialAnatomyState, {
    type: "set-stage",
    stage: "tear",
  });
  assert.equal(tearState.target, "tear");
  assert.equal(tearState.viewMode, "knee");

  const overviewState = reduceAnatomyCommand(tearState, {
    type: "set-stage",
    stage: "overview",
  });
  assert.equal(overviewState.target, "body");
  assert.equal(overviewState.viewMode, "body");

  const bodyState = reduceAnatomyCommand(tearState, {
    type: "focus",
    target: "body",
  });
  assert.equal(bodyState.stage, "overview");
  assert.equal(bodyState.viewMode, "body");
});

test("zoom supports legacy steps, exact factors, and safe bounds", () => {
  const legacy = reduceAnatomyCommand(initialAnatomyState, {
    type: "zoom",
    direction: "in",
  });
  assert.equal(legacy.zoom, 1.16);

  const exact = reduceAnatomyCommand(initialAnatomyState, {
    type: "zoom",
    direction: "in",
    factor: 1.5,
  });
  assert.equal(exact.zoom, 1.5);

  assert.equal(
    reduceAnatomyCommand(exact, {
      type: "zoom",
      direction: "in",
      factor: 100,
    }).zoom,
    2.4,
  );
  assert.equal(
    reduceAnatomyCommand(initialAnatomyState, {
      type: "zoom",
      direction: "out",
      factor: 0.01,
    }).zoom,
    0.6,
  );
});

test("visualization commands expose the body and preserve exact zoom factors", () => {
  assert.ok(
    vizCapabilities.targets.some(
      (target) =>
        target.id === "anatomy.body" && target.aliases.includes("whole body"),
    ),
  );

  assert.deepEqual(
    translateVizCommand(
      vizCommand({
        type: "target.select",
        targets: ["anatomy.body"],
      }),
    ),
    [{ type: "focus", target: "body" }],
  );
  assert.deepEqual(
    translateVizCommand(vizCommand({ type: "camera.zoom", factor: 1.35 })),
    [{ type: "zoom", direction: "in", factor: 1.35 }],
  );
});

test("viewer modes and shared body targets map to the right view", () => {
  assert.deepEqual(
    translateVizCommand(
      vizCommand({ type: "scene.setMode", mode: "overview" }),
    ),
    [{ type: "set-stage", stage: "overview" }],
  );
  assert.deepEqual(
    translateVizCommand(
      vizCommand({ type: "scene.setMode", mode: "anatomy" }),
    ),
    [
      { type: "set-stage", stage: "overview" },
      { type: "focus", target: "knee" },
    ],
  );
  assert.deepEqual(
    translateVizCommand(
      vizCommand({ type: "scene.setMode", mode: "procedure" }),
    ),
    [{ type: "set-stage", stage: "scope" }],
  );

  const sharedBody = sceneCommandToVizCommand({
    type: "highlight",
    target: "whole body",
    color: "#ff0000",
  });
  assert.deepEqual(sharedBody.action, {
    type: "target.select",
    targets: ["anatomy.body"],
  });
});

test("legacy viewer commands delegate to the single high-level controller", () => {
  assert.deepEqual(
    anatomyCommandToVisualizationControls({ type: "focus", target: "knee" }),
    [
      { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
      { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
    ],
  );
  assert.deepEqual(
    anatomyCommandToVisualizationControls({ type: "focus", target: "tear" }),
    [
      { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
      { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
      {
        type: "HIGHLIGHT_STRUCTURE",
        structureId: "meniscus-tear",
        color: "orange",
      },
    ],
  );
  assert.deepEqual(
    anatomyCommandToVisualizationControls({ type: "set-stage", stage: "scope" }),
    [
      { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
      { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
      {
        type: "PLAY_PROCEDURE_STEP",
        procedureId: "knee-arthroscopy",
        stepId: "access-point",
      },
    ],
  );
  assert.deepEqual(
    visualizationSnapshotToAnatomyState(initialVisualizationSnapshot),
    {
      target: "body",
      stage: "overview",
      viewMode: "body",
      autoRotate: true,
      rotation: Math.PI / 4,
      zoom: 1,
    },
  );
});
