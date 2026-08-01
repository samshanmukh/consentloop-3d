export type AnatomyTarget =
  | "knee"
  | "meniscus"
  | "tear"
  | "ligaments"
  | "portals";

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
  | { type: "zoom"; direction: "in" | "out" }
  | { type: "set-auto-rotate"; enabled: boolean }
  | { type: "reset" };

export interface AnatomyState {
  target: AnatomyTarget;
  stage: ProcedureStage;
  autoRotate: boolean;
  rotation: number;
  zoom: number;
}

export const anatomyCommandEvent = "consentloop:anatomy-command";

export const initialAnatomyState: AnatomyState = {
  target: "knee",
  stage: "overview",
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
      return { ...state, target: command.target };
    case "set-stage":
      return {
        ...state,
        stage: command.stage,
        target:
          command.stage === "tear"
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
    case "zoom":
      return {
        ...state,
        zoom: Math.min(
          1.55,
          Math.max(0.72, state.zoom + (command.direction === "in" ? 0.16 : -0.16)),
        ),
      };
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

