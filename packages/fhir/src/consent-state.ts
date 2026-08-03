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

  // Consent is a one-way door (see the invariant below) — once it's active,
  // the session is over. A stray redelivered QuestionnaireResponse must not
  // be able to reopen the education Task out from under an already-final
  // Consent, so this whole pass is a no-op once that door has closed.
  if (consent.status === "active") {
    return {
      action,
      taskStatus: task.status,
      consentStatus: consent.status,
      clinicianTaskId: undefined,
    };
  }

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

  // The early return above already guarantees consent.status !== "active"
  // here, so this is a plain two-way choice: activate on evidence, otherwise
  // stay draft. Consent can only ever move draft → active, never the
  // reverse — that's what makes it safe for a stray redelivery to re-run
  // this function without risking an already-active Consent.
  const consentStatus: Consent["status"] =
    action.allUnderstood && isFinalSubmission ? "active" : "draft";

  if (consentStatus !== consent.status) {
    consent = await medplum.updateResource<Consent>({
      ...consent,
      status: consentStatus,
    });
  }

  let clinicianTaskId: string | undefined;
  if (!action.needsClinician) {
    // The misconception that opened an escalation has been resolved — close
    // it out, or the clinician's unresolved-task queue keeps showing an
    // escalation for a session that already reached a good end state.
    const stale = await findClinicianTask(medplum, task);
    if (stale && stale.status !== "completed") {
      await medplum.updateResource<Task>({
        ...stale,
        status: "completed",
        businessStatus: { text: `Resolved: ${action.reason}` },
      });
    }
  } else {
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
