import type {
  VisualizationControlCommand,
  VisualizationSnapshot,
} from "./visualization-controller";

export type AnatomyTarget =
  | "body"
  | "knee"
  | "meniscus"
  | "tear"
  | "ligaments"
  | "portals";

export type AnatomyViewMode = "body" | "knee";

export type ProcedureStage =
  | "overview"
  | "tear"
  | "scope"
  | "treatment"
  | "recovery";

export type AnatomyCommand =
  | { type: "focus"; target: AnatomyTarget }
  | { type: "set-stage"; stage: ProcedureStage }
  | { type: "rotate"; direction: "left" | "right" }
  | { type: "zoom"; direction: "in" | "out"; factor?: number }
  | { type: "set-auto-rotate"; enabled: boolean }
  | { type: "reset" };

export interface AnatomyState {
  target: AnatomyTarget;
  stage: ProcedureStage;
  viewMode: AnatomyViewMode;
  autoRotate: boolean;
  rotation: number;
  zoom: number;
}

export const anatomyCommandEvent = "consentloop:anatomy-command";

export const initialAnatomyState: AnatomyState = {
  target: "body",
  stage: "overview",
  viewMode: "body",
  autoRotate: false,
  rotation: 0,
  zoom: 1,
};

/**
 * Compatibility projection for Person 2/3 integrations that still consume the
 * original knee-viewer state. The visualization controller remains the only
 * mutable source of truth.
 */
export function visualizationSnapshotToAnatomyState(
  state: VisualizationSnapshot,
): AnatomyState {
  return {
    target: state.target,
    stage: state.stage,
    viewMode: state.viewMode,
    autoRotate: state.autoRotate,
    rotation: state.rotation,
    zoom: state.zoom,
  };
}

/** Adapts the original UI bridge to the high-level visualization controller. */
export function anatomyCommandToVisualizationControls(
  command: AnatomyCommand,
): VisualizationControlCommand[] {
  switch (command.type) {
    case "focus":
      if (command.target === "body") {
        return [{ type: "SHOW_BODY_OVERVIEW" }];
      }
      if (command.target === "knee") {
        return [
          { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
          { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
        ];
      }
      return [
        { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
        { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
        {
          type: "HIGHLIGHT_STRUCTURE",
          structureId:
            command.target === "meniscus"
              ? "meniscus"
              : command.target === "tear"
                ? "meniscus-tear"
                : command.target === "ligaments"
                  ? "cruciate-ligaments"
                  : "camera-portals",
          color: command.target === "tear" ? "orange" : "blue",
        },
      ];
    case "set-stage":
      return command.stage === "overview"
        ? [{ type: "SHOW_BODY_OVERVIEW" }]
        : [
            { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
            { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
            {
              type: "PLAY_PROCEDURE_STEP",
              procedureId: "knee-arthroscopy",
              stepId:
                command.stage === "tear"
                  ? "damaged-structure"
                  : command.stage === "scope"
                    ? "access-point"
                    : command.stage === "treatment"
                      ? "treatment-action"
                      : "expected-result",
            },
          ];
    case "rotate":
      return [{ type: "ROTATE_VISUALIZATION", direction: command.direction }];
    case "zoom":
      return [
        {
          type: "ZOOM_VISUALIZATION",
          direction: command.direction,
          ...(command.factor === undefined ? {} : { factor: command.factor }),
        },
      ];
    case "set-auto-rotate":
      return [{ type: "SET_AUTO_ROTATE", enabled: command.enabled }];
    case "reset":
      return [{ type: "RESET_VISUALIZATION" }];
  }
}

export function reduceAnatomyCommand(
  state: AnatomyState,
  command: AnatomyCommand,
): AnatomyState {
  switch (command.type) {
    case "focus":
      return command.target === "body"
        ? {
            ...state,
            target: "body",
            stage: "overview",
            viewMode: "body",
          }
        : { ...state, target: command.target, viewMode: "knee" };
    case "set-stage":
      return {
        ...state,
        stage: command.stage,
        viewMode: command.stage === "overview" ? "body" : "knee",
        target:
          command.stage === "overview"
            ? "body"
            : command.stage === "tear"
            ? "tear"
            : command.stage === "scope"
              ? "portals"
              : command.stage === "treatment"
                ? "meniscus"
                : "knee",
      };
    case "rotate":
      return {
        ...state,
        rotation:
          state.rotation + (command.direction === "left" ? -Math.PI / 4 : Math.PI / 4),
      };
    case "zoom": {
      const hasExactFactor = command.factor !== undefined;
      const exactFactor =
        typeof command.factor === "number" &&
        Number.isFinite(command.factor) &&
        command.factor > 0
          ? command.factor
          : 1;
      return {
        ...state,
        zoom: Math.min(
          2.4,
          Math.max(
            0.6,
            hasExactFactor
              ? state.zoom * exactFactor
              : state.zoom + (command.direction === "in" ? 0.16 : -0.16),
          ),
        ),
      };
    }
    case "set-auto-rotate":
      return { ...state, autoRotate: command.enabled };
    case "reset":
      return initialAnatomyState;
  }
}

declare global {
  interface Window {
    consentLoop3D?: {
      execute: (command: AnatomyCommand) => void;
      getState: () => AnatomyState;
    };
  }
}
