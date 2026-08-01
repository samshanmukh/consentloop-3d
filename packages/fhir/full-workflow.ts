import type { MedplumClient } from '@medplum/core';
import type { CarePlan, Consent, Provenance, QuestionnaireResponse, Task } from '@medplum/fhirtypes';
import {
  canonicalJson,
  ASSESS_BOT_IDENTIFIER,
  ASSESS_SUBSCRIPTION_TAG,
  consentWorkflowSchema,
  defaultComprehensionConcepts,
  IDENTIFIER_SYSTEM,
  PREPARE_BOT_IDENTIFIER,
  PREPARE_SUBSCRIPTION_TAG,
  TAG_SYSTEM,
  teachBackResultSchema,
  transitionConsentWorkflow,
  WORKFLOW_EXTENSION_URL,
  type ComprehensionStatus,
  type ConsentWorkflow,
} from '../shared/index.js';
import { deployAssessmentAutomation } from './assess-automation.js';
import { DEMO_IDENTIFIERS, identifierQuery, seedDemo } from './demo-resources.js';
import { getStringExtension, replaceStringExtension } from './extensions.js';
import { buildReviewRequestBundle, buildReviewResolutionBundle } from './option-actions.js';
import { readOptionSnapshot } from './option-snapshot.js';
import { deployPreparationAutomation } from './prepare-automation.js';
import { resetDemo } from './reset-demo.js';
import { loadSessionReadModel } from './session-read-model.js';
import { buildClinicianTaskResolutionBundle, buildSnapshotReviewBundle } from './workflow-actions.js';

