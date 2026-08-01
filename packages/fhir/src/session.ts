import type { MedplumClient } from "@medplum/core";
import type {
  ServiceRequest,
  Task,
  Consent,
  QuestionnaireResponse,
  Provenance,
} from "@medplum/fhirtypes";
import {
  CONCEPT_DEFINITIONS,
  COMPREHENSION_CONCEPT_IDS,
  type ComprehensionConcept,
  type ComprehensionStatus,
  type ConsentSession,
  type ConsentSessionStatus,
  type ConsentEvent,
} from "@consentloop/shared";
import { RUN_TAG, TASK_KIND_SYSTEM, CLINICIAN_REVIEW_TASK_CODE } from "./constants";

/**
 * Reads a QuestionnaireResponse's grouped items back into
 * @consentloop/shared's ComprehensionConcept[]. This is the single place
 * that understands the Questionnaire's linkId shape (see questionnaire.ts) —
 * both the assess-teachback bot and the clinician UI's data layer import
 * this instead of walking `item[]` themselves.
 */
export function parseComprehensionConcepts(
  qr: QuestionnaireResponse
): ComprehensionConcept[] {
  const concepts: ComprehensionConcept[] = [];

  for (const conceptId of COMPREHENSION_CONCEPT_IDS) {
    const group = qr.item?.find((i) => i.linkId === conceptId);
    if (!group) continue;

    const statusItem = group.item?.find(
      (i) => i.linkId === `${conceptId}.status`
    );
    const code = statusItem?.answer?.[0]?.valueCoding?.code as
      | ComprehensionStatus
      | undefined;
    if (!code) continue;

    const def = CONCEPT_DEFINITIONS[conceptId];
    concepts.push({
      id: conceptId,
      title: def.title,
      critical: def.critical,
      status: code,
      sceneId: def.sceneId,
    });
  }

  return concepts;
}

/** Everything the assess-teachback bot needs, resolved from one QuestionnaireResponse. */
export interface SessionRefs {
  serviceRequest: ServiceRequest;
  task: Task;
  consent: Consent;
  questionnaireResponse: QuestionnaireResponse;
}

/**
 * Locates the education Task and draft Consent that belong to a
 * QuestionnaireResponse, via its `basedOn` ServiceRequest reference. All
 * three were created together by prepare-consent, tagged with RUN_TAG, so a
 * subject + focus search is enough — no ids need to be threaded through env
 * vars or client state.
 */
export async function findSessionRefs(
  medplum: MedplumClient,
  qr: QuestionnaireResponse
): Promise<SessionRefs | null> {
  const srRef = qr.basedOn?.[0]?.reference;
  if (!srRef) return null;
  const [, srId] = srRef.split("/");

  const serviceRequest = await medplum.readResource("ServiceRequest", srId);

  const tasks = await medplum.searchResources("Task", {
    focus: srRef,
    _count: 20,
  });
  const task = tasks.find((t) => !isClinicianReviewTask(t));
  if (!task) return null;

  const consents = await medplum.searchResources("Consent", {
    "source-reference": srRef,
    _count: 5,
  });
  const consent = consents[0];
  if (!consent) return null;

  return { serviceRequest, task, consent, questionnaireResponse: qr };
}

function isClinicianReviewTask(task: Task): boolean {
  return task.code?.coding?.some(
    (c) => c.system === TASK_KIND_SYSTEM && c.code === CLINICIAN_REVIEW_TASK_CODE
  ) ?? false;
}

/** Finds the existing clinician-escalation Task for a session, if any. */
export async function findClinicianTask(
  medplum: MedplumClient,
  educationTask: Task
): Promise<Task | undefined> {
  const found = await medplum.searchResources("Task", {
    "part-of": `Task/${educationTask.id}`,
    _count: 5,
  });
  return found.find(isClinicianReviewTask);
}

function deriveSessionStatus(
  concepts: ComprehensionConcept[],
  task: Task,
  consent: Consent
): ConsentSessionStatus {
  if (consent.status === "active") return "completed";
  if (task.status === "on-hold") return "review";
  if (concepts.length === 0) return "preparing";
  if (concepts.every((c) => c.status === "understood")) return "ready";
  return "educating";
}

