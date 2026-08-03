import {
  bodyRegionIds,
  bodyRegions,
  bodyViewYaw,
  bodyViews,
  getProcedureStep,
  highlightColors,
  procedureIds,
  procedureVisualizations,
  structureIds,
  visualModes,
  type BodyRegionId,
  type BodyView,
  type HighlightColor,
  type ProcedureId,
  type ProcedureRenderStage,
  type StructureId,
  type VisualizationCommand,
  type VisualizationState,
  type VisualMode,
} from "./procedure-visualization";

export interface VisualizationHighlight {
  structureId: StructureId;
  color: HighlightColor;
}

export interface VisualizationSnapshot {
  visualState: VisualizationState;
  bodyView: BodyView;
  activeRegionId: BodyRegionId | null;
  procedureId: ProcedureId | null;
  stepId: string | null;
  stage: ProcedureRenderStage;
  target: "body" | "knee" | "meniscus" | "tear" | "ligaments" | "portals";
  viewMode: "body" | "knee";
  visualMode: VisualMode;
  highlights: VisualizationHighlight[];
  comparison: boolean;
  completedStepIds: string[];
  autoRotate: boolean;
  rotation: number;
  zoom: number;
  revision: number;
}

export type VisualizationSceneLayer = "body" | "handoff" | "knee";
export type VisualizationCameraPhase =
  | "body-overview"
  | "body-region"
  | "knee-detail";

export interface VisualizationRenderCommit {
  layer: VisualizationSceneLayer;
  phase: VisualizationCameraPhase;
  revision: number;
  visualState: VisualizationState;
  bodyAssetReady: boolean;
}

export function getExpectedVisualizationRenderCommit(
  state: VisualizationSnapshot,
): VisualizationRenderCommit {
  return {
    layer: state.viewMode === "body" ? "body" : "knee",
    phase:
      state.viewMode === "knee"
        ? "knee-detail"
        : state.target === "body"
          ? "body-overview"
          : "body-region",
    revision: state.revision,
    visualState: state.visualState,
    bodyAssetReady: state.viewMode === "body",
  };
}

export function isVisualizationRenderCommitSatisfied(
  actual: VisualizationRenderCommit | null,
  expected: VisualizationRenderCommit,
): boolean {
  return Boolean(
    actual &&
      actual.layer === expected.layer &&
      actual.phase === expected.phase &&
      actual.revision === expected.revision &&
      actual.visualState === expected.visualState &&
      (expected.layer !== "body" || actual.bodyAssetReady),
  );
}

export const initialVisualizationSnapshot: VisualizationSnapshot = {
  visualState: "loading",
  bodyView: "three-quarter",
  activeRegionId: "right-knee",
  procedureId: "knee-arthroscopy",
  stepId: "body-overview",
  stage: "overview",
  target: "body",
  viewMode: "body",
  visualMode: "transparent",
  highlights: [{ structureId: "whole-knee", color: "blue" }],
  comparison: false,
  completedStepIds: [],
  autoRotate: true,
  rotation: bodyViewYaw["three-quarter"],
  zoom: 1,
  revision: 0,
};

export type VisualizationControlCommand =
  | VisualizationCommand
  | { type: "ROTATE_VISUALIZATION"; direction: "left" | "right" }
  | { type: "ZOOM_VISUALIZATION"; direction: "in" | "out"; factor?: number }
  | { type: "SET_AUTO_ROTATE"; enabled: boolean }
  | { type: "SET_VISUALIZATION_PHASE"; state: VisualizationState };

export type VisualizationRejectCode =
  | "INVALID_COMMAND"
  | "INVALID_SEQUENCE"
  | "TRANSITION_TIMEOUT"
  | "UNKNOWN_REGION"
  | "UNKNOWN_PROCEDURE"
  | "UNKNOWN_STEP"
  | "UNKNOWN_STRUCTURE"
  | "UNSUPPORTED_VIEW"
  | "UNSUPPORTED_MODE";

