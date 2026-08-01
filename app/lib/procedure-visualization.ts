import type { ComprehensionConceptId } from "@consentloop/shared";

export const bodyViews = [
  "front",
  "back",
  "left",
  "right",
  "three-quarter",
] as const;

export type BodyView = (typeof bodyViews)[number];

export const visualModes = ["normal", "transparent", "xray", "isolated"] as const;
export type VisualMode = (typeof visualModes)[number];

export const highlightColors = ["blue", "orange", "red", "green"] as const;
export type HighlightColor = (typeof highlightColors)[number];

export const visualizationStates = [
  "loading",
  "overview",
  "focusing-region",
  "entering-procedure",
  "procedure",
  "asking-teachback",
  "misconception-detected",
  "clarifying",
  "understood",
  "clinician-review",
  "returning-to-overview",
] as const;

export type VisualizationState = (typeof visualizationStates)[number];

export interface BodyRegion {
  id: string;
  label: string;
  side?: "left" | "right" | "center";
  worldPosition: [number, number, number];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  highlightColor: string;
  procedureSceneId: string;
}

export const bodyRegions = {
  "right-knee": {
    id: "right-knee",
    label: "Right knee",
    side: "right",
    worldPosition: [-0.42, -1.46, 0.08],
    cameraPosition: [0.95, -1.3, 3.2],
    cameraTarget: [-0.42, -1.46, 0.08],
    highlightColor: "#2f8cff",
    procedureSceneId: "knee-arthroscopy",
  },
} as const satisfies Record<string, BodyRegion>;

export type BodyRegionId = keyof typeof bodyRegions;
export const bodyRegionIds = Object.keys(bodyRegions) as BodyRegionId[];

export const procedureIds = ["knee-arthroscopy"] as const;
export type ProcedureId = (typeof procedureIds)[number];

export const structureIds = [
  "whole-knee",
  "meniscus",
  "meniscus-tear",
  "cruciate-ligaments",
  "camera-portals",
  "treated-meniscus",
  "incision-risk-area",
] as const;

export type StructureId = (typeof structureIds)[number];

export type VisualizationCommand =
  | { type: "SHOW_BODY_OVERVIEW"; view?: BodyView }
  | { type: "FOCUS_BODY_REGION"; regionId: BodyRegionId }
  | { type: "ENTER_PROCEDURE"; procedureId: ProcedureId }
  | {
      type: "PLAY_PROCEDURE_STEP";
      procedureId: ProcedureId;
      stepId: string;
    }
  | {
      type: "HIGHLIGHT_STRUCTURE";
      structureId: StructureId;
      color: HighlightColor;
    }
  | { type: "SET_VISUAL_MODE"; mode: VisualMode }
  | { type: "RETURN_TO_OVERVIEW" }
  | { type: "RESET_VISUALIZATION" };

export type ProcedureRenderStage =
  | "overview"
  | "tear"
  | "scope"
  | "treatment"
  | "recovery";

export interface ProcedureStep {
  id: string;
  title: string;
  narration: string;
  sceneCommand: VisualizationCommand;
  requiredConceptId?: ComprehensionConceptId;
  patientQuestionPrompt?: string;
  render: {
    stage: ProcedureRenderStage;
    target: "body" | "knee" | "meniscus" | "tear" | "ligaments" | "portals";
    state?: VisualizationState;
    visualMode?: VisualMode;
    highlight?: { structureId: StructureId; color: HighlightColor };
    comparison?: boolean;
  };
}

export interface ProcedureVisualization {
  id: ProcedureId;
  title: string;
  educationalLabel: string;
  regionId: BodyRegionId;
  steps: readonly ProcedureStep[];
}

const step = (
  value: Omit<ProcedureStep, "sceneCommand">,
): ProcedureStep => ({
  ...value,
  sceneCommand: {
    type: "PLAY_PROCEDURE_STEP",
    procedureId: "knee-arthroscopy",
    stepId: value.id,
  },
});

