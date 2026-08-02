import type {
  AgentSessionConfig,
  AgentSettingsObject,
  FunctionCallItem,
  ThinkSettings,
  TokenFactory,
} from "@deepgram/agents";

import {
  careOptions,
  costBreakdown,
  patient,
  timeline,
  type JourneyView,
  type OptionId,
} from "./demo-data";
import {
  bodyRegionIds,
  bodyViews,
  getProcedureStep,
  highlightColors,
  procedureIds,
  procedureStepIds,
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
import type { VisualizationSnapshot } from "./visualization-controller";

export const visualizationVoiceToolNames = [
  "show_body_overview",
  "focus_body_region",
  "enter_procedure",
  "play_procedure_step",
  "highlight_structure",
  "set_visual_mode",
  "return_to_overview",
] as const;

export const voiceToolNames = [
  "open_consent_section",
  ...visualizationVoiceToolNames,
  "inspect_current_visual",
  "focus_option",
  "request_human",
] as const;

export type VoiceToolName = (typeof voiceToolNames)[number];

export const humanDestinations = ["clinician", "scheduler", "financial"] as const;

export type HumanDestination = (typeof humanDestinations)[number];

export type VoiceToolCall =
  | {
      id: string;
      name: "open_consent_section";
      arguments: { section: JourneyView };
    }
  | {
      id: string;
      name: "show_body_overview";
      arguments: { view?: BodyView };
    }
  | {
      id: string;
      name: "focus_body_region";
      arguments: { regionId: BodyRegionId };
    }
  | {
      id: string;
      name: "enter_procedure";
      arguments: { procedureId: ProcedureId };
    }
  | {
      id: string;
      name: "play_procedure_step";
      arguments: { procedureId: ProcedureId; stepId: string };
    }
  | {
      id: string;
      name: "highlight_structure";
      arguments: { structureId: StructureId; color: HighlightColor };
    }
  | {
      id: string;
      name: "set_visual_mode";
      arguments: { mode: VisualMode };
    }
  | {
      id: string;
      name: "return_to_overview";
      arguments: Record<string, never>;
    }
  | {
      id: string;
      name: "inspect_current_visual";
      arguments: { reference?: string };
    }
  | {
      id: string;
      name: "focus_option";
      arguments: { option: OptionId };
    }
  | {
      id: string;
      name: "request_human";
      arguments: {
        destination: HumanDestination;
        reason?: string;
        confirmed_by_user: true;
      };
    };

export type VisualizationVoiceToolCall = Extract<
  VoiceToolCall,
  { name: (typeof visualizationVoiceToolNames)[number] }
>;

export interface VoiceNarrationCue {
  procedureId: ProcedureId;
  stepId: string;
  title: string;
  /** Approved patient-facing copy from the procedure configuration. */
  text: string;
  speakAfterSettled: true;
}

export interface SettledVisualizationMetadata {
  transitionCompleted: true;
  stateRevision: number;
  visualState: VisualizationState;
  viewMode: "body" | "knee";
  activeRegionId: BodyRegionId | null;
  procedureId: ProcedureId | null;
  stepId: string | null;
  stage: ProcedureRenderStage;
}

export interface VisibleStructureContext {
  structureId: StructureId;
  label: string;
  color: HighlightColor;
  colorDescription: string;
  whatItIs: string;
  whyItIsHighlighted: string;
}

export interface VisibleScenePartContext {
  partId: string;
  label: string;
  visualColor: string;
  active: boolean;
  whatItIs: string;
}

export interface VisualReferenceResolution {
  reference: string;
  status: "matched" | "ambiguous" | "not-visible";
  matchedPart: VisibleScenePartContext | null;
  patientExplanation: string;
}

export interface CurrentVisualContext {
  viewerVisible: boolean;
  ready: boolean;
  viewMode: "body" | "knee" | "unavailable";
  stepId: string | null;
  stepTitle: string;
  sceneSummary: string;
  whatIsHappening: string;
  damagedArea: string;
  primaryHighlight: VisibleStructureContext | null;
  visibleHighlights: VisibleStructureContext[];
  visibleSceneParts: VisibleScenePartContext[];
  referenceResolution: VisualReferenceResolution | null;
  visualMode: VisualMode | null;
  comparisonVisible: boolean;
  careTeamConfirmation: string;
}

export type VoiceToolExecutionResult =
  | {
      ok: true;
      message?: string;
      settled?: SettledVisualizationMetadata;
      scenePreparation?: {
        applied: true;
        commandCount: number;
      };
      narration?: VoiceNarrationCue;
      nextApprovedAction?: string;
      waitForPatientResponse?: true;
      visualContext?: CurrentVisualContext;
    }
  | { ok: false; error: string };

export type VoiceToolHandler = (
  call: VoiceToolCall,
) =>
  | void
  | VoiceToolExecutionResult
  | Promise<void | VoiceToolExecutionResult>;

export type VoiceToolValidationResult =
  | { ok: true; call: VoiceToolCall }
  | { ok: false; error: string };

export type VoiceToolWireCall = Pick<
  FunctionCallItem,
  "id" | "name" | "arguments" | "client_side"
>;

const journeyViews: readonly JourneyView[] = [
  "overview",
  "anatomy",
  "options",
  "plan",
  "costs",
  "teachback",
  "review",
];

const optionIds: readonly OptionId[] = ["therapy", "trim", "repair"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Converts a Deepgram client-side function call into the small, validated UI
 * command union consumed by the demo. Unknown tools, extra keys, and invalid
 * enum values are rejected before any UI callback runs.
 */
export function normalizeVoiceToolCall(
  wireCall: VoiceToolWireCall,
): VoiceToolValidationResult {
  if (!wireCall.client_side) {
    return { ok: false, error: "This function is not marked for client-side execution." };
  }

  if (!wireCall.id || !isMember(wireCall.name, voiceToolNames)) {
    return { ok: false, error: "Unknown voice function." };
  }

  const args = parseArguments(wireCall.arguments);
  if (!args) {
    return { ok: false, error: "Function arguments must be a JSON object." };
  }

  switch (wireCall.name) {
    case "open_consent_section":
      if (!hasOnlyKeys(args, ["section"]) || !isMember(args.section, journeyViews)) {
        return { ok: false, error: "Invalid consent section." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: { section: args.section },
        },
      };

    case "show_body_overview":
      if (
        !hasOnlyKeys(args, ["view"]) ||
        (args.view !== undefined && !isMember(args.view, bodyViews))
      ) {
        return { ok: false, error: "Invalid body overview request." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: args.view === undefined ? {} : { view: args.view },
        },
      };

    case "focus_body_region":
      if (
        !hasOnlyKeys(args, ["regionId"]) ||
        !isMember(args.regionId, bodyRegionIds)
      ) {
        return { ok: false, error: "Invalid or unsupported body region." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: { regionId: args.regionId },
        },
      };

    case "enter_procedure":
      if (
        !hasOnlyKeys(args, ["procedureId"]) ||
        !isMember(args.procedureId, procedureIds)
      ) {
        return { ok: false, error: "Invalid or unsupported procedure." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: { procedureId: args.procedureId },
        },
      };

    case "play_procedure_step":
      if (
        !hasOnlyKeys(args, ["procedureId", "stepId"]) ||
        !isMember(args.procedureId, procedureIds) ||
        typeof args.stepId !== "string" ||
        !getProcedureStep(args.procedureId, args.stepId)
      ) {
        return { ok: false, error: "Invalid procedure and step combination." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: {
            procedureId: args.procedureId,
            stepId: args.stepId,
          },
        },
      };

    case "highlight_structure":
      if (
        !hasOnlyKeys(args, ["structureId", "color"]) ||
        !isMember(args.structureId, structureIds) ||
        !isMember(args.color, highlightColors)
      ) {
        return { ok: false, error: "Invalid structure highlight request." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: {
            structureId: args.structureId,
            color: args.color,
          },
        },
      };

    case "set_visual_mode":
      if (!hasOnlyKeys(args, ["mode"]) || !isMember(args.mode, visualModes)) {
        return { ok: false, error: "Invalid visualization mode." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: { mode: args.mode },
        },
      };

    case "return_to_overview":
      if (!hasOnlyKeys(args, [])) {
        return { ok: false, error: "Return to overview does not accept arguments." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: {},
        },
      };

    case "inspect_current_visual":
      if (
        !hasOnlyKeys(args, ["reference"]) ||
        (args.reference !== undefined &&
          (typeof args.reference !== "string" ||
            args.reference.trim().length === 0 ||
            args.reference.length > 180))
      ) {
        return { ok: false, error: "Visual inspection reference is invalid." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: {
            ...(typeof args.reference === "string"
              ? { reference: args.reference.trim() }
              : {}),
          },
        },
      };

    case "focus_option":
      if (!hasOnlyKeys(args, ["option"]) || !isMember(args.option, optionIds)) {
        return { ok: false, error: "Invalid care option." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: { option: args.option },
        },
      };

    case "request_human": {
      const reason = args.reason;
      if (
        !hasOnlyKeys(args, ["destination", "reason", "confirmed_by_user"]) ||
        !isMember(args.destination, humanDestinations) ||
        args.confirmed_by_user !== true ||
        (reason !== undefined &&
          (typeof reason !== "string" || reason.trim().length === 0 || reason.length > 280))
      ) {
        return { ok: false, error: "A confirmed, valid human handoff is required." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: {
            destination: args.destination,
            confirmed_by_user: true,
            ...(typeof reason === "string" ? { reason: reason.trim() } : {}),
          },
        },
      };
    }
  }
}

/**
 * Recovers the narrow pseudo-call shape occasionally emitted as assistant text
 * by an upstream model. Only allowlisted visualization tools are accepted; all
 * writes, navigation, option, and handoff tools remain unavailable here.
 */
export function recoverLiteralVisualizationToolCall(
  content: string,
  id = `literal-visual-${Date.now()}`,
): VoiceToolValidationResult | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const match = /^\{\s*([a-z][a-z0-9_]*)\s+(\{[\s\S]*\})\s*\}$/u.exec(trimmed);
  if (!match) return null;

  const [, name, rawArguments] = match;
  if (!isMember(name, visualizationVoiceToolNames)) return null;
  return normalizeVoiceToolCall({
    id,
    name,
    arguments: rawArguments,
    client_side: true,
  });
}

/**
 * Identifies the explicit patient requests that opt into the deterministic,
 * multi-step procedure walkthrough. Any later free-form patient question
 * pauses automatic progression until they explicitly ask to resume it.
 */
export function isFullProcedureWalkthroughRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return /\b(?:walk\s*me\s*through|walkthrough|whole\s+(?:knee\s+)?procedure|entire\s+(?:knee\s+)?procedure|full\s+(?:knee\s+)?procedure|(?:continue|resume)\s+(?:the\s+)?(?:walkthrough|procedure))\b/u.test(
    normalized,
  );
}

