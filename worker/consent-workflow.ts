import { ClientStorage, MedplumClient, MemoryStorage } from "@medplum/core";
import type {
  Consent,
  Patient,
  QuestionnaireResponse,
  Task,
} from "@medplum/fhirtypes";
import type { TeachBackResult } from "@consentloop/shared";
import {
  SEED_TAG,
  applyWorkflowRules,
  findSessionRefs,
  getConsentSession,
  getVisualizationWorkflowContext,
  listConsentEvents,
  parseComprehensionConcepts,
  upsertTeachBackResult,
} from "@consentloop/fhir";
import {
  createDefaultWorkflowSnapshot,
  isTeachBackUpdate,
  type ConsentWorkflowEvent,
  type ConsentWorkflowSnapshot,
  type TeachBackUpdate,
} from "../app/lib/consent-workflow";

export interface ConsentWorkflowEnv {
  MEDPLUM_BASE_URL?: string;
  MEDPLUM_CLIENT_ID?: string;
  MEDPLUM_CLIENT_SECRET?: string;
}

interface CachedClient {
  fingerprint: string;
  client: MedplumClient;
}

let cachedClient: CachedClient | null = null;

const MAX_REQUEST_BODY_BYTES = 8_192;

type ConsentWorkflowClientProvider = (
  env: ConsentWorkflowEnv,
) => Promise<MedplumClient | null>;

interface ConsentWorkflowHandlerOptions {
  getClient?: ConsentWorkflowClientProvider;
}

class FinalizedQuestionnaireResponseError extends Error {}

function noStoreResponse(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isSameOrigin(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== requestOrigin) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  return fetchSite === undefined || fetchSite === "same-origin";
}

async function getClient(env: ConsentWorkflowEnv): Promise<MedplumClient | null> {
  const clientId = env.MEDPLUM_CLIENT_ID?.trim();
  const clientSecret = env.MEDPLUM_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const baseUrl = env.MEDPLUM_BASE_URL?.trim() || "https://api.medplum.com/";
  const fingerprint = `${baseUrl}|${clientId}|${clientSecret}`;
  if (cachedClient?.fingerprint === fingerprint) return cachedClient.client;

  const client = new MedplumClient({
    baseUrl,
    storage: new ClientStorage(new MemoryStorage()),
  });
  await client.startClientLogin(clientId, clientSecret);
  cachedClient = { fingerprint, client };
  return client;
}

function patientDisplayName(patient: Patient): string {
  const name = patient.name?.[0];
  return [...(name?.given ?? []), name?.family].filter(Boolean).join(" ");
}

async function findDemoPatient(medplum: MedplumClient): Promise<Patient | null> {
  const patients = await medplum.searchResources("Patient", {
    _tag: `${SEED_TAG.system}|${SEED_TAG.code}`,
    _sort: "-_lastUpdated",
    _count: 20,
  });
  return (
    patients.find((candidate) => patientDisplayName(candidate) === "Sam Lee") ??
    patients[0] ??
    null
  );
}

function supportedTaskStatus(status: Task["status"]): ConsentWorkflowSnapshot["taskStatus"] {
  if (status === "on-hold" || status === "completed" || status === "requested") return status;
  return "in-progress";
}

function supportedConsentStatus(status: Consent["status"]): ConsentWorkflowSnapshot["consentStatus"] {
  return status === "active" ? "active" : "draft";
}

function eventResourceType(resourceType: string): ConsentWorkflowEvent["resourceType"] {
  if (
    resourceType === "ServiceRequest" ||
    resourceType === "QuestionnaireResponse" ||
    resourceType === "Task" ||
    resourceType === "Consent"
  ) {
    return resourceType;
  }
  return "Provenance";
}

async function buildSnapshot(
  medplum: MedplumClient,
  patient: Patient,
): Promise<ConsentWorkflowSnapshot | null> {
  if (!patient.id) return null;
  const [context, provenanceEvents] = await Promise.all([
    getVisualizationWorkflowContext(medplum, patient.id),
    listConsentEvents(medplum, patient.id),
  ]);
  if (!context) return null;

  const {
    session,
    questionnaireResponse: qr,
    educationTask: task,
    consent,
    clinicianReviewTask: clinicianTask,
    teachBackResults: results,
  } = context;
  const now = new Date().toISOString();
  const snapshot = createDefaultWorkflowSnapshot(now);

  for (const result of results) {
    snapshot.concepts[result.conceptId] = {
      conceptId: result.conceptId,
      status: result.status,
      evidence: result.evidence,
      ...(result.misconception ? { misconception: result.misconception } : {}),
      ...(result.clarification ? { clarification: result.clarification } : {}),
      updatedAt: qr.meta?.lastUpdated ?? now,
    };
  }

  const events = provenanceEvents.slice(0, 24).map((event, index) => ({
    id: `${event.resourceType}-${event.resourceId}-${event.timestamp}-${index}`,
    timestamp: event.timestamp,
    resourceType: eventResourceType(event.resourceType),
    action: event.action,
    summary: event.summary,
  }));

  return {
    ...snapshot,
    source: "medplum",
    connected: true,
    patientId: patient.id,
    serviceRequestId: session.serviceRequestId,
    questionnaireResponseId: session.questionnaireResponseId,
    taskId: session.taskId,
    consentId: session.consentId,
    procedureCode: session.procedureCode || snapshot.procedureCode,
    taskStatus: supportedTaskStatus(task.status),
    consentStatus: supportedConsentStatus(consent.status),
    clinicianEscalation: clinicianTask
      ? clinicianTask.status === "completed"
        ? "resolved"
        : "requested"
      : "none",
    // Connected snapshots never invent audit entries. An empty array means
    // Medplum has not produced a Provenance event yet.
    events,
    updatedAt: qr.meta?.lastUpdated ?? now,
  };
}

