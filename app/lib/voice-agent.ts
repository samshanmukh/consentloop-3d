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

export const voiceToolNames = [
  "open_consent_section",
  "focus_anatomy",
  "preview_procedure_step",
  "focus_option",
  "request_human",
] as const;

export type VoiceToolName = (typeof voiceToolNames)[number];

export const anatomyVoiceTargets = [
  "body",
  "knee",
  "meniscus",
  "tear",
  "ligaments",
  "portals",
] as const;

export type AnatomyVoiceTarget = (typeof anatomyVoiceTargets)[number];

export const anatomyCameraActions = [
  "frame",
  "zoom_in",
  "zoom_out",
  "rotate_left",
  "rotate_right",
] as const;

export type AnatomyCameraAction = (typeof anatomyCameraActions)[number];

export const procedureVoiceSteps = [
  "orientation",
  "tear",
  "scope",
  "treatment",
  "recovery",
] as const;

export type ProcedureVoiceStep = (typeof procedureVoiceSteps)[number];

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
      name: "focus_anatomy";
      arguments: {
        target: AnatomyVoiceTarget;
        camera?: AnatomyCameraAction;
      };
    }
  | {
      id: string;
      name: "preview_procedure_step";
      arguments: { step: ProcedureVoiceStep };
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

    case "focus_anatomy":
      if (
        !hasOnlyKeys(args, ["target", "camera"]) ||
        !isMember(args.target, anatomyVoiceTargets) ||
        (args.camera !== undefined && !isMember(args.camera, anatomyCameraActions))
      ) {
        return { ok: false, error: "Invalid anatomy focus request." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: {
            target: args.target,
            ...(args.camera === undefined ? {} : { camera: args.camera }),
          },
        },
      };

    case "preview_procedure_step":
      if (!hasOnlyKeys(args, ["step"]) || !isMember(args.step, procedureVoiceSteps)) {
        return { ok: false, error: "Invalid procedure preview step." };
      }
      return {
        ok: true,
        call: {
          id: wireCall.id,
          name: wireCall.name,
          arguments: { step: args.step },
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
- Present every available option with equal weight. Never call one option best, recommended, safer, or right for this patient. Ask what matters to the patient instead.
- Use one or two short spoken sentences at a time, then pause. Avoid markdown, long lists, and dense medical jargon. Answer the question asked before offering a next step.
- If information is missing or outside these facts, say you do not know and offer a human handoff. Never guess.
- If the patient describes severe, rapidly worsening, or potentially life-threatening symptoms, do not assess urgency. Tell them to contact local emergency services or seek urgent in-person care now, then offer a clinician handoff.

DEMO PATIENT AND PLAN
- Patient: ${patient.name}. Procedure under discussion: ${patient.procedure}. Clinician: ${patient.clinician}. Site: ${patient.location}. Planned demo appointment: ${patient.appointment}.
- This is a right-knee meniscus decision. Arthroscopy uses two small portals so the surgeon can look inside the knee. The tissue may be trimmed only if unstable, or repaired only if tissue quality and blood supply make repair possible. The final surgical action cannot be confirmed until the surgeon sees the tear.
- The patient may also continue physical therapy and reassess instead of following a surgical pathway.

AVAILABLE OPTIONS — FRAME EQUALLY
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
- Use focus_anatomy before saying the model moved, zoomed, rotated, or highlighted a structure. "Whole person" means body; "damaged part" means tear; "camera entry" means portals.
- Use preview_procedure_step before saying a procedure animation or step is visible.
- Use focus_option to bring one option into focus, but still frame it neutrally and compare equally when asked.
- Wait for a successful tool response before claiming that the interface changed. If a tool fails, say the view could not be changed and continue verbally.
- request_human only after the patient directly requests a person or explicitly confirms your offer. Their request itself counts as confirmation. Never claim a message was sent or an appointment was booked; the demo only prepares a handoff request.

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
    name: "focus_anatomy",
    description:
      "Open the anatomy experience and focus a grounded structure, optionally changing its camera framing.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: {
          type: "string",
          enum: anatomyVoiceTargets,
          description:
            "body is the whole person; portals are the arthroscopy camera entry points.",
        },
        camera: {
          type: "string",
          enum: anatomyCameraActions,
          description: "Optional camera action to apply after focusing the target.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "preview_procedure_step",
    description:
      "Open anatomy and preview one illustrated knee-arthroscopy step.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        step: { type: "string", enum: procedureVoiceSteps },
      },
      required: ["step"],
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
