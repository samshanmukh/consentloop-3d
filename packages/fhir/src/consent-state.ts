import type { MedplumClient } from "@medplum/core";
import type { Task, Consent, QuestionnaireResponse } from "@medplum/fhirtypes";
import type { ComprehensionConcept } from "@consentloop/shared";
import { COMPREHENSION_CONCEPT_IDS } from "@consentloop/shared";
import { RUN_TAG, TASK_KIND_SYSTEM, CLINICIAN_REVIEW_TASK_CODE } from "./constants";
import { createProvenance } from "./provenance";
import { findClinicianTask } from "./session";

export interface ConsentAction {
  /** Consent must stay draft — never activated by this pass. */
  blocked: boolean;
  /** A contradiction or unresolved uncertainty needs a human to look. */
  needsClinician: boolean;
  /** Every critical concept is `understood`. */
  allUnderstood: boolean;
  urgent: boolean;
  reason: string;
}

/**
 * Pure classification over the current concept snapshot — no FHIR I/O. Always
 * recomputed from the latest QuestionnaireResponse rather than accumulated,
 * because a later contradiction (the patient re-answers wrong) must be able
 * to re-block a session that briefly looked resolved.
 *
 * Workflow rules, as specified: contradiction blocks Consent, uncertainty
 * creates a clinician Task, understood completes the education Task.
 */
export function deriveConsentAction(
  concepts: ComprehensionConcept[]
): ConsentAction {
  const contradicted = concepts.filter((c) => c.status === "contradicted");
  const uncertain = concepts.filter((c) => c.status === "uncertain");
  const allAnswered = concepts.length === COMPREHENSION_CONCEPT_IDS.length;
  const allUnderstood =
    allAnswered && concepts.every((c) => c.status === "understood");

  if (contradicted.length > 0) {
    return {
      blocked: true,
      needsClinician: true,
      allUnderstood: false,
      urgent: true,
      reason: `Contradicted: ${contradicted.map((c) => c.title).join(", ")}`,
    };
  }

  if (uncertain.length > 0) {
    return {
      blocked: true,
      needsClinician: true,
      allUnderstood: false,
      urgent: false,
      reason: `Uncertain: ${uncertain.map((c) => c.title).join(", ")}`,
    };
  }

  if (allUnderstood) {
    return {
      blocked: false,
      needsClinician: false,
      allUnderstood: true,
      urgent: false,
      reason: "All critical concepts understood",
    };
  }

  return {
    blocked: true,
    needsClinician: false,
    allUnderstood: false,
    urgent: false,
    reason: "Education in progress",
  };
}

export interface WorkflowResult {
  action: ConsentAction;
  taskStatus: Task["status"];
  consentStatus: Consent["status"];
  clinicianTaskId?: string;
}

/**
 * Applies deriveConsentAction's classification as real FHIR writes.
 *
 * ⚠️ SAFETY INVARIANT: Consent only ever reaches `active` when
 * `allUnderstood` AND the QuestionnaireResponse itself is `completed` (a
 * final submission, not an in-flight turn). A transient good-looking snapshot
 * mid-conversation must never activate consent — see README "Safety
 * principles": consent is never activated merely because the model reports
 * high confidence.
 */
export async function applyWorkflowRules(
  medplum: MedplumClient,
  args: {
    task: Task;
    consent: Consent;
    questionnaireResponse: QuestionnaireResponse;
    concepts: ComprehensionConcept[];
  }
): Promise<WorkflowResult> {
  const { questionnaireResponse: qr, concepts } = args;
  let { task, consent } = args;
  const action = deriveConsentAction(concepts);
  const isFinalSubmission = qr.status === "completed";

  let taskStatus: Task["status"] = task.status;
  if (action.needsClinician) taskStatus = "on-hold";
  else if (action.allUnderstood) taskStatus = "completed";
  else taskStatus = "in-progress";

  if (taskStatus !== task.status) {
    task = await medplum.updateResource<Task>({
      ...task,
      status: taskStatus,
      businessStatus: { text: action.reason },
    });
  }

  let consentStatus: Consent["status"] = consent.status;
  if (action.allUnderstood && isFinalSubmission) {
    consentStatus = "active";
  } else if (consentStatus !== "active") {
    consentStatus = "draft";
  }
  // A Consent that already reached "active" is never silently reverted by a
  // later re-read — only a fresh contradiction on a *new* demo run does that,
  // and a new run gets a fresh Consent resource, not this one.

  if (consentStatus !== consent.status) {
    consent = await medplum.updateResource<Consent>({
      ...consent,
      status: consentStatus,
    });
  }

  let clinicianTaskId: string | undefined;
  if (action.needsClinician) {
    const existing = await findClinicianTask(medplum, task);
    if (existing) {
      clinicianTaskId = existing.id;
      await medplum.updateResource<Task>({
        ...existing,
        status: "requested",
        priority: action.urgent ? "urgent" : "routine",
        description: action.reason,
      });
    } else {
      const created = await medplum.createResource<Task>({
        resourceType: "Task",
        meta: { tag: [RUN_TAG] },
        status: "requested",
        intent: "order",
        priority: action.urgent ? "urgent" : "routine",
        code: {
          coding: [{ system: TASK_KIND_SYSTEM, code: CLINICIAN_REVIEW_TASK_CODE }],
          text: "Clinician review — consent comprehension",
        },
        description: action.reason,
        for: task.for,
        focus: { reference: `QuestionnaireResponse/${qr.id}` },
        partOf: [{ reference: `Task/${task.id}` }],
        owner: { display: "Clinician" },
      });
      clinicianTaskId = created.id;
    }
  }

  await createProvenance(medplum, {
    targetRefs: [
      `Task/${task.id}`,
      `Consent/${consent.id}`,
      ...(clinicianTaskId ? [`Task/${clinicianTaskId}`] : []),
    ],
    activityText: action.reason,
    agentDisplay: "assess-teachback bot",
    derivedFromRef: `QuestionnaireResponse/${qr.id}`,
  });

  return { action, taskStatus: task.status, consentStatus: consent.status, clinicianTaskId };
}