/**
 * Maps common patient language to an exact approved procedure destination.
 * The visualization planner restores whole-body and knee prerequisites, so a
 * request such as “show the possible treatment” lands on the requested scene
 * instead of stopping at the right-knee overview.
 */
export function getRequestedProcedureDestination(
  content: string,
  id = `patient-destination-${Date.now()}`,
): Extract<VisualizationVoiceToolCall, { name: "play_procedure_step" }> | null {
  const normalized = content.trim().toLowerCase();
  const procedureId = "knee-arthroscopy" as const;
  let stepId: string | null = null;

  if (
    /\b(?:show|display|visualize|explain|take me to|go to)\b[\s\S]*\b(?:possible treatment|treatment action|treated area|repair|trim|trimmed|repaired)\b/u.test(normalized) ||
    /\bwhat (?:might|may|could) be (?:trimmed|repaired|treated)\b/u.test(normalized)
  ) {
    stepId = "treatment-action";
  } else if (
    /\b(?:show|display|visualize|explain)\b[\s\S]*\b(?:damaged part|damage|tear|torn part)\b/u.test(normalized)
  ) {
    stepId = "damaged-structure";
  } else if (
    /\b(?:show|display|visualize|explain|how)\b[\s\S]*\b(?:camera|portal|access point|enter)\b/u.test(normalized)
  ) {
    stepId = "access-point";
  } else if (
    /\b(?:show|display|visualize|explain)\b[\s\S]*\b(?:risk|infection|incision)\b/u.test(normalized)
  ) {
    stepId = "important-risk";
  } else if (
    /\b(?:show|display|visualize|explain)\b[\s\S]*\b(?:expected result|after treatment|preserved tissue)\b/u.test(normalized)
  ) {
    stepId = "expected-result";
  }

  return stepId
    ? {
        id,
        name: "play_procedure_step",
        arguments: { procedureId, stepId },
      }
    : null;
}

export function isVisualizationVoiceToolCall(
  call: VoiceToolCall,
): call is VisualizationVoiceToolCall {
  return isMember(call.name, visualizationVoiceToolNames);
}

const structureVoiceFacts: Record<
  StructureId,
  { label: string; whatItIs: string }