export type VisualizationExecution =
  | {
      ok: true;
      state: VisualizationSnapshot;
      transitionMs: number;
      message: string;
    }
  | { ok: false; code: VisualizationRejectCode; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function validateVisualizationCommand(
  value: unknown,
): { ok: true; command: VisualizationCommand } | { ok: false; code: VisualizationRejectCode; error: string } {
  if (!isRecord(value) || typeof value.type !== "string") {
    return { ok: false, code: "INVALID_COMMAND", error: "Visualization command must be an object with a type." };
  }

  switch (value.type) {
    case "SHOW_BODY_OVERVIEW":
      if (!hasOnlyKeys(value, ["type", "view"])) {
        return { ok: false, code: "INVALID_COMMAND", error: "Body overview command contains unsupported fields." };
      }
      if (value.view !== undefined && !isMember(value.view, bodyViews)) {
        return { ok: false, code: "UNSUPPORTED_VIEW", error: "Unsupported body view." };
      }
      return {
        ok: true,
        command: {
          type: "SHOW_BODY_OVERVIEW",
          ...(value.view === undefined ? {} : { view: value.view }),
        },
      };
    case "FOCUS_BODY_REGION":
      if (!hasOnlyKeys(value, ["type", "regionId"]) || !isMember(value.regionId, bodyRegionIds)) {
        return { ok: false, code: "UNKNOWN_REGION", error: "Unknown body region." };
      }
      return { ok: true, command: { type: value.type, regionId: value.regionId } };
    case "ENTER_PROCEDURE":
      if (!hasOnlyKeys(value, ["type", "procedureId"]) || !isMember(value.procedureId, procedureIds)) {
        return { ok: false, code: "UNKNOWN_PROCEDURE", error: "Unknown procedure visualization." };
      }
      return { ok: true, command: { type: value.type, procedureId: value.procedureId } };
    case "PLAY_PROCEDURE_STEP":
      if (
        !hasOnlyKeys(value, ["type", "procedureId", "stepId"]) ||
        !isMember(value.procedureId, procedureIds)
      ) {
        return { ok: false, code: "UNKNOWN_PROCEDURE", error: "Unknown procedure visualization." };
      }
      if (typeof value.stepId !== "string" || !getProcedureStep(value.procedureId, value.stepId)) {
        return { ok: false, code: "UNKNOWN_STEP", error: "This step is not approved for the selected procedure." };
      }
      return {
        ok: true,
        command: { type: value.type, procedureId: value.procedureId, stepId: value.stepId },
      };
    case "HIGHLIGHT_STRUCTURE":
      if (
        !hasOnlyKeys(value, ["type", "structureId", "color"]) ||
        !isMember(value.structureId, structureIds)
      ) {
        return { ok: false, code: "UNKNOWN_STRUCTURE", error: "Unknown or unsupported structure." };
      }
      if (!isMember(value.color, highlightColors)) {
        return { ok: false, code: "INVALID_COMMAND", error: "Unsupported highlight color." };
      }
      return {
        ok: true,
        command: { type: value.type, structureId: value.structureId, color: value.color },
      };
    case "SET_VISUAL_MODE":
      if (!hasOnlyKeys(value, ["type", "mode"]) || !isMember(value.mode, visualModes)) {
        return { ok: false, code: "UNSUPPORTED_MODE", error: "Unsupported visualization mode." };
      }
      return { ok: true, command: { type: value.type, mode: value.mode } };
    case "RETURN_TO_OVERVIEW":
    case "RESET_VISUALIZATION":
      if (!hasOnlyKeys(value, ["type"])) {
        return { ok: false, code: "INVALID_COMMAND", error: "Visualization command contains unsupported fields." };
      }
      return { ok: true, command: { type: value.type } };
    default:
      return { ok: false, code: "INVALID_COMMAND", error: "Unsupported visualization command." };
  }
}

function addCompletedStep(state: VisualizationSnapshot): string[] {
  if (!state.stepId || state.completedStepIds.includes(state.stepId)) {
    return state.completedStepIds;
  }
  return [...state.completedStepIds, state.stepId];
}

function nextRevision(state: VisualizationSnapshot): number {
  return state.revision + 1;
}

export function executeVisualizationCommand(
  state: VisualizationSnapshot,
  value: unknown,
): VisualizationExecution {
  const validated = validateVisualizationCommand(value);
  if (!validated.ok) return validated;
  const command = validated.command;

  switch (command.type) {
    case "SHOW_BODY_OVERVIEW": {
      const bodyView = command.view ?? state.bodyView;
      return {
        ok: true,
        transitionMs: 650,
        message: `${bodyView.replace("-", " ")} whole-body overview is visible.`,
        state: {
          ...state,
          visualState: "overview",
          bodyView,
          stepId: "body-overview",
          stage: "overview",
          target: "body",
          viewMode: "body",
          visualMode: "transparent",
          comparison: false,
          rotation: bodyViewYaw[bodyView],
          revision: nextRevision(state),
        },
      };
    }
    case "FOCUS_BODY_REGION": {
      const region = bodyRegions[command.regionId];
      return {
        ok: true,
        transitionMs: 900,
        message: `${region.label} is highlighted on the whole-body overview.`,
        state: {
          ...state,
          visualState: "focusing-region",
          activeRegionId: command.regionId,
          procedureId: region.procedureSceneId as ProcedureId,
          stepId: "affected-knee",
          stage: "overview",
          target: "knee",
          viewMode: "body",
          highlights: [{ structureId: "whole-knee", color: "blue" }],
          comparison: false,
          rotation: bodyViewYaw["three-quarter"],
          zoom: Math.max(state.zoom, 1.14),
          revision: nextRevision(state),
        },
      };
    }
    case "ENTER_PROCEDURE": {
      const procedure = procedureVisualizations[command.procedureId];
      const regionFocused =
        state.viewMode === "body" &&
        state.target === "knee" &&
        state.activeRegionId === procedure.regionId &&
        state.stepId === "affected-knee";
      if (!regionFocused) {
        return {
          ok: false,
          code: "INVALID_SEQUENCE",
          error: `Focus ${bodyRegions[procedure.regionId].label.toLowerCase()} before entering the procedure detail.`,
        };
      }
      return {
        ok: true,
        transitionMs: 1_200,
        message: `${procedure.title} detail is visible.`,
        state: {
          ...state,
          visualState: "entering-procedure",
          activeRegionId: procedure.regionId,
          procedureId: command.procedureId,
          stepId: "normal-anatomy",
          stage: "overview",
          target: "knee",
          viewMode: "knee",
          visualMode: "normal",
          highlights: [{ structureId: "whole-knee", color: "blue" }],
          comparison: false,
          completedStepIds: addCompletedStep(state),
          // Continue inward from the region-focus framing instead of jumping
          // back out as the detailed knee replaces the body model.
          zoom: Math.max(state.zoom, 1.32),
          revision: nextRevision(state),
        },
      };
    }
    case "PLAY_PROCEDURE_STEP": {
      const procedureStep = getProcedureStep(command.procedureId, command.stepId)!;
      const bodyStep = command.stepId === "body-overview" || command.stepId === "affected-knee";
      const procedure = procedureVisualizations[command.procedureId];
      const procedureReady =
        state.viewMode === "knee" &&
        state.visualState !== "entering-procedure" &&
        state.procedureId === command.procedureId &&
        state.activeRegionId === procedure.regionId &&
        state.stepId !== "body-overview" &&
        state.stepId !== "affected-knee";
      if (!bodyStep && !procedureReady) {
        return {
          ok: false,
          code: "INVALID_SEQUENCE",
          error: `Focus ${bodyRegions[procedure.regionId].label.toLowerCase()} and enter the procedure before playing detailed steps.`,
        };
      }
      return {
        ok: true,
        transitionMs: bodyStep ? 850 : 600,
        message: `${procedureStep.title} is visible.`,
        state: {
          ...state,
          visualState: procedureStep.render.state ?? "procedure",
          activeRegionId: procedureVisualizations[command.procedureId].regionId,
          procedureId: command.procedureId,
          stepId: command.stepId,
          stage: procedureStep.render.stage,
          target: procedureStep.render.target,
          viewMode: bodyStep ? "body" : "knee",
          visualMode: procedureStep.render.visualMode ?? state.visualMode,
          highlights: procedureStep.render.highlight ? [procedureStep.render.highlight] : state.highlights,
          comparison: procedureStep.render.comparison ?? false,
          completedStepIds: addCompletedStep(state),
          zoom:
            command.stepId === "body-overview"
              ? 1
              : command.stepId === "affected-knee"
                ? Math.max(state.zoom, 1.14)
                : Math.max(state.zoom, 1.32),
          revision: nextRevision(state),
        },
      };
    }
    case "HIGHLIGHT_STRUCTURE": {
      const withoutStructure = state.highlights.filter(
        (highlight) => highlight.structureId !== command.structureId,
      );
      return {
        ok: true,
        transitionMs: 280,
        message: `${command.structureId.replaceAll("-", " ")} is highlighted ${command.color}.`,
        state: {
          ...state,
          highlights: [
            ...withoutStructure.slice(-1),
            { structureId: command.structureId, color: command.color },
          ],
          target:
            command.structureId === "meniscus-tear"
              ? "tear"
              : command.structureId.includes("meniscus")
                ? "meniscus"
                : command.structureId === "cruciate-ligaments"
                  ? "ligaments"
                  : command.structureId.includes("portal") || command.structureId.includes("risk")
                    ? "portals"
                    : "knee",
          revision: nextRevision(state),
        },
      };
    }
    case "SET_VISUAL_MODE":
      return {
        ok: true,
        transitionMs: 220,
        message: `${command.mode} visualization mode is active.`,
        state: {
          ...state,
          visualMode: command.mode,
          revision: nextRevision(state),
        },
      };
    case "RETURN_TO_OVERVIEW":
      return {
        ok: true,
        transitionMs: 1_050,
        message: "Returned to the whole-body overview with the right knee marked as explained.",
        state: {
          ...state,
          visualState: "returning-to-overview",
          bodyView: "three-quarter",
          stepId: "body-overview",
          stage: "overview",
          target: "body",
          viewMode: "body",
          visualMode: "transparent",
          highlights: [{ structureId: "whole-knee", color: "green" }],
          comparison: false,
          completedStepIds: addCompletedStep(state),
          rotation: bodyViewYaw["three-quarter"],
          zoom: 1,
          revision: nextRevision(state),
        },
      };
    case "RESET_VISUALIZATION":
      return {
        ok: true,
        transitionMs: 0,
        message: "Visualization reset to the whole-body overview.",
        state: {
          ...initialVisualizationSnapshot,
          visualState: "overview",
          revision: nextRevision(state),
        },
      };
  }
}

export function executeVisualizationControl(
  state: VisualizationSnapshot,
  command: VisualizationControlCommand,
): VisualizationExecution {
  if (
    command.type !== "ROTATE_VISUALIZATION" &&
    command.type !== "ZOOM_VISUALIZATION" &&
    command.type !== "SET_AUTO_ROTATE" &&
    command.type !== "SET_VISUALIZATION_PHASE"
  ) {
    return executeVisualizationCommand(state, command);
  }

  if (command.type === "ROTATE_VISUALIZATION") {
    return {
      ok: true,
      transitionMs: 260,
      message: `Rotated visualization ${command.direction}.`,
      state: {
        ...state,
        autoRotate: false,
        rotation: state.rotation + (command.direction === "left" ? -Math.PI / 4 : Math.PI / 4),
        revision: nextRevision(state),
      },
    };
  }

  if (command.type === "ZOOM_VISUALIZATION") {
    const requestedFactor = command.factor;
    const validFactor =
      typeof requestedFactor === "number" && Number.isFinite(requestedFactor) && requestedFactor > 0
        ? requestedFactor
        : undefined;
    const zoom = validFactor
      ? state.zoom * validFactor
      : state.zoom + (command.direction === "in" ? 0.16 : -0.16);
    return {
      ok: true,
      transitionMs: 220,
      message: `Zoomed visualization ${command.direction}.`,
      state: {
        ...state,
        zoom: Math.min(2.4, Math.max(0.6, zoom)),
        revision: nextRevision(state),
      },
    };
  }

  if (command.type === "SET_AUTO_ROTATE") {
    return {
      ok: true,
      transitionMs: 0,
      message: command.enabled ? "Slow idle rotation enabled." : "Idle rotation paused.",
      state: {
        ...state,
        autoRotate: command.enabled,
        revision: nextRevision(state),
      },
    };
  }

  return {
    ok: true,
    transitionMs: 0,
    message: `Visualization state is ${command.state}.`,
    state: {
      ...state,
      visualState: command.state,
      revision: nextRevision(state),
    },
  };
}

export function settleVisualizationState(
  state: VisualizationSnapshot,
): VisualizationSnapshot {
  const visualState: VisualizationState =
    state.visualState === "entering-procedure"
      ? "procedure"
      : state.visualState === "returning-to-overview" || state.visualState === "focusing-region"
        ? "overview"
        : state.visualState === "loading"
          ? "overview"
          : state.visualState;
  return visualState === state.visualState ? state : { ...state, visualState };
}

export const visualizationCapabilities = {
  bodyViews,
  regionIds: bodyRegionIds,
  procedureIds,
  stepIds: Object.fromEntries(
    procedureIds.map((procedureId) => [
      procedureId,
      procedureVisualizations[procedureId].steps.map((procedureStep) => procedureStep.id),
    ]),
  ),
  structureIds,
  visualModes,
  highlightColors,
} as const;
