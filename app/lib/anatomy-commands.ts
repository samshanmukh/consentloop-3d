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
