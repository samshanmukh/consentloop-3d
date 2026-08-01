import assert from 'node:assert/strict';
import test from 'node:test';
import type { CarePlan, Consent, QuestionnaireResponse, Task } from '@medplum/fhirtypes';
import { buildAssessmentBundle, readTeachBackResults } from '../bots/assess-teachback/index.js';
import {
  assessmentBotResource,
  assessmentSubscriptionResource,
  buildOptionCarePlan,
  buildOptionCatalog,
  bundleAssessmentBot,
  readOptionSnapshot,
} from '../packages/fhir/index.js';
import {
  canonicalJson,
  consentWorkflowSchema,
  defaultComprehensionConcepts,
  initialConsentWorkflow,
  transitionConsentWorkflow,
  WORKFLOW_EXTENSION_URL,
} from '../packages/shared/index.js';
import { getStringExtension, stringExtension } from '../packages/fhir/extensions.js';

function carePlan(): CarePlan & { id: string } {
  return {
    ...buildOptionCarePlan({
      patientId: 'patient-1', serviceRequestId: 'request-1', authorReference: 'Practitioner/doctor-1',
      diagnosticReferences: ['DiagnosticReport/mri-1'], catalog: buildOptionCatalog(), decisions: {},
      createdAt: '2026-08-01T12:00:00.000Z',
    }),
    id: 'care-plan-1', meta: { versionId: '1' },
  };
}

function input(status: 'understood' | 'contradicted') {
  const plan = carePlan();
  const state = initialConsentWorkflow('Patient/patient-1', readOptionSnapshot(plan).snapshotVersion, defaultComprehensionConcepts());
  const answer = (conceptId: string) => canonicalJson({
    conceptId, status, evidence: 'Patient explanation.',
    ...(status === 'contradicted' ? { misconception: 'The entire knee will be replaced.' } : {}),
    requiresClinician: status === 'contradicted',
  });
  const response: QuestionnaireResponse & { id: string } = {
    resourceType: 'QuestionnaireResponse', id: 'response-1', meta: { versionId: '2', tag: [{ system: 'https://consentloop.dev/fhir/tags', code: 'synthetic-demo' }] },
    status: 'completed', subject: { reference: 'Patient/patient-1' }, source: { reference: 'Patient/patient-1' }, basedOn: [{ reference: 'ServiceRequest/request-1' }],
    extension: [stringExtension('https://consentloop.dev/fhir/StructureDefinition/session-key', 'prepare:request-1')],
    item: defaultComprehensionConcepts().map((concept) => ({ linkId: concept.id, answer: [{ valueString: answer(concept.id) }] })),
  };
  const educationTask: Task & { id: string } = { resourceType: 'Task', id: 'education-1', meta: { versionId: '1' }, status: 'in-progress', intent: 'plan' };
  const consent: Consent & { id: string } = {
    resourceType: 'Consent', id: 'consent-1', meta: { versionId: '1' }, status: 'draft', scope: { text: 'treatment' }, category: [{ text: 'consent' }],
    extension: [stringExtension(WORKFLOW_EXTENSION_URL, canonicalJson(state))],
  };
  return { response, educationTask, consent, carePlan: plan, botReference: 'Bot/assessment-1', now: '2026-08-01T13:00:00.000Z' };
}

function workflow(consent: Consent) {
  const encoded = getStringExtension(consent.extension, WORKFLOW_EXTENSION_URL);
  return consentWorkflowSchema.parse(JSON.parse(encoded ?? ''));
}

test('understood results complete education but keep consent draft until patient signature', () => {
  const bundle = buildAssessmentBundle(input('understood'));
  const consent = bundle.entry?.[0]?.resource as Consent;
  const task = bundle.entry?.[1]?.resource as Task;
  assert.equal(workflow(consent).status, 'ready');
  assert.equal(consent.status, 'draft');
  assert.equal(task.status, 'completed');
  assert.equal(bundle.entry?.filter((entry) => entry.resource?.resourceType === 'Task').length, 1);
});

test('contradiction blocks consent and creates one idempotent escalation Task', () => {
  const first = buildAssessmentBundle(input('contradicted'));
  const second = buildAssessmentBundle(input('contradicted'));
  const consent = first.entry?.[0]?.resource as Consent;
  const created = first.entry?.slice(2).filter((entry) => entry.resource?.resourceType === 'Task') ?? [];
  assert.deepEqual(first, second);
  assert.equal(workflow(consent).status, 'review');
  assert.equal((first.entry?.[1]?.resource as Task).status, 'on-hold');
  assert.equal(created.length, 1);
  assert.ok(created.every((entry) => entry.request?.ifNoneExist));
});

test('correct teach-back remains blocked while an independent referral is open', () => {
  const assessment = input('understood');
  const blocked = transitionConsentWorkflow(workflow(assessment.consent), { type: 'open-review', taskId: 'option-review:referral-1' });
  assessment.consent.extension = [stringExtension(WORKFLOW_EXTENSION_URL, canonicalJson(blocked))];
  const bundle = buildAssessmentBundle(assessment);
  assert.equal(workflow(bundle.entry?.[0]?.resource as Consent).status, 'review');
  assert.equal((bundle.entry?.[1]?.resource as Task).status, 'on-hold');
  assert.equal(bundle.entry?.slice(2).filter((entry) => entry.resource?.resourceType === 'Task').length, 0);
});

test('rejects incomplete or mismatched structured results', () => {
  const assessment = input('understood');
  assessment.response.item = assessment.response.item!.slice(1);
  assert.throws(() => readTeachBackResults(assessment.response), /every comprehension concept/u);
});

test('builds deployable assessment Bot and update-only Subscription', async () => {
  const code = await bundleAssessmentBot();
  const bot = assessmentBotResource();
  const subscription = assessmentSubscriptionResource('bot-1');
  assert.equal(bot.publicWebhook, undefined);
  assert.match(subscription.criteria, /^QuestionnaireResponse\?/u);
  assert.equal(subscription.extension?.[0]?.valueCode, 'update');
  assert.match(code, /buildAssessmentBundle/u);
});