async function waitFor<T>(read: () => Promise<T | undefined>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value && accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function structuredResponse(response: QuestionnaireResponse, contradicted: boolean): QuestionnaireResponse {
  const items = defaultComprehensionConcepts().map((concept, index) => {
    const status: ComprehensionStatus = contradicted && index === 1 ? 'contradicted' : 'understood';
    const result = teachBackResultSchema.parse({
      conceptId: concept.id, status, evidence: `Patient explanation of ${concept.id}.`,
      ...(status === 'contradicted' ? { misconception: 'The entire knee will be replaced.', clarification: 'Only the meniscus is under discussion.' } : {}),
      requiresClinician: status === 'contradicted',
    });
    return { linkId: concept.id, text: concept.title, answer: [{ valueString: canonicalJson(result) }] };
  });
  return { ...structuredClone(response), status: contradicted ? 'completed' : 'amended', authored: new Date().toISOString(), item: items };
}

function readWorkflow(consent: Consent): ConsentWorkflow {
  const encoded = getStringExtension(consent.extension, WORKFLOW_EXTENSION_URL);
  if (!encoded) throw new Error('Consent workflow is missing');
  return consentWorkflowSchema.parse(JSON.parse(encoded));
}

async function preparedSession(medplum: MedplumClient, requestId: string) {
  const [carePlan, task, consent, response, provenance] = await Promise.all([
    waitFor(() => medplum.searchOne('CarePlan', identifierQuery(`options:${requestId}`)), () => true, 'option CarePlan'),
    waitFor(() => medplum.searchOne('Task', identifierQuery(`task:${requestId}`)), () => true, 'education Task'),
    waitFor(() => medplum.searchOne('Consent', identifierQuery(`consent:${requestId}`)), () => true, 'draft Consent'),
    waitFor(() => medplum.searchOne('QuestionnaireResponse', identifierQuery(`questionnaire-response:${requestId}`)), () => true, 'QuestionnaireResponse'),
    waitFor(
      () => medplum.searchOne('Provenance', new URLSearchParams({ _tag: `${TAG_SYSTEM}|prepare-provenance:${requestId}` }).toString()),
      () => true,
      'preparation Provenance',
    ),
  ]);
  return { carePlan, task, consent, response, provenance };
}

async function requestAndResolveReferral(
  medplum: MedplumClient,
  resources: Awaited<ReturnType<typeof preparedSession>>,
  patientReference: string,
  clinicianReference: string,
): Promise<void> {
  const now = new Date().toISOString();
  const request = {
    optionId: 'regenerative-specialist-review', kind: 'referral' as const,
    question: 'Please arrange a regenerative medicine specialist review.', patientReference, now,
  };
  await medplum.executeBatch(buildReviewRequestBundle(resources.carePlan, resources.consent, request));
  const carePlan = await medplum.readResource('CarePlan', resources.carePlan.id);
  const consent = await medplum.readResource('Consent', resources.consent.id);
  if (readWorkflow(consent).status !== 'review') throw new Error(`Consent/${consent.id} did not block on referral`);
  const question = readOptionSnapshot(carePlan).options.find((option) => option.id === request.optionId)?.questions?.[0];
  if (!question) throw new Error(`CarePlan/${carePlan.id} is missing the referral question`);
  const task = await waitFor(
    () => medplum.searchOne('Task', identifierQuery(`option-review:${question.id}`)),
    (candidate) => candidate.status === 'requested',
    `referral Task for ${question.id}`,
  );
  await medplum.executeBatch(buildReviewResolutionBundle(carePlan, consent, task, {
    questionId: question.id, response: 'Referral reviewed and discussed with the patient.', clinicianReference, now: new Date().toISOString(),
  }));
}

async function contradictionAndCorrection(
  medplum: MedplumClient,
  resources: Awaited<ReturnType<typeof preparedSession>>,
  clinicianReference: string,
): Promise<void> {
  await medplum.updateResource(structuredResponse(await medplum.readResource('QuestionnaireResponse', resources.response.id), true));
  const escalation = await waitFor(
    () => medplum.searchOne('Task', identifierQuery(`comprehension-review:${resources.response.id}`)),
    (task) => task.status === 'requested',
    'contradiction escalation Task',
  );
  const blocked = await medplum.readResource('Consent', resources.consent.id);
  if (readWorkflow(blocked).status !== 'review') throw new Error(`Consent/${blocked.id} did not block on contradiction`);
  await medplum.executeBatch(buildClinicianTaskResolutionBundle(blocked, escalation, {
    clinicianReference, response: 'Clinician corrected the knee-replacement misconception.', now: new Date().toISOString(),
  }));
  await medplum.updateResource(structuredResponse(await medplum.readResource('QuestionnaireResponse', resources.response.id), false));
  await waitFor(
    () => medplum.readResource('Consent', resources.consent.id),
    (consent) => readWorkflow(consent).status === 'ready',
    'corrected ready Consent',
  );
}

async function proveStaleGuard(
  medplum: MedplumClient,
  consentId: string,
  carePlan: CarePlan,
  clinicianReference: string,
): Promise<void> {
  const consent = await medplum.readResource('Consent', consentId);
  const stale = transitionConsentWorkflow(readWorkflow(consent), { type: 'mark-snapshot-stale' });
  const updated = await medplum.updateResource({
    ...consent, status: 'draft', extension: replaceStringExtension(consent.extension, WORKFLOW_EXTENSION_URL, canonicalJson(stale)),
  });
  assertSigningBlocked(updated);
  await medplum.executeBatch(buildSnapshotReviewBundle(updated, await medplum.readResource('CarePlan', carePlan.id as string), {
    clinicianReference, now: new Date().toISOString(),
  }));
}

function assertSigningBlocked(consent: Consent): void {
  const state = readWorkflow(consent);
  try {
    transitionConsentWorkflow(state, { type: 'sign', patientReference: state.patientReference, signedAt: new Date().toISOString() });
  } catch {
    return;
  }
  throw new Error(`Consent/${consent.id ?? 'unknown'} allowed signing with a stale option snapshot`);
}

async function signConsent(medplum: MedplumClient, consentId: string, patientReference: string): Promise<Consent & { id: string }> {
  const consent = await medplum.readResource('Consent', consentId);
  const signedAt = new Date().toISOString();
  const complete = transitionConsentWorkflow(readWorkflow(consent), { type: 'sign', patientReference, signedAt });
  return medplum.updateResource({
    ...consent, status: 'active', dateTime: signedAt,
    extension: replaceStringExtension(consent.extension, WORKFLOW_EXTENSION_URL, canonicalJson(complete)),
  });
}

async function assertNoDuplicates(medplum: MedplumClient, requestId: string): Promise<void> {
  const tasks = await medplum.searchResources('Task', new URLSearchParams({ basedon: `ServiceRequest/${requestId}`, _count: '100' }));
  const identifiers = tasks.flatMap((task) => task.identifier ?? [])
    .filter((identifier) => identifier.system === IDENTIFIER_SYSTEM)
    .map((identifier) => identifier.value)
    .filter((value): value is string => Boolean(value));
  if (new Set(identifiers).size !== identifiers.length) throw new Error(`ServiceRequest/${requestId} has duplicate Tasks`);
  const checks = [
    ['Bot', identifierQuery(PREPARE_BOT_IDENTIFIER)],
    ['Bot', identifierQuery(ASSESS_BOT_IDENTIFIER)],
    ['Subscription', new URLSearchParams({ _tag: `${TAG_SYSTEM}|${PREPARE_SUBSCRIPTION_TAG}` }).toString()],
    ['Subscription', new URLSearchParams({ _tag: `${TAG_SYSTEM}|${ASSESS_SUBSCRIPTION_TAG}` }).toString()],
  ] as const;
  for (const [resourceType, query] of checks) {
    const matches = await medplum.searchResources(resourceType, query);
    if (matches.length !== 1) throw new Error(`${resourceType}?${query} expected exactly one resource; found ${matches.length}`);
  }
}

export interface FullWorkflowResult {
  resetCount: number;
  request: string;
  carePlan: string;
  educationTask: string;
  consent: string;
  questionnaireResponse: string;
  preparationProvenance: string;
  finalStatus: ConsentWorkflow['status'];
  optionCount: number;
  eventCount: number;
}

export async function verifyFullWorkflow(medplum: MedplumClient): Promise<FullWorkflowResult> {
  const reset = await resetDemo(medplum);
  await deployPreparationAutomation(medplum);
  await deployAssessmentAutomation(medplum);
  const seeded = await seedDemo(medplum);
  const resources = await preparedSession(medplum, seeded.serviceRequest.id);
  const patientReference = `Patient/${seeded.patient.id}`;
  const clinicianReference = `Practitioner/${seeded.practitioner.id}`;
  const snapshot = readOptionSnapshot(resources.carePlan);
  const regenerative = snapshot.options.find((option) => option.id === 'regenerative-specialist-review');
  if (snapshot.options.length !== 4 || regenerative?.availability !== 'referral-available' || !regenerative.evidence[0]?.evidenceStrength) {
    throw new Error(`CarePlan/${resources.carePlan.id} is missing the labelled regenerative path`);
  }
  await requestAndResolveReferral(medplum, resources, patientReference, clinicianReference);
  await contradictionAndCorrection(medplum, resources, clinicianReference);
  await proveStaleGuard(medplum, resources.consent.id, resources.carePlan, clinicianReference);
  const ready = await waitFor(() => medplum.readResource('Consent', resources.consent.id), (consent) => readWorkflow(consent).status === 'ready', 'post-review ready Consent');
  const signed = await signConsent(medplum, ready.id, patientReference);
  const patientView = await loadSessionReadModel(medplum, `ServiceRequest/${seeded.serviceRequest.id}`, { role: 'patient', patientId: seeded.patient.id });
  const clinicianView = await loadSessionReadModel(medplum, `Task/${resources.task.id}`, { role: 'clinician' });
  await assertNoDuplicates(medplum, seeded.serviceRequest.id);
  const final = readWorkflow(signed);
  if (final.status !== 'completed' || signed.status !== 'active' || patientView.resources || !clinicianView.resources) {
    throw new Error(`Consent/${signed.id} did not complete with role-safe read models`);
  }
  return {
    resetCount: reset.deleted.length,
    request: `ServiceRequest/${seeded.serviceRequest.id}`,
    carePlan: `CarePlan/${resources.carePlan.id}`,
    educationTask: `Task/${resources.task.id}`,
    consent: `Consent/${signed.id}`,
    questionnaireResponse: `QuestionnaireResponse/${resources.response.id}`,
    preparationProvenance: `Provenance/${(resources.provenance as Provenance & { id: string }).id}`,
    finalStatus: final.status,
    optionCount: patientView.options.length,
    eventCount: patientView.events.length,
  };
}