export const kneeArthroscopyProcedure: ProcedureVisualization = {
  id: "knee-arthroscopy",
  title: "Right knee arthroscopy",
  educationalLabel: "Illustrative anatomy · not surgical navigation",
  regionId: "right-knee",
  steps: [
    step({
      id: "body-overview",
      title: "Whole-body orientation",
      narration:
        "We will begin with the whole person, then move to the right knee named in the procedure plan.",
      render: { stage: "overview", target: "body", state: "overview" },
    }),
    step({
      id: "affected-knee",
      title: "Affected knee location",
      narration:
        "The procedure is localized to the right knee. The rest of the body is shown only for orientation.",
      render: {
        stage: "overview",
        target: "knee",
        state: "focusing-region",
        highlight: { structureId: "whole-knee", color: "blue" },
      },
    }),
    step({
      id: "normal-anatomy",
      title: "Normal knee anatomy",
      narration:
        "The detailed view shows the bones, cartilage, meniscus, and nearby ligaments inside the knee.",
      render: {
        stage: "overview",
        target: "knee",
        state: "procedure",
        visualMode: "normal",
      },
    }),
    step({
      id: "damaged-structure",
      title: "Damaged meniscus",
      narration:
        "The highlighted spot is the torn meniscus, a small crescent of cushioning tissue inside the joint.",
      requiredConceptId: "tissue-treated",
      render: {
        stage: "tear",
        target: "tear",
        state: "procedure",
        visualMode: "isolated",
        highlight: { structureId: "meniscus-tear", color: "orange" },
      },
    }),
    step({
      id: "access-point",
      title: "Camera access point",
      narration:
        "Arthroscopy uses small portals for a camera and instruments rather than replacing the complete joint.",
      requiredConceptId: "procedure-identity",
      render: {
        stage: "scope",
        target: "portals",
        state: "procedure",
        highlight: { structureId: "camera-portals", color: "blue" },
      },
    }),
    step({
      id: "treatment-action",
      title: "Possible treatment action",
      narration:
        "The surgeon first inspects the tear. Damaged tissue may be repaired or only a limited unstable edge may be trimmed.",
      requiredConceptId: "tissue-treated",
      render: {
        stage: "treatment",
        target: "meniscus",
        state: "procedure",
        visualMode: "isolated",
        highlight: { structureId: "treated-meniscus", color: "orange" },
      },
    }),
    step({
      id: "expected-result",
      title: "Expected result",
      narration:
        "The goal is to address the unstable torn area while preserving healthy tissue when possible; individual outcomes vary.",
      render: {
        stage: "recovery",
        target: "meniscus",
        state: "procedure",
        highlight: { structureId: "treated-meniscus", color: "green" },
      },
    }),
    step({
      id: "important-risk",
      title: "Important risk area",
      narration:
        "The small access sites can have risks such as infection. This illustration is educational and not a patient-specific prediction.",
      requiredConceptId: "risk-limitation",
      render: {
        stage: "scope",
        target: "portals",
        state: "procedure",
        highlight: { structureId: "incision-risk-area", color: "red" },
      },
    }),
    step({
      id: "misconception-comparison",
      title: "Whole joint versus treated tissue",
      narration:
        "This is not a whole-knee replacement. The complete joint is shown faintly in red while the much smaller meniscus area is orange.",
      requiredConceptId: "tissue-treated",
      render: {
        stage: "treatment",
        target: "meniscus",
        state: "misconception-detected",
        visualMode: "isolated",
        highlight: { structureId: "treated-meniscus", color: "orange" },
        comparison: true,
      },
    }),
    step({
      id: "patient-teachback",
      title: "Patient teach-back",
      narration:
        "Please explain which part may be treated and how that differs from replacing the whole knee.",
      requiredConceptId: "tissue-treated",
      patientQuestionPrompt:
        "In your own words, what part of the knee may be treated?",
      render: {
        stage: "treatment",
        target: "meniscus",
        state: "asking-teachback",
        visualMode: "isolated",
        highlight: { structureId: "treated-meniscus", color: "orange" },
        comparison: true,
      },
    }),
    step({
      id: "completion",
      title: "Education step complete",
      narration:
        "The treatment-target explanation is complete. A clinician still confirms the plan and answers unresolved questions.",
      render: {
        stage: "recovery",
        target: "knee",
        state: "understood",
        highlight: { structureId: "treated-meniscus", color: "green" },
      },
    }),
  ],
};

export const procedureVisualizations: Record<ProcedureId, ProcedureVisualization> = {
  "knee-arthroscopy": kneeArthroscopyProcedure,
};

export const procedureStepIds = kneeArthroscopyProcedure.steps.map(
  (procedureStep) => procedureStep.id,
);

export function getProcedureStep(
  procedureId: ProcedureId,
  stepId: string,
): ProcedureStep | undefined {
  return procedureVisualizations[procedureId].steps.find(
    (procedureStep) => procedureStep.id === stepId,
  );
}

export const bodyViewYaw: Record<BodyView, number> = {
  front: 0,
  back: Math.PI,
  left: -Math.PI / 2,
  right: Math.PI / 2,
  "three-quarter": Math.PI / 4,
};
