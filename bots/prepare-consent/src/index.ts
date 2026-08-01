import type { BotEvent, MedplumClient } from "@medplum/core";
import type { ServiceRequest, Task, Consent, QuestionnaireResponse } from "@medplum/fhirtypes";
import {
  RUN_TAG,
  KNEE_ARTHROSCOPY_CODE,
  COMPREHENSION_QUESTIONNAIRE_URL,
  CONSENT_POLICY_URI,
  createProvenance,
} from "@consentloop/fhir";

/**
 * Fires on the ServiceRequest Subscription (see scripts/setup-subscriptions.ts).
 * Creates the consent-education Task, a draft Consent, and the session
 * QuestionnaireResponse the patient's voice session will fill in.
 *
 * Idempotent: re-delivery of the same ServiceRequest (Subscriptions can
 * redeliver) is a no-op if a session already exists for it.
 */
export async function handler(
  medplum: MedplumClient,
  event: BotEvent<ServiceRequest>
): Promise<{ task: Task; consent: Consent; questionnaireResponse: QuestionnaireResponse } | undefined> {
  const serviceRequest = event.input;
  if (serviceRequest.resourceType !== "ServiceRequest") return;
  if (serviceRequest.status !== "active") return;

  const isKneeArthroscopy = serviceRequest.code?.coding?.some(
    (c) => c.system === KNEE_ARTHROSCOPY_CODE.system && c.code === KNEE_ARTHROSCOPY_CODE.code
  );
  if (!isKneeArthroscopy) return;

  const patientRef = serviceRequest.subject?.reference;
  if (!patientRef) {
    console.warn("prepare-consent: ServiceRequest has no subject, skipping", serviceRequest.id);
    return;
  }

  const srRef = `ServiceRequest/${serviceRequest.id}`;

  const existing = await medplum.searchResources("Task", { focus: srRef, _count: 1 });
  if (existing.length > 0) {
    console.log("prepare-consent: session already exists for", srRef);
    return;
  }

  const task = await medplum.createResource<Task>({
    resourceType: "Task",
    meta: { tag: [RUN_TAG] },
    status: "requested",
    intent: "order",
    priority: "routine",
    code: { text: "Consent education" },
    description: "Complete consent education and comprehension teach-back for knee arthroscopy",
    for: { reference: patientRef },
    focus: { reference: srRef },
    owner: { display: "ConsentLoop" },
    businessStatus: { text: "Awaiting patient session" },
  });

  // The QuestionnaireResponse must exist before the Consent: FHIR restricts
  // Consent.sourceReference to Consent | DocumentReference | Contract |
  // QuestionnaireResponse, so it cannot point at the ServiceRequest. Pointing
  // it at the comprehension assessment is both legal and the honest reading —
  // that assessment is what this consent derives from.
  const questionnaireResponse = await medplum.createResource<QuestionnaireResponse>({
    resourceType: "QuestionnaireResponse",
    meta: { tag: [RUN_TAG] },
    questionnaire: COMPREHENSION_QUESTIONNAIRE_URL,
    status: "in-progress",
    subject: { reference: patientRef },
    basedOn: [{ reference: srRef }],
    authored: new Date().toISOString(),
  });

  const consent = await medplum.createResource<Consent>({
    resourceType: "Consent",
    meta: { tag: [RUN_TAG] },
    status: "draft",
    scope: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/consentscope",
          code: "treatment",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://loinc.org",
            code: "59284-0",
            display: "Consent Document",
          },
        ],
      },
    ],
    patient: { reference: patientRef },
    dateTime: new Date().toISOString(),
    // Required by FHIR invariant ppc-1 — a Consent with neither `policy` nor
    // `policyRule` is rejected outright.
    policy: [{ uri: CONSENT_POLICY_URI }],
    sourceReference: { reference: `QuestionnaireResponse/${questionnaireResponse.id}` },
  });

  await createProvenance(medplum, {
    targetRefs: [
      `Task/${task.id}`,
      `Consent/${consent.id}`,
      `QuestionnaireResponse/${questionnaireResponse.id}`,
    ],
    activityText: "Consent-preparation bot created the education session",
    agentDisplay: "prepare-consent bot",
    derivedFromRef: srRef,
  });

  console.log("prepare-consent: created session", {
    task: task.id,
    consent: consent.id,
    questionnaireResponse: questionnaireResponse.id,
  });

  return { task, consent, questionnaireResponse };
}
