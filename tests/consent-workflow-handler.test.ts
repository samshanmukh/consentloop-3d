import assert from "node:assert/strict";
import test from "node:test";

import type { MedplumClient } from "@medplum/core";
import type {
  Consent,
  Patient,
  Provenance,
  Questionnaire,
  QuestionnaireResponse,
  Resource,
  ServiceRequest,
  Task,
} from "@medplum/fhirtypes";
import {
  COMPREHENSION_QUESTIONNAIRE_URL,
  KNEE_ARTHROSCOPY_CODE,
  RUN_TAG,
  SEED_TAG,
  parseTeachBackResults,
} from "@consentloop/fhir";
import { createConsentWorkflowHandler } from "../worker/consent-workflow";

function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://consentloop.example/api/consent-workflow", {
    method,
    headers: {
      Origin: "https://consentloop.example",
      "Sec-Fetch-Site": "same-origin",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function seedFakeMedplum(options: { completed?: boolean } = {}) {
  const patient: Patient = {
    resourceType: "Patient",
    id: "patient-1",
    meta: { tag: [SEED_TAG], lastUpdated: "2026-08-01T12:00:00.000Z" },
    name: [{ given: ["Sam"], family: "Lee" }],
  };
  const serviceRequest: ServiceRequest = {
    resourceType: "ServiceRequest",
    id: "service-request-1",
    meta: { tag: [RUN_TAG], lastUpdated: "2026-08-01T12:01:00.000Z" },
    status: "active",
    intent: "order",
    code: { coding: [KNEE_ARTHROSCOPY_CODE] },
    subject: { reference: "Patient/patient-1" },
    bodySite: [{ text: "Right knee" }],
  };
  const educationTask: Task = {
    resourceType: "Task",
    id: "task-1",
    meta: { tag: [RUN_TAG], lastUpdated: "2026-08-01T12:02:00.000Z" },
    status: "requested",
    intent: "order",
    focus: { reference: "ServiceRequest/service-request-1" },
    for: { reference: "Patient/patient-1" },
  };
  const questionnaireResponse: QuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    id: "qr-1",
    meta: { tag: [RUN_TAG], lastUpdated: "2026-08-01T12:03:00.000Z" },
    questionnaire: COMPREHENSION_QUESTIONNAIRE_URL,
    status: options.completed ? "completed" : "in-progress",
    subject: { reference: "Patient/patient-1" },
    basedOn: [{ reference: "ServiceRequest/service-request-1" }],
  };
  const consent: Consent = {
    resourceType: "Consent",
    id: "consent-1",
    meta: { tag: [RUN_TAG], lastUpdated: "2026-08-01T12:04:00.000Z" },
    status: "draft",
    scope: {},
    category: [],
    sourceReference: { reference: "QuestionnaireResponse/qr-1" },
  };
  const questionnaire: Questionnaire = {
    resourceType: "Questionnaire",
    id: "questionnaire-1",
    url: COMPREHENSION_QUESTIONNAIRE_URL,
    status: "active",
  };
  const store = new Map<string, Resource>();
  for (const resource of [
    patient,
    serviceRequest,
    educationTask,
    questionnaireResponse,
    consent,
    questionnaire,
  ]) {
    store.set(`${resource.resourceType}/${resource.id}`, resource);
  }
  let nextId = 0;

  function resources(resourceType: string): Resource[] {
    return [...store.values()].filter(
      (resource) => resource.resourceType === resourceType,
    );
  }

  const client = {
    async readResource(resourceType: string, id: string) {
      const found = store.get(`${resourceType}/${id}`);
      if (!found) throw new Error(`secret backend detail: missing ${resourceType}/${id}`);
      return found;
    },
    async readReference(reference: { reference?: string }) {
      const found = reference.reference ? store.get(reference.reference) : undefined;
      if (!found) throw new Error("secret backend detail: missing reference");
      return found;
    },
    async searchResources(
      resourceType: string,
      params: Record<string, string | number>,
    ) {
      return resources(resourceType).filter((resource) => {
        if (resourceType === "ServiceRequest" && params.subject) {
          return (resource as ServiceRequest).subject.reference === params.subject;
        }
        if (resourceType === "Task" && params.focus) {
          return (resource as Task).focus?.reference === params.focus;
        }
        if (resourceType === "Task" && params["part-of"]) {
          return (resource as Task).partOf?.some(
            (part) => part.reference === params["part-of"],
          );
        }
        if (resourceType === "QuestionnaireResponse" && params["based-on"]) {
          return (resource as QuestionnaireResponse).basedOn?.some(
            (basedOn) => basedOn.reference === params["based-on"],
          );
        }
        if (resourceType === "Consent" && params["source-reference"]) {
          return (
            (resource as Consent).sourceReference?.reference ===
            params["source-reference"]
          );
        }
        if (resourceType === "Questionnaire" && params.url) {
          return (resource as Questionnaire).url === params.url;
        }
        return true;
      });
    },
    async updateResource<T extends Resource>(resource: T): Promise<T> {
      if (!resource.id) throw new Error("secret backend detail: id required");
      const updated = {
        ...resource,
        meta: {
          ...resource.meta,
          lastUpdated: "2026-08-01T12:10:00.000Z",
        },
      } as T;
      store.set(`${resource.resourceType}/${resource.id}`, updated);
      return updated;
    },
    async createResource<T extends Resource>(resource: T): Promise<T> {
      const created = {
        ...resource,
        id: `created-${++nextId}`,
        meta: {
          ...resource.meta,
          lastUpdated: "2026-08-01T12:10:00.000Z",
        },
      } as T;
      store.set(`${resource.resourceType}/${created.id}`, created);
      return created;
    },
  } as unknown as MedplumClient;

  return { client, store };
}