> = {
  "whole-knee": {
    label: "whole right knee",
    whatItIs:
      "The complete right knee joint is shown for orientation; the plan is not to replace the whole joint.",
  },
  meniscus: {
    label: "meniscus",
    whatItIs:
      "The meniscus is crescent-shaped cushioning tissue between the thigh bone and shin bone.",
  },
  "meniscus-tear": {
    label: "torn meniscus area",
    whatItIs:
      "This is the torn area of the right meniscus identified for the procedure discussion. It is a meniscus tear, not a muscle tear.",
  },
  "cruciate-ligaments": {
    label: "cruciate ligaments",
    whatItIs:
      "The ACL and PCL are central stabilizing ligaments shown for orientation; they are not the treatment target in this procedure plan.",
  },
  "camera-portals": {
    label: "arthroscopy camera portals",
    whatItIs:
      "These are the two small access openings used for the camera and instruments.",
  },
  "treated-meniscus": {
    label: "meniscus tissue that may be treated",
    whatItIs:
      "This is the limited meniscus area the surgeon would inspect and might repair or trim, depending on what is found.",
  },
  "incision-risk-area": {
    label: "small portal risk area",
    whatItIs:
      "This marks the small access-site area where risks such as infection are discussed.",
  },
};

const highlightColorDescriptions: Record<HighlightColor, string> = {
  blue: "blue, meaning orientation or access",
  orange:
    "orange or amber; lighting can make it look yellow, meaning damaged tissue or tissue that may be treated",
  red: "red, meaning a risk area or whole-joint comparison",
  green: "green, meaning the explained target or expected end state",
};

const highlightColorMeanings: Record<HighlightColor, string> = {
  blue: "It is highlighted to orient you to the location or access point.",
  orange: "It is highlighted because it is damaged tissue or tissue that may be treated.",
  red: "It is highlighted for a risk or whole-joint comparison, not as a prediction.",
  green: "It is highlighted to show the preserved or explained treatment target.",
};

function toVisibleStructureContext(
  structureId: StructureId,
  color: HighlightColor,
): VisibleStructureContext {
  const facts = structureVoiceFacts[structureId];
  const isRedTear = structureId === "meniscus-tear" && color === "red";
  return {
    structureId,
    label: facts.label,
    color,
    colorDescription: isRedTear
      ? "bright red, marking the torn meniscus area"
      : highlightColorDescriptions[color],
    whatItIs: facts.whatItIs,
    whyItIsHighlighted: isRedTear
      ? "It is highlighted because this is the damaged meniscus area being discussed. The meniscus is cartilage-like cushioning tissue, not a muscle."
      : highlightColorMeanings[color],
  };
}

const detailedKneeSceneParts: readonly VisibleScenePartContext[] = [
  {
    partId: "femur",
    label: "femur, or thigh bone",
    visualColor: "ivory white",
    active: false,
    whatItIs: "The upper white bone is the femur, which forms the top of the knee joint.",
  },
  {
    partId: "tibia-fibula",
    label: "tibia and fibula",
    visualColor: "ivory white",
    active: false,
    whatItIs: "The lower white bones are the tibia and fibula; the tibia carries most of the load through the knee.",
  },
  {
    partId: "patella",
    label: "patella, or kneecap",
    visualColor: "ivory white",
    active: false,
    whatItIs: "The rounded white bone at the front is the patella, also called the kneecap.",
  },
  {
    partId: "articular-cartilage",
    label: "articular cartilage",
    visualColor: "translucent cyan blue",
    active: false,
    whatItIs: "The translucent blue layer is smooth articular cartilage covering the joint surfaces.",
  },
  {
    partId: "meniscus",
    label: "meniscus",
    visualColor: "deep red crescent tissue",
    active: false,
    whatItIs: "The red crescent-shaped tissue is the meniscus, which cushions the knee. It is not a muscle.",
  },
  {
    partId: "cruciate-ligaments",
    label: "ACL and PCL ligaments",
    visualColor: "tan bands",
    active: false,
    whatItIs: "The central tan bands are the ACL and PCL, ligaments that help stabilize the knee.",
  },
  {
    partId: "meniscus-tear",
    label: "bright red meniscus tear marker",
    visualColor: "bright red spot",
    active: false,
    whatItIs: "The bright red spot marks the torn area of the meniscus. It is a meniscus tear, not a muscle tear.",
  },
];

function scenePartForHighlight(
  highlight: VisibleStructureContext,
): VisibleScenePartContext {
  return {
    partId: highlight.structureId,
    label: highlight.label,
    visualColor: highlight.colorDescription,
    active: true,
    whatItIs: `${highlight.whatItIs} ${highlight.whyItIsHighlighted}`,
  };
}

