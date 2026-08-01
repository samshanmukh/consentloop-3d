import type { AnatomyCommand, AnatomyTarget, ProcedureStage } from "./anatomy-commands";

export const vizCommandEvent = "consentloop:viz-command";
export const vizResultEvent = "consentloop:viz-result";

export type VizTargetId =
  | "anatomy.knee"
  | "anatomy.meniscus.medial"
  | "anatomy.meniscus.tear"
  | "anatomy.ligament.cruciate"
  | "procedure.portals";

export type VizAtomicAction =
  | { type: "scene.reset" }
  | { type: "scene.setMode"; mode: "overview" | "anatomy" | "procedure" | "recovery" }
  | { type: "camera.orbit"; yawDeg: number; pitchDeg?: number }
  | { type: "camera.zoom"; factor: number }
  | { type: "target.select"; targets: VizTargetId[]; behavior?: "replace" | "add" | "remove" }
  | { type: "target.isolate"; targets: VizTargetId[]; contextOpacity?: number }
  | {
      type: "procedure.preview";
      procedureId: "knee-arthroscopy";
      stepId?: "orientation" | "tear" | "scope" | "treatment" | "recovery";
      autoplay?: boolean;
    };

export type VizAction =
  | VizAtomicAction
  | { type: "batch"; atomic?: boolean; actions: VizAtomicAction[] };

export interface VizCommandV1 {
  schema: "consentloop.viz-command.v1";
  id: string;
  issuedAt: string;
  source: {
    kind: "voice" | "pointer" | "demo";
    sessionId?: string;
    utterance?: string;
    confidence?: number;
  };
  action: VizAction;
}

export interface VizResultV1 {
  schema: "consentloop.viz-result.v1";
  commandId: string;
  status: "completed" | "rejected" | "superseded";
  code?: "UNKNOWN_TARGET" | "UNSUPPORTED_ACTION" | "INVALID_PAYLOAD";
  message: string;
  stateRevision: number;
}

export const vizCapabilities = {
  schema: "consentloop.viz-capabilities.v1" as const,
  targets: [
    { id: "anatomy.knee", aliases: ["knee", "joint", "whole knee"] },
    { id: "anatomy.meniscus.medial", aliases: ["meniscus", "cartilage cushion"] },
    { id: "anatomy.meniscus.tear", aliases: ["tear", "damaged part", "injury"] },
    { id: "anatomy.ligament.cruciate", aliases: ["ACL", "PCL", "cruciate ligaments"] },
    { id: "procedure.portals", aliases: ["camera portal", "incision", "scope path"] },
  ],
  procedure: {
    id: "knee-arthroscopy",
    steps: ["orientation", "tear", "scope", "treatment", "recovery"],
  },
  limits: {
    mutatesClinicalData: false,
    acceptsRawMeshNames: false,
    illustrativeOnly: true,
  },
};

function targetToAnatomyTarget(target: VizTargetId): AnatomyTarget {
  const targets: Record<VizTargetId, AnatomyTarget> = {
    "anatomy.knee": "knee",
    "anatomy.meniscus.medial": "meniscus",
    "anatomy.meniscus.tear": "tear",
    "anatomy.ligament.cruciate": "ligaments",
    "procedure.portals": "portals",
  };
  return targets[target];
}

function stepToStage(step = "orientation"): ProcedureStage {
  const stages: Record<string, ProcedureStage> = {
    orientation: "overview",
    tear: "tear",
    scope: "scope",
    treatment: "treatment",
    recovery: "recovery",
  };
  return stages[step] ?? "overview";
}

function translateAtomicAction(action: VizAtomicAction): AnatomyCommand[] {
  switch (action.type) {
    case "scene.reset":
      return [{ type: "reset" }];
    case "scene.setMode":
      return [{ type: "set-stage", stage: action.mode === "recovery" ? "recovery" : "overview" }];
    case "camera.orbit":
      return [{ type: "rotate", direction: action.yawDeg < 0 ? "left" : "right" }];
    case "camera.zoom":
      return [{ type: "zoom", direction: action.factor >= 1 ? "in" : "out" }];
    case "target.select":
    case "target.isolate": {
      const target = action.targets[0];
      if (!target) return [];
      return [{ type: "focus", target: targetToAnatomyTarget(target) }];
    }
    case "procedure.preview":
      return [
        { type: "set-stage", stage: stepToStage(action.stepId) },
        ...(action.autoplay ? [{ type: "set-auto-rotate", enabled: true } as AnatomyCommand] : []),
      ];
  }
}

export function translateVizCommand(command: VizCommandV1): AnatomyCommand[] {
  if (command.schema !== "consentloop.viz-command.v1") return [];
  if (command.action.type === "batch") {
    return command.action.actions.flatMap(translateAtomicAction);
  }
  return translateAtomicAction(command.action);
}

declare global {
  interface Window {
    consentLoopViz?: {
      execute: (command: VizCommandV1) => Promise<VizResultV1>;
      capabilities: typeof vizCapabilities;
    };
  }
}

