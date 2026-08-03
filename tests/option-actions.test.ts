import assert from 'node:assert/strict';
import test from 'node:test';
import type { CarePlan, Consent, Task } from '@medplum/fhirtypes';
import {
  buildOptionCarePlan,
  buildOptionCatalog,
  buildPreferenceBundle,
  buildReviewRequestBundle,
  buildReviewResolutionBundle,
  readOptionSnapshot,
} from '../packages/fhir/index.js';
import {
  canonicalJson,
  defaultComprehensionConcepts,
  initialConsentWorkflow,
  WORKFLOW_EXTENSION_URL,
} from '../packages/shared/index.js';
import { stringExtension } from '../packages/fhir/extensions.js';

function versionedCarePlan(): CarePlan {
  const carePlan = buildOptionCarePlan({
    patientId: 'patient-1', serviceRequestId: 'request-1', authorReference: 'Practitioner/doctor-1',
    diagnosticReferences: ['DiagnosticReport/mri-1'], catalog: buildOptionCatalog(), decisions: {},
    createdAt: '2026-08-01T12:00:00.000Z',
  });
  return { ...carePlan, id: 'care-plan-1', meta: { versionId: '1' } };
}

function versionedConsent(carePlan: CarePlan): Consent {
  const snapshot = readOptionSnapshot(carePlan);
  return {
    resourceType: 'Consent', id: 'consent-1', meta: { versionId: '1' }, status: 'draft',
    scope: { text: 'treatment' }, category: [{ text: 'consent' }], patient: { reference: 'Patient/patient-1' },
    extension: [stringExtension(WORKFLOW_EXTENSION_URL, canonicalJson(initialConsentWorkflow('Patient/patient-1', snapshot.snapshotVersion, defaultComprehensionConcepts())))],
  };
}

const request = {
  optionId: 'regenerative-specialist-review', kind: 'referral' as const,
  question: 'Can I see a regenerative medicine specialist?', patientReference: 'Patient/patient-1',
  now: '2026-08-01T13:00:00.000Z',
};

test('records a patient preference immutably with provenance', () => {
  const carePlan = versionedCarePlan();
  const before = structuredClone(carePlan);
  const bundle = buildPreferenceBundle(carePlan, {
    optionId: 'structured-rehabilitation', status: 'preferred', reason: 'I want to try a non-operative path first.',
    patientReference: 'Patient/patient-1', now: request.now,
  });
  const updated = bundle.entry?.[0]?.resource as CarePlan;
  assert.deepEqual(carePlan, before);
  assert.equal(readOptionSnapshot(updated).options[0]?.preference?.status, 'preferred');
  assert.equal(readOptionSnapshot(updated).options[0]?.clinicalStatus, readOptionSnapshot(carePlan).options[0]?.clinicalStatus);
  assert.equal(readOptionSnapshot(updated).snapshotVersion, readOptionSnapshot(carePlan).snapshotVersion);
  assert.equal(bundle.entry?.[1]?.resource?.resourceType, 'Provenance');
  const unsure = buildPreferenceBundle(carePlan, {
    optionId: 'structured-rehabilitation', status: 'unsure', reason: 'I need to discuss recovery time.',
    patientReference: 'Patient/patient-1', now: request.now,
  });
  assert.equal(readOptionSnapshot(unsure.entry?.[0]?.resource as CarePlan).options[0]?.preference?.status, 'unsure');
});

test('creates exactly one conditional review Task and blocks consent', () => {
  const carePlan = versionedCarePlan();
  const consent = versionedConsent(carePlan);
  const first = buildReviewRequestBundle(carePlan, consent, request);
  const second = buildReviewRequestBundle(carePlan, consent, request);
  const tasks = first.entry?.filter((entry) => entry.resource?.resourceType === 'Task') ?? [];
  const updatedCarePlan = first.entry?.[0]?.resource as CarePlan;
  const updatedConsent = first.entry?.[1]?.resource as Consent;
  assert.deepEqual(first, second);
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0]?.request?.ifNoneExist);
  assert.equal(readOptionSnapshot(updatedCarePlan).options[3]?.questions?.[0]?.status, 'open');
  assert.match(updatedConsent.extension?.find((extension) => extension.url === WORKFLOW_EXTENSION_URL)?.valueString ?? '', /option-review/u);
  const replay = buildReviewRequestBundle(
    { ...updatedCarePlan, meta: { ...updatedCarePlan.meta, versionId: '2' } },
    { ...updatedConsent, meta: { ...updatedConsent.meta, versionId: '2' } },
    request,
  );
  assert.equal(replay.entry?.length, 2);
  assert.ok(replay.entry?.every((entry) => entry.request?.method === 'POST'));
});

test('only a clinician can resolve review and the audit trail is preserved', () => {
  const carePlan = versionedCarePlan();
  const consent = versionedConsent(carePlan);
  const requested = buildReviewRequestBundle(carePlan, consent, request);
  const updatedCarePlan = requested.entry?.[0]?.resource as CarePlan;
  const updatedConsent = requested.entry?.[1]?.resource as Consent;
  const question = readOptionSnapshot(updatedCarePlan).options[3]?.questions?.[0];
  assert.ok(question);
  const task: Task = {
    ...(requested.entry?.find((entry) => entry.resource?.resourceType === 'Task')?.resource as Task),
    id: 'review-task-1', meta: { versionId: '1' },
  };
  assert.throws(() => buildReviewResolutionBundle(updatedCarePlan, updatedConsent, task, {
    questionId: question.id, response: 'Review complete.', clinicianReference: 'Patient/patient-1', now: request.now,
  }), /Only a clinician/u);
  const resolved = buildReviewResolutionBundle(updatedCarePlan, updatedConsent, task, {
    questionId: question.id, response: 'Specialist evaluation is clinically reasonable.', clinicianReference: 'Practitioner/doctor-1', now: request.now,
  });
  const finalQuestion = readOptionSnapshot(resolved.entry?.[0]?.resource as CarePlan).options[3]?.questions?.[0];
  assert.equal(finalQuestion?.text, question.text);
  assert.equal(finalQuestion?.requestedBy, question.requestedBy);
  assert.equal(finalQuestion?.status, 'resolved');
  assert.equal(resolved.entry?.[2]?.resource?.resourceType, 'Task');
  assert.equal((resolved.entry?.[2]?.resource as Task).status, 'completed');
});