function resolveVisualReference(
  reference: string | undefined,
  parts: readonly VisibleScenePartContext[],
): VisualReferenceResolution | null {
  const originalReference = reference?.trim();
  if (!originalReference) return null;
  const normalized = originalReference.toLowerCase();

  const wantsRed = /\b(?:red|crimson|pink)\b/u.test(normalized);
  const wantsOrange = /\b(?:orange|amber|yellow)\b/u.test(normalized);
  const wantsBlue = /\b(?:blue|cyan|aqua)\b/u.test(normalized);
  const wantsWhite = /\b(?:white|ivory|bone)\b/u.test(normalized);
  const wantsTear = /\b(?:tear|torn|damage|damaged|broken|muscle)\b/u.test(normalized);
  const wantsMeniscus = /\bmeniscus\b/u.test(normalized);
  const wantsLigament = /\b(?:ligament|acl|pcl)\b/u.test(normalized);
  const wantsCartilage = /\bcartilage\b/u.test(normalized);
  const wantsKneecap = /\b(?:patella|kneecap)\b/u.test(normalized);
  const wantsGenericPart = /\b(?:this|that|part|here)\b/u.test(normalized);

  const scored = parts
    .map((part) => {
      const searchable = `${part.partId} ${part.label} ${part.visualColor} ${part.whatItIs}`.toLowerCase();
      let score = 0;
      if (wantsRed && /red|crimson|pink/u.test(part.visualColor)) score += 8;
      if (wantsOrange && /orange|amber|yellow/u.test(part.visualColor)) score += 8;
      if (wantsBlue && /blue|cyan|aqua/u.test(part.visualColor)) score += 8;
      if (wantsWhite && /white|ivory/u.test(part.visualColor)) score += 8;
      if (wantsTear && part.partId === "meniscus-tear") score += 12;
      if (wantsMeniscus && /meniscus/u.test(searchable)) score += 7;
      if (wantsLigament && /ligament|acl|pcl/u.test(searchable)) score += 10;
      if (wantsCartilage && /cartilage/u.test(searchable)) score += 10;
      if (wantsKneecap && /patella|kneecap/u.test(searchable)) score += 10;
      if (score > 0 && part.active) score += 12;
      if (score === 0 && wantsGenericPart && part.active) score += 6;
      return { part, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  const first = scored[0];
  if (!first) {
    return {
      reference: originalReference,
      status: "not-visible",
      matchedPart: null,
      patientExplanation:
        "I cannot identify that part from the current scene state. Please describe its color or name, or move to the step where it is highlighted.",
    };
  }

  const tied = scored.filter(({ score }) => score === first.score);
  if (tied.length > 1) {
    const labels = tied.slice(0, 3).map(({ part }) => part.label).join(" and ");
    return {
      reference: originalReference,
      status: "ambiguous",
      matchedPart: null,
      patientExplanation: `There is more than one matching part in view: ${labels}. The brighter red spot marks the meniscus tear; the darker red crescent is the meniscus tissue around it. Which one do you mean?`,
    };
  }

  return {
    reference: originalReference,
    status: "matched",
    matchedPart: first.part,
    patientExplanation: first.part.whatItIs,
  };
}

/**
 * Returns a patient-safe description of the exact renderer state. Deepgram
 * calls this before answering deictic questions such as “what is this yellow
 * part?” so its answer is grounded in the current model rather than memory.
 */
export function getCurrentVisualContext(
  snapshot: VisualizationSnapshot | null,
  viewerVisible = true,
  reference?: string,
): CurrentVisualContext {
  const careTeamConfirmation =
    "The visualization follows the procedure plan prepared for this consent session. The care team confirms the final findings and treatment.";
  if (!snapshot) {
    return {
      viewerVisible,
      ready: false,
      viewMode: "unavailable",
      stepId: null,
      stepTitle: "Visualization not ready",
      sceneSummary: "The 3D viewer has not reported a visible scene yet.",
      whatIsHappening:
        "Open the anatomy view and begin the approved procedure walkthrough before describing a visible part.",
      damagedArea:
        "The procedure discussion concerns a torn right meniscus, but no current highlight has been confirmed.",
      primaryHighlight: null,
      visibleHighlights: [],
      visibleSceneParts: [],
      referenceResolution: resolveVisualReference(reference, []),
      visualMode: null,
      comparisonVisible: false,
      careTeamConfirmation,
    };
  }

  const procedureStep = snapshot.procedureId && snapshot.stepId
    ? getProcedureStep(snapshot.procedureId, snapshot.stepId)
    : undefined;
  const activeHighlights =
    snapshot.viewMode === "body" && snapshot.target === "body"
      ? []
      : snapshot.highlights;
  const visibleHighlights = activeHighlights.map((highlight) =>
    toVisibleStructureContext(highlight.structureId, highlight.color),
  );
  if (
    snapshot.comparison &&
    !visibleHighlights.some((highlight) => highlight.structureId === "whole-knee")
  ) {
    visibleHighlights.unshift(toVisibleStructureContext("whole-knee", "red"));
  }
  const primaryHighlight = visibleHighlights.at(-1) ?? null;
  const visibleSceneParts: VisibleScenePartContext[] = snapshot.viewMode === "knee"
    ? detailedKneeSceneParts.map((part) => ({ ...part }))
    : [
        {
          partId: "whole-body",
          label: "whole-person anatomy",
          visualColor: "translucent blue-gray",
          active: snapshot.target === "body",
          whatItIs: "The whole person is shown to orient the procedure to the right knee.",
        },
      ];
  for (const highlight of visibleHighlights) {
    const activePart = scenePartForHighlight(highlight);
    const existingIndex = visibleSceneParts.findIndex(
      (part) => part.partId === activePart.partId,
    );
    if (existingIndex >= 0) visibleSceneParts[existingIndex] = activePart;
    else visibleSceneParts.push(activePart);
  }
  let referenceResolution = resolveVisualReference(reference, visibleSceneParts);
  const viewDescription = snapshot.viewMode === "body"
    ? "whole-person orientation view"
    : "detailed right-knee view";
  const highlightDescription = primaryHighlight
    ? ` The main highlight is the ${primaryHighlight.label}, shown ${primaryHighlight.colorDescription}.`
    : " No structure is currently highlighted.";
  if (
    reference &&
    /\b(?:what (?:is|are) happening|what am i seeing|what is on (?:the )?screen|explain (?:this|the) (?:view|screen))\b/iu.test(reference)
  ) {
    referenceResolution = {
      reference: reference.trim(),
      status: "matched",
      matchedPart: null,
      patientExplanation: `${procedureStep?.narration ?? `The model is showing the ${viewDescription}.`}${highlightDescription}`,
    };
  }

  return {
    viewerVisible,
    ready: snapshot.visualState !== "loading",
    viewMode: snapshot.viewMode,
    stepId: snapshot.stepId,
    stepTitle: procedureStep?.title ?? "Interactive anatomy",
    sceneSummary: `The model is showing the ${viewDescription}.${highlightDescription}`,
    whatIsHappening:
      procedureStep?.narration ??
      "The model is providing anatomical orientation for the right-knee procedure discussion.",
    damagedArea:
      primaryHighlight?.structureId === "meniscus-tear"
        ? "The bright red marker is the torn part of the right meniscus. The meniscus is cushioning tissue, not a muscle."
        : "The damaged structure described for this consent session is the torn right meniscus; it may not be the structure highlighted in the current step.",
    primaryHighlight,
    visibleHighlights,
    visibleSceneParts,
    referenceResolution,
    visualMode: snapshot.visualMode,
    comparisonVisible: snapshot.comparison,
    careTeamConfirmation,
  };
}

export const batchedVisualizationProtocolError =
  "Only one visual transition is allowed per function-call request. Narrate the first settled step before requesting the next visual action.";

export type VoiceNarrationBarrierState = "ready" | "awaiting-narration";
export type VoiceNarrationBarrierEvent =
  | "visual-settled"
  | "audio-finished"
  | "user-interrupted"
  | "reset";

export function reduceVoiceNarrationBarrier(
  state: VoiceNarrationBarrierState,
  event: VoiceNarrationBarrierEvent,
): VoiceNarrationBarrierState {
  if (event === "visual-settled") return "awaiting-narration";
  if (
    event === "audio-finished" ||
    event === "user-interrupted" ||
    event === "reset"
  ) {
    return "ready";
  }
  return state;
}

export interface VoiceNarrationBarrier {
  readonly state: VoiceNarrationBarrierState;
  transition: (event: VoiceNarrationBarrierEvent) => void;
  waitUntilReady: () => Promise<void>;
}

/**
 * Coordinates visual tool calls with audible narration. A visual transition
 * that arrives early waits here until playback finishes, the patient
 * interrupts, or the owning session is reset.
 */
export function createVoiceNarrationBarrier(): VoiceNarrationBarrier {
  let state: VoiceNarrationBarrierState = "ready";
  const readyWaiters = new Set<() => void>();

  return {
    get state() {
      return state;
    },
    transition(event) {
      state = reduceVoiceNarrationBarrier(state, event);
      if (state !== "ready") return;

      const waiters = [...readyWaiters];
      readyWaiters.clear();
      waiters.forEach((resolve) => resolve());
    },
    waitUntilReady() {
      if (state === "ready") return Promise.resolve();
      return new Promise<void>((resolve) => readyWaiters.add(resolve));
    },
  };
}

/** Marks every visual call after the first in one server request for rejection. */
export function getVoiceFunctionProtocolErrors(
  wireCalls: readonly VoiceToolWireCall[],
): Array<string | undefined> {
  let visualFunctionSeen = false;
  return wireCalls.map((wireCall) => {
    const normalized = normalizeVoiceToolCall(wireCall);
    const isVisual = normalized.ok && isVisualizationVoiceToolCall(normalized.call);
    if (!isVisual) return undefined;
    if (visualFunctionSeen) return batchedVisualizationProtocolError;
    visualFunctionSeen = true;
    return undefined;
  });
}

/**
 * Maps a validated visual voice call to the renderer-agnostic command consumed
 * by the visualization controller. Voice code never receives scene objects,
 * camera coordinates, materials, or animation handles.
 */
export function voiceToolToVisualizationCommand(
  call: VisualizationVoiceToolCall,
): VisualizationCommand {
  switch (call.name) {
    case "show_body_overview":
      return call.arguments.view === undefined
        ? { type: "SHOW_BODY_OVERVIEW" }
        : { type: "SHOW_BODY_OVERVIEW", view: call.arguments.view };
    case "focus_body_region":
      return {
        type: "FOCUS_BODY_REGION",
        regionId: call.arguments.regionId,
      };
    case "enter_procedure":
      return {
        type: "ENTER_PROCEDURE",
        procedureId: call.arguments.procedureId,
      };
    case "play_procedure_step":
      return {
        type: "PLAY_PROCEDURE_STEP",
        procedureId: call.arguments.procedureId,
        stepId: call.arguments.stepId,
      };
    case "highlight_structure":
      return {
        type: "HIGHLIGHT_STRUCTURE",
        structureId: call.arguments.structureId,
        color: call.arguments.color,
      };
    case "set_visual_mode":
      return {
        type: "SET_VISUAL_MODE",
        mode: call.arguments.mode,
      };
    case "return_to_overview":
      return { type: "RETURN_TO_OVERVIEW" };
  }
}

export interface VoiceWalkthroughAction {
  stepId: string;
  toolName: VisualizationVoiceToolCall["name"];
  arguments: Record<string, string>;
}

/**
 * The canonical agent-guided walkthrough. The first three actions deliberately
 * keep the whole person visible, highlight the right knee, and only then enter
 * the detailed knee scene. Each remaining action advances exactly one approved
 * procedure step.
 */
export const kneeArthroscopyVoiceWalkthrough: readonly VoiceWalkthroughAction[] = [
  {
    stepId: "body-overview",
    toolName: "show_body_overview",
    arguments: { view: "three-quarter" },
  },
  {
    stepId: "affected-knee",
    toolName: "focus_body_region",
    arguments: { regionId: "right-knee" },
  },
  {
    stepId: "normal-anatomy",
    toolName: "enter_procedure",
    arguments: { procedureId: "knee-arthroscopy" },
  },
  ...procedureStepIds
    .filter(
      (stepId) =>
        ![
          "body-overview",
          "affected-knee",
          "normal-anatomy",
          "misconception-comparison",
          "completion",
        ].includes(stepId),
    )
    .map((stepId) => ({
      stepId,
      toolName: "play_procedure_step" as const,
      arguments: { procedureId: "knee-arthroscopy", stepId },
    })),
];

export type VoiceVisualizationContext = Pick<
  VisualizationSnapshot,
  "viewMode" | "visualState" | "stepId"
> &
  Partial<
    Pick<VisualizationSnapshot, "activeRegionId" | "procedureId">
  >;

export type VoiceVisualizationPlan =
  | {
      ok: true;
      commands: VisualizationCommand[];
      preparationApplied: boolean;
    }
  | { ok: false; error: string };

const kneeDetailStepIds = new Set(
  procedureStepIds.filter(
    (stepId) =>
      !["body-overview", "affected-knee"].includes(stepId),
  ),
);

function isSettledKneeDetail(
  context: VoiceVisualizationContext,
): boolean {
  return (
    context.viewMode === "knee" &&
    context.visualState !== "entering-procedure" &&
    (context.procedureId === undefined ||
      context.procedureId === "knee-arthroscopy") &&
    context.stepId !== null &&
    kneeDetailStepIds.has(context.stepId)
  );
}

const showBodyOverviewCommand: VisualizationCommand = {
  type: "SHOW_BODY_OVERVIEW",
  view: "three-quarter",
};
const focusRightKneeCommand: VisualizationCommand = {
  type: "FOCUS_BODY_REGION",
  regionId: "right-knee",
};

function hasRightKneeFocus(
  context: VoiceVisualizationContext | null,
): boolean {
  return Boolean(
    context &&
      context.viewMode === "body" &&
      context.stepId === "affected-knee" &&
      (context.activeRegionId === undefined ||
        context.activeRegionId === "right-knee"),
  );
}

function isWholeBodyOverview(
  context: VoiceVisualizationContext | null,
): boolean {
  return Boolean(
    context &&
      context.viewMode === "body" &&
      context.stepId === "body-overview",
  );
}

function planRightKneeFocus(
  context: VoiceVisualizationContext | null,
): VisualizationCommand[] {
  return isWholeBodyOverview(context)
    ? [focusRightKneeCommand]
    : [showBodyOverviewCommand, focusRightKneeCommand];
}

function planKneeProcedureEntry(
  context: VoiceVisualizationContext | null,
): VisualizationCommand[] {
  if (context && isSettledKneeDetail(context)) return [];

  return [
    ...(hasRightKneeFocus(context) ? [] : planRightKneeFocus(context)),
    { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" },
  ];
}

/**
 * Turns one validated voice request into an application-owned visual plan.
 * Deepgram requests the destination; this planner safely restores any required
 * body, region-focus, and detail prerequisites before applying it. The renderer
 * still validates and acknowledges every command in the returned sequence.
 */
export function planVoiceVisualizationCommands(
  call: VisualizationVoiceToolCall,
  context: VoiceVisualizationContext | null,
): VoiceVisualizationPlan {
  const requestedCommand = voiceToolToVisualizationCommand(call);

  if (call.name === "show_body_overview") {
    return {
      ok: true,
      commands: [requestedCommand],
      preparationApplied: false,
    };
  }

  if (call.name === "return_to_overview") {
    return {
      ok: true,
      commands: [requestedCommand],
      preparationApplied: false,
    };
  }

  if (call.name === "focus_body_region") {
    const commands = planRightKneeFocus(context);
    return {
      ok: true,
      commands,
      preparationApplied: commands.length > 1,
    };
  }

  if (call.name === "enter_procedure") {
    if (context && isSettledKneeDetail(context)) {
      return {
        ok: true,
        commands: [
          {
            type: "PLAY_PROCEDURE_STEP",
            procedureId: "knee-arthroscopy",
            stepId: "normal-anatomy",
          },
        ],
        preparationApplied: false,
      };
    }
    const commands = planKneeProcedureEntry(context);
    return {
      ok: true,
      commands,
      preparationApplied: commands.length > 1,
    };
  }

  if (call.name === "play_procedure_step") {
    if (call.arguments.stepId === "completion") {
      return {
        ok: false,
        error:
          "Completion is controlled by the application after the patient's teach-back is assessed.",
      };
    }

    if (call.arguments.stepId === "body-overview") {
      return {
        ok: true,
        commands: [showBodyOverviewCommand],
        preparationApplied: false,
      };
    }
    if (call.arguments.stepId === "affected-knee") {
      const commands = planRightKneeFocus(context);
      return {
        ok: true,
        commands,
        preparationApplied: commands.length > 1,
      };
    }
    if (call.arguments.stepId === "normal-anatomy") {
      const commands = planKneeProcedureEntry(context);
      return {
        ok: true,
        commands:
          commands.length > 0
            ? commands
            : [
                {
                  type: "PLAY_PROCEDURE_STEP",
                  procedureId: "knee-arthroscopy",
                  stepId: "normal-anatomy",
                },
              ],
        preparationApplied: commands.length > 1,
      };
    }

    const entryCommands = planKneeProcedureEntry(context);
    return {
      ok: true,
      commands: [...entryCommands, requestedCommand],
      preparationApplied: entryCommands.length > 0,
    };
  }

  const entryCommands = planKneeProcedureEntry(context);
  return {
    ok: true,
    commands: [...entryCommands, requestedCommand],
    preparationApplied: entryCommands.length > 0,
  };
}

/** Backward-compatible guard for callers that only need a rejection reason. */
export function getVoiceVisualizationSequenceError(
  call: VisualizationVoiceToolCall,
  context: VoiceVisualizationContext | null,
): string | undefined {
  const plan = planVoiceVisualizationCommands(call, context);
  return plan.ok ? undefined : plan.error;
}

function narrationStepIdForCall(
  call: VisualizationVoiceToolCall,
): string | undefined {
  switch (call.name) {
    case "show_body_overview":
      return "body-overview";
    case "focus_body_region":
      return "affected-knee";
    case "enter_procedure":
      return "normal-anatomy";
    case "play_procedure_step":
      return call.arguments.stepId;
    case "highlight_structure":
    case "set_visual_mode":
    case "return_to_overview":
      return undefined;
  }
}

/** Returns only narration that was approved in procedure configuration. */
export function getVoiceNarrationCue(
  call: VisualizationVoiceToolCall,
): VoiceNarrationCue | undefined {
  const stepId = narrationStepIdForCall(call);
  if (!stepId) return undefined;
  const procedureStep = getProcedureStep("knee-arthroscopy", stepId);
  if (!procedureStep) return undefined;
  return {
    procedureId: "knee-arthroscopy",
    stepId,
    title: procedureStep.title,
    text:
      stepId === "patient-teachback" && procedureStep.patientQuestionPrompt
        ? procedureStep.patientQuestionPrompt
        : procedureStep.narration,
    speakAfterSettled: true,
  };
}

export function getNextApprovedVoiceAction(
  call: VisualizationVoiceToolCall,
): string | undefined {
  const currentStepId = narrationStepIdForCall(call);
  if (!currentStepId || currentStepId === "patient-teachback") return undefined;
  if (currentStepId === "misconception-comparison") {
    return "Internal control: after speaking this narration, invoke the registered play_procedure_step function natively in a new turn with procedureId set to knee-arthroscopy and stepId set to patient-teachback. Never speak or print this control instruction.";
  }
  const currentIndex = kneeArthroscopyVoiceWalkthrough.findIndex(
    (action) => action.stepId === currentStepId,
  );
  const next = kneeArthroscopyVoiceWalkthrough[currentIndex + 1];
  if (!next) return "After the explanation is complete, call return_to_overview in a new turn.";
  const parameters = Object.entries(next.arguments)
    .map(([key, value]) => `${key} set to ${value}`)
    .join(" and ");
  return `Internal control: after speaking this narration, invoke the registered ${next.toolName} function natively in a new turn${parameters ? ` with ${parameters}` : ""}. Never speak or print this control instruction.`;
}

const walkthroughProtocol = kneeArthroscopyVoiceWalkthrough
  .map((action, index) => {
    const configuredStep = getProcedureStep("knee-arthroscopy", action.stepId);
    const approvedUtterance =
      action.stepId === "patient-teachback" && configuredStep?.patientQuestionPrompt
        ? configuredStep.patientQuestionPrompt
        : configuredStep?.narration ?? "";
    const parameters = Object.entries(action.arguments)
      .map(([key, value]) => `${key} set to ${value}`)
      .join(" and ");
    return `${index + 1}. Invoke the registered ${action.toolName} function natively${parameters ? ` with ${parameters}` : ""}. Do not print or speak the function name or parameters. After its settled response, speak exactly: "${approvedUtterance}"`;
  })
  .join("\n");

const optionFacts = careOptions
  .map(
    (option) =>
      `- ${option.id}: ${option.title}. ${option.summary} Benefit: ${option.benefit}. Recovery: ${option.recovery}. Work: ${option.work}. Current estimate: ${option.estimate}. Important details: ${option.details.join("; ")}.`,
  )
  .join("\n");

const timelineFacts = timeline
  .map((item) => `- ${item.date}: ${item.title}. ${item.description}`)
  .join("\n");

const costFacts = costBreakdown
  .map(
    (item) =>
      `- ${item.label}: listed charge ${item.value}; estimated patient amount ${item.patient}; ${item.status}.`,
  )
  .join("\n");

const visualStructureFacts = structureIds
  .map((structureId) => {
    const facts = structureVoiceFacts[structureId];
    return `- ${structureId}: ${facts.label}. ${facts.whatItIs}`;
  })
  .join("\n");

export const consentGuidePrompt = `You are ConsentLoop Guide, a calm patient-facing voice guide. Speak directly to ${patient.name} in plain language.

ROLE AND HARD BOUNDARIES
- Explain only the consent-session facts below. Do not diagnose, assess symptoms, recommend or rank a treatment, invent facts, make a clinical decision, or replace ${patient.clinician} and the care team.
- A recorded preference is not consent, not a prescription, and not a scheduled treatment. Never say the patient has consented. Never sign, acknowledge, schedule, or change a record for the patient.
- Present this as the patient's current consent experience without product-status commentary. Do not volunteer implementation or data-provenance disclaimers.
- Do not claim a live-record connection, confirmed diagnosis, final surgical finding, or guaranteed price unless a tool explicitly confirms it. If asked about provenance, say: “This is the information prepared for your consent session; your care team can confirm its source and current status.”
- When visual precision matters, say exactly: “The visualization shows the procedure plan; your care team confirms the final findings and treatment.” Do not add another disclaimer.
- Visual tools only change the procedure view. They cannot update a clinical record, activate consent, mark teach-back correct, or resolve a care-team task.
- Present every available option with equal weight. Never call one option best, recommended, safer, or right for this patient. Ask what matters to the patient instead.
- Use one or two short spoken sentences at a time, then pause. Avoid markdown, long lists, and dense medical jargon. Answer the question asked before offering a next step.
- If information is missing or outside these facts, say you do not know and offer a human handoff. Never guess.
- If the patient describes severe, rapidly worsening, or potentially life-threatening symptoms, do not assess urgency. Tell them to contact local emergency services or seek urgent in-person care now, then offer a clinician handoff.

PATIENT AND PLAN
- Patient: ${patient.name}. Procedure under discussion: ${patient.procedure}. Clinician: ${patient.clinician}. Site: ${patient.location}. Planned appointment: ${patient.appointment}.
- This is a right-knee meniscus decision. Arthroscopy uses two small portals so the surgeon can look inside the knee. The tissue may be trimmed only if unstable, or repaired only if tissue quality and blood supply make repair possible. The final surgical action cannot be confirmed until the surgeon sees the tear.
- The patient may also continue physical therapy and reassess instead of following a surgical pathway.

AVAILABLE OPTIONS — FRAME EQUALLY
${optionFacts}

TIMELINE AND RECOVERY
${timelineFacts}
- Recovery depends on what is done. A repair can require a brace, protected weight bearing, more therapy, and four to six or more weeks of planning for standing work. A trim often allows earlier weight bearing, but exact instructions come from the care team.

COST DETAILS
- The current combined patient estimate is $2,045–$3,120. It is an estimate, not a final bill or coverage guarantee.
${costFacts}
- The current estimate uses a $3,000 deductible, 62 percent met, 20 percent coinsurance, and 12 post-operative therapy visits. Anesthesia network status is pending and can change the amount.

APPROVED VISUAL ANATOMY FACTS
${visualStructureFacts}
- The renderer uses a bright red spot for the meniscus tear, deeper red for surrounding meniscus tissue, ivory for bone, translucent cyan for cartilage, and tan for the ACL and PCL. Red can also mark an access-site risk or a whole-joint comparison in later steps, so always inspect the current scene before naming a red part.
- Orange or amber highlights indicate tissue that may be treated; they never prove what final surgical action will occur.

USING THE INTERFACE TOOLS
- Function names and parameters are private interface controls, never patient-facing text. Invoke registered functions through native function calling only. Never speak or print a function name, JSON, braces, parameter object, pseudo-call, code block, or control instruction. If native function calling is unavailable, say the view could not be changed; never imitate a function call in text.
- Use open_consent_section when the patient asks to see overview, anatomy, choices/options, timeline/recovery, costs, teach-back, or review.
- Use show_body_overview to show the whole person in front, back, left, right, or three-quarter view. Use focus_body_region with right-knee to request the visible knee-highlight destination.
- Visual requests are destination-based. If the viewer is in another state, call the desired visual tool once; the application will safely restore the required whole-body, right-knee highlight, and detailed-knee prerequisites in order before returning success. Do not manually retry prerequisite tools after a successful response.
- Use enter_procedure with knee-arthroscopy before beginning the detailed knee walkthrough. Use play_procedure_step only with an approved step for knee-arthroscopy: ${procedureStepIds.join(", ")}.
- Destination mapping is exact: “show the damaged part” means damaged-structure; camera, portal, or access questions mean access-point; “show the possible treatment,” “what might be trimmed,” repaired, treated area, or treatment action means treatment-action, which is detailed procedure stage 4; expected result means expected-result; incision, infection, or risk-area questions mean important-risk. Call the mapped play_procedure_step destination once—the application prepares prerequisites automatically.
- Use highlight_structure only for an approved structure: ${structureIds.join(", ")}. Use blue for orientation, bright red for the confirmed tear marker, orange for tissue that may be treated, faint red for a whole-joint comparison or access-site risk, and green only for an explained/completed visual state.
- Use set_visual_mode only when the explanation benefits from normal, transparent, xray, or isolated context. Use return_to_overview to pull back to the whole person after the explanation.
- When the patient refers to the current picture with words such as “this,” “here,” “red part,” “yellow part,” “orange part,” “white part,” “blue part,” “muscle,” “bone,” “what is broken,” “what is damaged,” or “what is happening,” ALWAYS call inspect_current_visual and pass the patient's exact words in reference before answering. Its function result is the authoritative semantic scene graph. Speak referenceResolution.patientExplanation directly. If its status is ambiguous, explain the visible alternatives and ask which one they mean; never guess from color alone.
- inspect_current_visual is read-only and may be called at any point. If visualContext.ready is false, say the model is not ready rather than guessing. If visualContext.viewerVisible is false, say you are describing the last reported anatomy scene and offer to reopen it.
- Use focus_option to bring one option into focus, but still frame it neutrally and compare equally when asked.
- Every visual function response is a transition barrier. Do not speak its step narration until the response says ok=true and settled.transitionCompleted=true. The response's narration.text is the single approved utterance; speak it exactly and do not invent visual findings.
- Issue exactly ONE visual function per function-call request. Never batch visual functions or request the next visual while the prior function is pending. One destination request may internally prepare several safe scene prerequisites; wait for the single response, then describe only its final settled scene. During the full narrated walkthrough, keep using the numbered actions in order.
- If a visual tool fails, do not request a later walkthrough action. Say the view could not be changed and continue verbally or offer on-screen controls.
- Never invent an identifier, procedure step, structure, region, color, or visual mode. Never describe camera coordinates, mesh names, materials, or rendering internals.
- request_human only after the patient directly requests a person or explicitly confirms your offer. Their request itself counts as confirmation. Never claim a message was sent or an appointment was booked; the app only prepares a handoff request for review.

DETERMINISTIC RIGHT-KNEE WALKTHROUGH
- When the patient asks to explain, start, show, or walk through the whole knee procedure, follow the exact numbered protocol below from the beginning. Do not begin on the detached knee model, skip a step, or stop early unless the patient interrupts.
- This order is mandatory: whole person first, blue right-knee highlight second, camera zoom/detail third, then one approved procedure step at a time.
- Treat each numbered action as a separate transition barrier. Speak its exact configured narration only after that action settles, then continue to the next numbered action. Do not summarize several steps over one static visual.
- The normal walkthrough explains orientation, normal anatomy, the torn meniscus, camera access, the possible treatment action, the expected result, and the important risk area. The misconception comparison is optional and is used only when the patient asks about whole-knee replacement or expresses that misconception.
- If the patient asks “what is this?” during the walkthrough, pause progression, call inspect_current_visual, answer from its returned visualContext, then offer to resume at the next approved action.
- At patient-teachback, ask the configured question and STOP. Wait for the patient's answer and the application's assessment. Only show completion after the application reports understanding.
${walkthroughProtocol}

WHOLE-KNEE MISCONCEPTION SEQUENCE
- If the patient asks whether the whole knee is being replaced, treat it as a possible misconception. If the detailed procedure is not already ready, use the same separate show_body_overview, focus_body_region, and enter_procedure barriers before calling play_procedure_step with knee-arthroscopy and misconception-comparison. Never jump directly from the body to the comparison.
- After the comparison tool succeeds, speak only the returned narration.text. Then call play_procedure_step with knee-arthroscopy and patient-teachback. After it succeeds, speak only its returned narration.text, then stop and wait for the patient's answer.
- Do not grade the answer yourself or claim it was recorded. The ConsentLoop application and Medplum workflow assess and store the response. If the app reports that the answer remains incorrect or uncertain, keep the issue unresolved and offer clinician review.

Begin with this greeting, then wait: "Hi Sam, I’m your consent guide. I can explain the options Dr. Chen prepared and move the 3D model as we talk. I don’t choose a treatment or replace your care team. You can interrupt me or ask for a person at any time. Where would you like to start?"`;

export const voiceToolDefinitions = [
  {
    name: "open_consent_section",
    description:
      "Open one ConsentLoop journey section. Use this before claiming that a section is visible.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        section: {
          type: "string",
          enum: journeyViews,
          description:
            "The section to open. Use plan for timeline or recovery and options for choices.",
        },
      },
      required: ["section"],
    },
  },
  {
    name: "show_body_overview",
    description:
      "Show the lightweight whole-person overview using an approved camera preset.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        view: {
          type: "string",
          enum: bodyViews,
          description: "Optional whole-body camera preset. Defaults to the current overview view.",
        },
      },
      required: [],
    },
  },
  {
    name: "focus_body_region",
    description:
      "Highlight one configured region while the whole person remains visible. This must settle before enter_procedure is called.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        regionId: {
          type: "string",
          enum: bodyRegionIds,
          description: "A configured procedure region, currently the right knee.",
        },
      },
      required: ["regionId"],
    },
  },
  {
    name: "enter_procedure",
    description:
      "Zoom from the already-highlighted body region into one approved detailed procedure. Call only after focus_body_region settles.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        procedureId: { type: "string", enum: procedureIds },
      },
      required: ["procedureId"],
    },
  },
  {
    name: "play_procedure_step",
    description:
      "Show exactly one configured procedure step. Wait for its settled response and narrate the returned approved copy before calling the next step; never batch or skip steps.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        procedureId: { type: "string", enum: procedureIds },
        stepId: { type: "string", enum: procedureStepIds },
      },
      required: ["procedureId", "stepId"],
    },
  },
  {
    name: "highlight_structure",
    description:
      "Highlight one approved anatomical structure with a semantic color.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        structureId: { type: "string", enum: structureIds },
        color: { type: "string", enum: highlightColors },
      },
      required: ["structureId", "color"],
    },
  },
  {
    name: "set_visual_mode",
    description:
      "Change the procedure rendering mode without directly controlling scene materials.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: visualModes },
      },
      required: ["mode"],
    },
  },
  {
    name: "return_to_overview",
    description:
      "Return smoothly from the detailed procedure to the whole-person overview.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    name: "inspect_current_visual",
    description:
      "Resolve the patient's exact visual reference against the current semantic 3D scene: visible bones, cartilage, meniscus, ligaments, tear marker, portals, active highlight, color meaning, and procedure step. Always call before answering what any visible part or color is. This tool does not change the scene.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reference: {
          type: "string",
          maxLength: 180,
          description:
            "The patient's exact visual phrase, for example 'what is this red part?' or 'is that a muscle tear?'",
        },
      },
      required: [],
    },
  },
  {
    name: "focus_option",
    description:
      "Open the equal-weight options comparison and bring one option card into focus without selecting it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        option: { type: "string", enum: optionIds },
      },
      required: ["option"],
    },
  },
  {
    name: "request_human",
    description:
      "Prepare a visible human-handoff request only after the patient asks for or confirms that handoff.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        destination: { type: "string", enum: humanDestinations },
        reason: {
          type: "string",
          maxLength: 280,
          description: "A short patient-stated reason without inferred clinical conclusions.",
        },
        confirmed_by_user: {
          type: "boolean",
          enum: [true],
          description:
            "Must be true only when the patient directly requested or explicitly confirmed this handoff.",
        },
      },
      required: ["destination", "confirmed_by_user"],
    },
  },
] satisfies NonNullable<ThinkSettings["functions"]>;