async function loadSnapshot(medplum: MedplumClient) {
  const patient = await findDemoPatient(medplum);
  if (!patient) return null;
  return buildSnapshot(medplum, patient);
}

async function recordTeachBack(
  medplum: MedplumClient,
  update: TeachBackUpdate,
): Promise<ConsentWorkflowSnapshot | null> {
  const patient = await findDemoPatient(medplum);
  if (!patient?.id) return null;
  const session = await getConsentSession(medplum, patient.id);
  if (!session) return null;

  const current: QuestionnaireResponse = await medplum.readResource(
    "QuestionnaireResponse",
    session.questionnaireResponseId,
  );
  if (current.status === "completed") {
    throw new FinalizedQuestionnaireResponseError();
  }
  const result: TeachBackResult = {
    conceptId: update.conceptId,
    status: update.status,
    evidence: update.evidence.trim(),
    ...(update.misconception ? { misconception: update.misconception.trim() } : {}),
    ...(update.clarification ? { clarification: update.clarification.trim() } : {}),
    requiresClinician: update.status === "contradicted" || update.status === "uncertain",
  };
  const updated = await medplum.updateResource<QuestionnaireResponse>(
    upsertTeachBackResult(current, result),
  );

  // The Subscription remains the production trigger. Applying the same
  // idempotent rules here makes the live demo response immediately coherent.
  const refs = await findSessionRefs(medplum, updated);
  if (!refs) throw new Error("Consent session references are unavailable");

  await applyWorkflowRules(medplum, {
    task: refs.task,
    consent: refs.consent,
    questionnaireResponse: updated,
    concepts: parseComprehensionConcepts(updated),
  });

  return buildSnapshot(medplum, patient);
}

type ParsedPostBody =
  | { ok: true; update: TeachBackUpdate }
  | { ok: false; response: Response };

async function parsePostBody(request: Request): Promise<ParsedPostBody> {
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return {
      ok: false,
      response: noStoreResponse({ error: "Content-Type must be application/json" }, 415),
    };
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return {
      ok: false,
      response: noStoreResponse({ error: "Request body is too large" }, 413),
    };
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return {
      ok: false,
      response: noStoreResponse({ error: "Request body could not be read" }, 400),
    };
  }
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) {
    return {
      ok: false,
      response: noStoreResponse({ error: "Request body is too large" }, 413),
    };
  }

  let input: unknown;
  try {
    input = JSON.parse(body) as unknown;
  } catch {
    return {
      ok: false,
      response: noStoreResponse({ error: "Request body must be valid JSON" }, 400),
    };
  }
  if (!isTeachBackUpdate(input)) {
    return {
      ok: false,
      response: noStoreResponse({ error: "Unsupported teach-back update" }, 400),
    };
  }
  return { ok: true, update: input };
}

export function createConsentWorkflowHandler(
  options: ConsentWorkflowHandlerOptions = {},
) {
  const clientProvider = options.getClient ?? getClient;

  return async function handleConsentWorkflowRequest(
    request: Request,
    env: ConsentWorkflowEnv,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "POST") {
      return noStoreResponse({ error: "Method not allowed" }, 405, {
        Allow: "GET, POST",
      });
    }
    if (!isSameOrigin(request)) {
      return noStoreResponse({ error: "Request origin is not allowed" }, 403);
    }

    const parsedPost =
      request.method === "POST" ? await parsePostBody(request) : null;
    if (parsedPost && !parsedPost.ok) return parsedPost.response;

    let medplum: MedplumClient | null;
    try {
      medplum = await clientProvider(env);
    } catch {
      return noStoreResponse({ error: "Medplum authentication is unavailable" }, 503);
    }
    if (!medplum) {
      return noStoreResponse({ error: "Medplum is not configured" }, 503);
    }

    try {
      if (request.method === "GET") {
        const snapshot = await loadSnapshot(medplum);
        return snapshot
          ? noStoreResponse(snapshot)
          : noStoreResponse({ error: "Synthetic consent session was not found" }, 404);
      }

      const snapshot = await recordTeachBack(medplum, parsedPost!.update);
      return snapshot
        ? noStoreResponse(snapshot)
        : noStoreResponse({ error: "Synthetic consent session was not found" }, 404);
    } catch (error) {
      if (error instanceof FinalizedQuestionnaireResponseError) {
        return noStoreResponse({ error: "Teach-back session is already finalized" }, 409);
      }
      return noStoreResponse({ error: "Medplum workflow request failed" }, 502);
    }
  };
}

export const handleConsentWorkflowRequest = createConsentWorkflowHandler();
