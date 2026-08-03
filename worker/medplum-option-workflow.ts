import type { MedplumClient } from "@medplum/core";
import type { QuestionnaireResponse, ServiceRequest } from "@medplum/fhirtypes";
import type {
  ConsentWorkflowEvent,
  ConsentWorkflowSnapshot,
  TeachBackUpdate,
} from "../app/lib/consent-workflow";
import { createDefaultWorkflowSnapshot } from "../app/lib/consent-workflow";
import {
  loadSessionReadModel,
  type SessionReadModel,
} from "../packages/fhir/session-read-model";
import {
  ASSESS_BOT_IDENTIFIER,
  DEMO_TAG,
  IDENTIFIER_SYSTEM,
  TAG_SYSTEM,
} from "../packages/shared/constants";

function patientIdFromRequest(request: ServiceRequest): string | null {
  const reference = request.subject?.reference;
  return reference?.startsWith("Patient/")
    ? reference.slice("Patient/".length)
    : null;
}

function referenceId(reference: string | undefined, resourceType: string): string | null {
  const prefix = `${resourceType}/`;
  return reference?.startsWith(prefix) ? reference.slice(prefix.length) : null;
}

export async function findOptionAwareSession(
  medplum: MedplumClient,
): Promise<SessionReadModel | null> {
  const query = new URLSearchParams({
    _tag: `${TAG_SYSTEM}|${DEMO_TAG}`,
    _sort: "-_lastUpdated",
    _count: "20",
  });
  const requests = await medplum.searchResources("ServiceRequest", query);

  for (const request of requests) {
    const patientId = patientIdFromRequest(request);
    if (!request.id || !patientId) continue;
    try {
      return await loadSessionReadModel(
        medplum,
        `ServiceRequest/${request.id}`,
        { role: "patient", patientId },
      );
    } catch {
      // A tagged order may still be waiting for the preparation bot. Continue
      // to an older complete session before falling back to the legacy model.
    }
  }

  return null;
}

function workflowTaskStatus(
  status: SessionReadModel["status"],
): ConsentWorkflowSnapshot["taskStatus"] {
  switch (status) {
    case "preparing":
      return "requested";
    case "review":
      return "on-hold";
    case "completed":
      return "completed";
    case "educating":
    case "ready":
      return "in-progress";
  }
}

function eventResourceType(
  resourceType: string,
): ConsentWorkflowEvent["resourceType"] {
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

export function optionAwareSessionToSnapshot(
  session: SessionReadModel,
  now = new Date().toISOString(),
): ConsentWorkflowSnapshot {
  const snapshot = createDefaultWorkflowSnapshot(now);
  for (const concept of session.comprehension) {
    const existing = snapshot.concepts[concept.id];
    if (!existing) continue;
    const result = session.teachBackResults.find(
      (candidate) => candidate.conceptId === concept.id,
    );
    snapshot.concepts[concept.id] = {
      ...existing,
      status: concept.status,
      evidence: result?.evidence ?? "",
      ...(result?.misconception
        ? { misconception: result.misconception }
        : {}),
      ...(result?.clarification
        ? { clarification: result.clarification }
        : {}),
      updatedAt: now,
    };
  }

  const events = session.events.slice(-24).reverse().map((event, index) => ({
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
    patientId: session.patientId,
    serviceRequestId: session.serviceRequestId,
    questionnaireResponseId: referenceId(
      session.resourceIds.questionnaireResponse,
      "QuestionnaireResponse",
    ) ?? undefined,
    taskId: referenceId(session.resourceIds.educationTask, "Task") ?? undefined,
    consentId: referenceId(session.resourceIds.consent, "Consent") ?? undefined,
    procedureName: session.procedure,
    taskStatus: workflowTaskStatus(session.status),
    consentStatus: session.consentStatus,
    clinicianEscalation: session.status === "review" ? "requested" : "none",
    workflowStatus: session.status,
    optionSnapshotStale: session.stale,
    optionSnapshotVersion: session.optionSnapshotVersion,
    optionCatalogVersion: session.catalogVersion,
    optionSourceCoverage: session.sourceCoverage,
    blockers: session.blockers,
    treatmentOptions: session.options.map((option) => ({
      id: option.id,
      title: option.title,
      summary: option.summary,
      expectedBenefits: option.expectedBenefits,
      materialRisks: option.materialRisks,
      eligibilityQuestions: option.eligibilityQuestions,
      recoveryConsiderations: option.recoveryConsiderations,
      clinicalStatus: option.clinicalStatus,
      availability: option.availability,
      evidence: option.evidence.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        jurisdiction: source.jurisdiction,
        evidenceStrength: source.evidenceStrength,
        regulatoryStatus: source.regulatoryStatus,
      })),
    })),
    diagnosticSummaries: session.diagnosticSummaries,
    unresolvedQuestions: session.options.flatMap((option) =>
      (option.questions ?? [])
        .filter((question) => question.status === "open")
        .map((question) => question.text),
    ),
    concepts: snapshot.concepts,
    events,
    updatedAt: events[0]?.timestamp ?? now,
  };
}

interface StoredTeachBackResult {
  conceptId: string;
  status: string;
  evidence: string;
  misconception?: string;
  clarification?: string;
  requiresClinician: boolean;
}

function readStoredResult(
  response: QuestionnaireResponse,
  conceptId: string,
): StoredTeachBackResult | null {
  const encoded = response.item?.find((item) => item.linkId === conceptId)
    ?.answer?.[0]?.valueString;
  if (!encoded) return null;
  try {
    const candidate = JSON.parse(encoded) as StoredTeachBackResult;
    return candidate?.conceptId === conceptId && typeof candidate.evidence === "string"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

export async function recordOptionAwareTeachBack(
  medplum: MedplumClient,
  session: SessionReadModel,
  update: TeachBackUpdate,
): Promise<ConsentWorkflowSnapshot> {
  const responseId = referenceId(
    session.resourceIds.questionnaireResponse,
    "QuestionnaireResponse",
  );
  if (!responseId) throw new Error("QuestionnaireResponse reference is missing");

  const current = await medplum.readResource("QuestionnaireResponse", responseId);
  const now = new Date().toISOString();
  const item = session.comprehension.map((concept) => {
    const stored = readStoredResult(current, concept.id);
    const result: StoredTeachBackResult = concept.id === update.conceptId
      ? {
          conceptId: update.conceptId,
          status: update.status,
          evidence: update.evidence.trim(),
          ...(update.misconception
            ? { misconception: update.misconception.trim() }
            : {}),
          ...(update.clarification
            ? { clarification: update.clarification.trim() }
            : {}),
          requiresClinician:
            update.status === "contradicted" || update.status === "uncertain",
        }
      : stored ?? {
          conceptId: concept.id,
          status: concept.status,
          evidence: `${concept.title} has not been discussed yet.`,
          requiresClinician:
            concept.status === "contradicted" || concept.status === "uncertain",
        };
    return {
      linkId: concept.id,
      text: concept.title,
      answer: [{ valueString: JSON.stringify(result) }],
    };
  });

  const updated = await medplum.updateResource<QuestionnaireResponse>({
    ...current,
    status: current.status === "completed" ? "amended" : "completed",
    authored: now,
    item,
  });

  await medplum.executeBot(
    { system: IDENTIFIER_SYSTEM, value: ASSESS_BOT_IDENTIFIER },
    updated,
    "application/fhir+json",
  );

  const refreshed = await loadSessionReadModel(
    medplum,
    `ServiceRequest/${session.serviceRequestId}`,
    { role: "patient", patientId: session.patientId },
  );
  return optionAwareSessionToSnapshot(refreshed, now);
}