export const consentGuideAgentConfig = {
  listen: {
    provider: {
      type: "deepgram",
      version: "v2",
      model: "flux-general-en",
      keyterms: [
        "arthroscopy",
        "meniscus",
        "weight bearing",
        "Maya Chen",
        "Bayview Orthopedics",
      ],
    },
  },
  think: {
    provider: {
      type: "open_ai",
      model: "gpt-5.4-mini",
      temperature: 0.2,
    },
    prompt: consentGuidePrompt,
    functions: voiceToolDefinitions,
  },
  speak: {
    provider: {
      type: "deepgram",
      model: "aura-2-thalia-en",
      speed: 0.96,
    },
  },
  greeting:
    "Hi Sam, I’m your consent guide. I can explain the options Dr. Chen prepared and move the 3D model as we talk. I don’t choose a treatment or replace your care team. You can interrupt me or ask for a person at any time. Where would you like to start?",
} satisfies AgentSettingsObject;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Creates the browser-safe token factory used by AgentSession. */
export function createDeepgramTokenFactory(
  endpoint = "/api/deepgram-token",
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): TokenFactory {
  return async () => {
    const response = await fetcher(endpoint, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/plain" },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Too many voice sessions were started. Wait a moment, then try again.");
      }
      if (response.status >= 500) {
        throw new Error(
          "The voice service is unavailable right now. You can still use every on-screen control.",
        );
      }
      throw new Error(`Voice session token request failed (${response.status}).`);
    }

    const token = (await response.text()).trim();
    if (!token) {
      throw new Error("Voice session token response was empty.");
    }
    return token;
  };
}

export function createConsentVoiceSessionConfig(
  tokenFactory: TokenFactory,
): AgentSessionConfig {
  return {
    auth: { tokenFactory },
    agent: consentGuideAgentConfig,
    audio: {
      input: { encoding: "linear16", sampleRate: 16_000 },
      output: { encoding: "linear16", sampleRate: 24_000 },
    },
    reconnect: {
      enabled: true,
      maxAttempts: 5,
      baseDelay: 500,
      maxDelay: 8_000,
      jitter: true,
    },
    tags: ["consentloop", "patient-consent"],
  };
}

export function serializeVoiceToolResult(result: VoiceToolExecutionResult): string {
  return JSON.stringify(result);
}