/**
 * The read model both apps/patient and apps/clinician poll — Person 1's half
 * of "expose data required by both UIs". Resolves the current
 * @consentloop/shared ConsentSession for a patient's most recent demo run.
 */
export async function getConsentSession(
  medplum: MedplumClient,
  patientId: string
): Promise<ConsentSession | null> {
  const serviceRequests = await medplum.searchResources("ServiceRequest", {
    subject: `Patient/${patientId}`,
    _sort: "-_lastUpdated",
    _count: 1,
  });
  const serviceRequest = serviceRequests[0];
  if (!serviceRequest?.id) return null;

  const srRef = `ServiceRequest/${serviceRequest.id}`;

  const [tasks, consents, questionnaireResponses] = await Promise.all([
    medplum.searchResources("Task", { focus: srRef, _count: 20 }),
    medplum.searchResources("Consent", { "source-reference": srRef, _count: 5 }),
    medplum.searchResources("QuestionnaireResponse", {
      "based-on": srRef,
      _count: 5,
    }),
  ]);

  const task = tasks.find((t) => !isClinicianReviewTask(t));
  const consent = consents[0];
  const qr = questionnaireResponses[0];
  if (!task?.id || !consent?.id || !qr?.id) return null;

  const concepts = parseComprehensionConcepts(qr);

  return {
    patientId,
    serviceRequestId: serviceRequest.id,
    taskId: task.id,
    consentId: consent.id,
    questionnaireResponseId: qr.id,
    procedureCode: serviceRequest.code?.coding?.[0]?.code ?? "",
    status: deriveSessionStatus(concepts, task, consent),
  };
}

export async function listComprehensionConcepts(
  medplum: MedplumClient,
  questionnaireResponseId: string
): Promise<ComprehensionConcept[]> {
  const qr = await medplum.readResource(
    "QuestionnaireResponse",
    questionnaireResponseId
  );
  return parseComprehensionConcepts(qr);
}

/**
 * The clinician dashboard's live event stream — every Provenance this
 * workflow wrote, newest first, each carrying the real resource it targeted
 * so the UI can expand to raw FHIR JSON.
 */
export async function listConsentEvents(
  medplum: MedplumClient,
  patientId: string
): Promise<ConsentEvent[]> {
  const serviceRequests = await medplum.searchResources("ServiceRequest", {
    subject: `Patient/${patientId}`,
    _sort: "-_lastUpdated",
    _count: 1,
  });
  const serviceRequest = serviceRequests[0];
  if (!serviceRequest?.id) return [];
  const srRef = `ServiceRequest/${serviceRequest.id}`;

  const tasks = await medplum.searchResources("Task", { focus: srRef, _count: 1 });
  const educationTask = tasks[0];
  if (!educationTask?.id) return [];
  const taskRef = `Task/${educationTask.id}`;

  const provenance = (await medplum.searchResources("Provenance", {
    _tag: `${RUN_TAG.system}|${RUN_TAG.code}`,
    _sort: "-recorded",
    _count: 100,
  })) as Provenance[];

  // Both bots always include the education Task in `target` — prepare-consent
  // because it's the resource that was just created, assess-teachback because
  // it's the resource every workflow-rule pass re-touches. Filtering on that
  // one stable reference catches every event in the session (session
  // creation, each teach-back evaluation, clinician escalation, activation),
  // unlike filtering on `entity`, whose `derivedFromRef` points at whichever
  // resource triggered that particular bot (ServiceRequest for one bot,
  // QuestionnaireResponse for the other) and so never matches consistently.
  const relevant = provenance.filter((p) =>
    p.target?.some((t) => t.reference === taskRef)
  );

  const events: ConsentEvent[] = [];
  for (const p of relevant) {
    for (const target of p.target ?? []) {
      if (!target.reference) continue;
      const [resourceType, resourceId] = target.reference.split("/");
      let resource: Record<string, unknown> = {};
      try {
        resource = (await medplum.readReference({ reference: target.reference })) as unknown as Record<string, unknown>;
      } catch {
        // resource may have been superseded by a later write in this run; skip body
      }
      events.push({
        timestamp: p.recorded ?? new Date().toISOString(),
        resourceType,
        resourceId,
        action: p.agent?.[0]?.who?.display ?? "system",
        summary: p.activity?.text ?? "",
        resource,
      });
    }
  }

  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
