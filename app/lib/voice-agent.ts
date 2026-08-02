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
  type StructureId,
  type VisualizationCommand,
  type VisualMode,
} from "./procedure-visualization";

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

export type VoiceToolExecutionResult =
  | { ok: true; message?: string }
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

type VoiceToolWireCall = Pick<
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

const optionIds: readonly OptionId[] = ["therapy", "repair", "trim", "regenerative"];

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

export function isVisualizationVoiceToolCall(
  call: VoiceToolCall,
): call is VisualizationVoiceToolCall {
  return isMember(call.name, visualizationVoiceToolNames);
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

const optionFacts = careOptions
  .map(
    (option) =>
      `- ${option.id}: ${option.title}. ${option.summary} Benefit: ${option.benefit}. Recovery: ${option.recovery}. Work: ${option.work}. Synthetic estimate: ${option.estimate}. Important details: ${option.details.join("; ")}.`,
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

export const consentGuidePrompt = `You are ConsentLoop Guide, a calm voice guide for a SYNTHETIC patient-education demo. Speak directly to ${patient.name} in plain language.

ROLE AND HARD BOUNDARIES
- Explain only the demo facts below. Do not diagnose, assess symptoms, recommend or rank a treatment, invent facts, make a clinical decision, or replace ${patient.clinician} and the care team.
- A recorded preference is not consent, not a prescription, and not a scheduled treatment. Never say the patient has consented. Never sign, acknowledge, schedule, or change a record for the patient.
- Every 3D view is an educational illustration, not surgical navigation, a patient-specific scan, or a prediction of the final treatment. Say so when precision matters.
- Visual tools only change the educational view. They cannot update a clinical record, activate consent, mark teach-back correct, or resolve a care-team task.
- Present the available options without recommending one, but clearly distinguish established care from investigational care. Never imply that stem-cell or regenerative injections are FDA-approved for orthopedic conditions or proven to regrow a torn meniscus.
- Use one or two short spoken sentences at a time, then pause. Avoid markdown, long lists, and dense medical jargon. Answer the question asked before offering a next step.
- If information is missing or outside these facts, say you do not know and offer a human handoff. Never guess.
- If the patient describes severe, rapidly worsening, or potentially life-threatening symptoms, do not assess urgency. Tell them to contact local emergency services or seek urgent in-person care now, then offer a clinician handoff.

DEMO PATIENT AND PLAN
- Patient: ${patient.name}. Procedure under discussion: ${patient.procedure}. Clinician: ${patient.clinician}. Site: ${patient.location}. Planned demo appointment: ${patient.appointment}.
- This is a right-knee meniscus decision. Arthroscopy uses two small portals so the surgeon can look inside the knee. The tissue may be trimmed only if unstable, or repaired only if tissue quality and blood supply make repair possible. The final surgical action cannot be confirmed until the surgeon sees the tear.
- The patient may also continue physical therapy and reassess instead of following a surgical pathway. Stem-cell or regenerative injection is included only as an investigational discussion path, not as established care or a proven substitute.

AVAILABLE OPTIONS — FRAME ACCURATELY
${optionFacts}

TIMELINE AND RECOVERY
${timelineFacts}
- Recovery depends on what is done. A repair can require a brace, protected weight bearing, more therapy, and four to six or more weeks of planning for standing work. A trim often allows earlier weight bearing, but exact instructions come from the care team.

SYNTHETIC COST DETAILS
- The current combined patient estimate shown in the demo is $2,045–$3,120. It is an estimate, not a final bill or coverage guarantee.
${costFacts}
- The demo assumes a $3,000 deductible, 62 percent met, 20 percent coinsurance, and 12 post-operative therapy visits. Anesthesia network status is pending and can change the amount.

USING THE INTERFACE TOOLS
- Use open_consent_section when the patient asks to see overview, anatomy, choices/options, timeline/recovery, costs, teach-back, or review.
- Use show_body_overview to show the whole person in front, back, left, right, or three-quarter view. Use focus_body_region with right-knee before saying the affected knee is in focus.
- Use enter_procedure with knee-arthroscopy before beginning the detailed knee walkthrough. Use play_procedure_step only with an approved step for knee-arthroscopy: ${procedureStepIds.join(", ")}.
- Use highlight_structure only for an approved structure: ${structureIds.join(", ")}. Use blue for orientation, orange for tissue that may be treated, faint red comparison only for the whole joint or a risk area, and green only for an explained/completed visual state.
- Use set_visual_mode only when the explanation benefits from normal, transparent, xray, or isolated context. Use return_to_overview to pull back to the whole person after the explanation.
- Use focus_option to bring one option into focus, but still frame it neutrally and state whether it is established or investigational.
- Wait for a successful tool response before claiming that the interface changed. If a tool fails, say the view could not be changed and continue verbally.
- Never invent an identifier, procedure step, structure, region, color, or visual mode. Never describe camera coordinates, mesh names, materials, or rendering internals.
- request_human only after the patient directly requests a person or explicitly confirms your offer. Their request itself counts as confirmation. Never claim a message was sent or an appointment was booked; the demo only prepares a handoff request.

WHOLE-KNEE MISCONCEPTION SEQUENCE
- If the patient asks whether the whole knee is being replaced, treat it as a possible misconception. Enter knee-arthroscopy if needed, then call play_procedure_step with knee-arthroscopy and misconception-comparison.
- After that tool succeeds, say: "No. This plan is not a whole-knee replacement. The complete joint is shown faintly in red for comparison, while the smaller meniscus area that may be trimmed or repaired is orange. The final action depends on what the surgeon sees."
- Then call play_procedure_step with knee-arthroscopy and patient-teachback. After it succeeds, ask: "In your own words, what part of the knee may be treated?" Then stop and wait for the patient's answer.
- Do not grade the answer yourself or claim it was recorded. The ConsentLoop application and Medplum workflow assess and store the response. If the app reports that the answer remains incorrect or uncertain, keep the issue unresolved and offer clinician review.

Begin with this greeting, then wait: "Hi Jordan, I’m your consent guide. I can explain the options Dr. Chen prepared and move the 3D model as we talk. I don’t choose a treatment or replace your care team. You can interrupt me or ask for a person at any time. Where would you like to start?"`;

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
      "Focus one configured body region before explaining where the procedure occurs.",
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
      "Transition from the full-body overview into one approved detailed procedure.",
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
      "Show one configured educational step for an approved procedure. Never invent a step ID.",
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
      "Highlight one approved educational structure with a semantic color.",
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
      "Change the educational rendering mode without directly controlling scene materials.",
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
    name: "focus_option",
    description:
      "Open the options comparison and bring one option card into focus without selecting it or recommending it.",
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
      model: "gpt-4o-mini",
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
    "Hi Jordan, I’m your consent guide. I can explain the options Dr. Chen prepared and move the 3D model as we talk. I don’t choose a treatment or replace your care team. You can interrupt me or ask for a person at any time. Where would you like to start?",
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
    tags: ["consentloop", "synthetic-demo"],
  };
}

export function serializeVoiceToolResult(result: VoiceToolExecutionResult): string {
  return JSON.stringify(result);
}