const misconceptionUpdate = {
  conceptId: "tissue-treated",
  status: "contradicted",
  evidence: "The surgeon is replacing my whole knee.",
  misconception: "Believes the complete knee is being replaced.",
  clarification: "Only the torn meniscus may be trimmed or repaired.",
} as const;

test("handler rejects unsupported methods, cross-origin calls, and missing configuration", async () => {
  const handler = createConsentWorkflowHandler();

  const unsupported = await handler(request("DELETE"), {});
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "GET, POST");

  const crossOrigin = await handler(
    request("GET", undefined, { Origin: "https://attacker.example" }),
    {},
  );
  assert.equal(crossOrigin.status, 403);

  const missingConfiguration = await handler(request("GET"), {});
  assert.equal(missingConfiguration.status, 503);
  assert.deepEqual(await missingConfiguration.json(), {
    error: "Medplum is not configured",
  });
  assert.match(missingConfiguration.headers.get("Cache-Control") ?? "", /no-store/);
});

test("handler validates content type, JSON, payload shape, and actual body size before login", async () => {
  let providerCalls = 0;
  const handler = createConsentWorkflowHandler({
    getClient: async () => {
      providerCalls += 1;
      return null;
    },
  });

  const wrongContentType = await handler(
    request("POST", undefined, { "Content-Type": "text/plain" }),
    {},
  );
  assert.equal(wrongContentType.status, 415);

  const badJson = await handler(
    new Request("https://consentloop.example/api/consent-workflow", {
      method: "POST",
      headers: {
        Origin: "https://consentloop.example",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: "not json",
    }),
    {},
  );
  assert.equal(badJson.status, 400);

  const invalidPayload = await handler(request("POST", { status: "understood" }), {});
  assert.equal(invalidPayload.status, 400);

  const tooLarge = await handler(
    request("POST", {
      ...misconceptionUpdate,
      evidence: "x".repeat(9_000),
    }),
    {},
  );
  assert.equal(tooLarge.status, 413);
  assert.equal(providerCalls, 0);
});

test("teach-back write updates QR, recomputes workflow, and returns Medplum snapshot", async () => {
  const { client, store } = seedFakeMedplum();
  const handler = createConsentWorkflowHandler({
    getClient: async () => client,
  });

  const response = await handler(request("POST", misconceptionUpdate), {});
  assert.equal(response.status, 200);
  const snapshot = await response.json() as {
    source: string;
    connected: boolean;
    taskStatus: string;
    consentStatus: string;
    clinicianEscalation: string;
    concepts: Record<string, { status: string; misconception?: string }>;
  };
  assert.equal(snapshot.source, "medplum");
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.taskStatus, "on-hold");
  assert.equal(snapshot.consentStatus, "draft");
  assert.equal(snapshot.clinicianEscalation, "requested");
  assert.equal(snapshot.concepts["tissue-treated"].status, "contradicted");

  const savedQr = store.get("QuestionnaireResponse/qr-1") as QuestionnaireResponse;
  assert.equal(savedQr.status, "in-progress");
  assert.equal(parseTeachBackResults(savedQr)[0].misconception, misconceptionUpdate.misconception);
  assert.equal((store.get("Task/task-1") as Task).status, "on-hold");
  assert.equal((store.get("Consent/consent-1") as Consent).status, "draft");

  const clinicianTask = [...store.values()].find(
    (resource): resource is Task =>
      resource.resourceType === "Task" && resource.id !== "task-1",
  );
  assert.equal(clinicianTask?.status, "requested");
  assert.equal(clinicianTask?.priority, "urgent");
  assert.ok(
    [...store.values()].some(
      (resource): resource is Provenance => resource.resourceType === "Provenance",
    ),
  );
});

test("finalized QuestionnaireResponses reject further writes without exposing internals", async () => {
  const { client, store } = seedFakeMedplum({ completed: true });
  const handler = createConsentWorkflowHandler({
    getClient: async () => client,
  });
  const before = structuredClone(store.get("QuestionnaireResponse/qr-1"));

  const response = await handler(request("POST", misconceptionUpdate), {});
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Teach-back session is already finalized",
  });
  assert.deepEqual(store.get("QuestionnaireResponse/qr-1"), before);

  const leakingHandler = createConsentWorkflowHandler({
    getClient: async () => {
      throw new Error("MEDPLUM_CLIENT_SECRET=should-never-leak");
    },
  });
  const unavailable = await leakingHandler(request("GET"), {});
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /should-never-leak/);
});
