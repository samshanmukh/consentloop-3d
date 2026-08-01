import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultComprehensionConcepts,
  initialConsentWorkflow,
  transitionConsentWorkflow,
  workflowBlockers,
  type ComprehensionConcept,
} from '../packages/shared/index.js';

const patient = 'Patient/patient-1';
const version = 'a'.repeat(64);

function understood(): ComprehensionConcept[] {
  return defaultComprehensionConcepts().map((concept) => ({ ...concept, status: 'understood' as const }));
}

test('only activates consent after every critical concept is understood', () => {
  let state = initialConsentWorkflow(patient, version, defaultComprehensionConcepts());
  state = transitionConsentWorkflow(state, { type: 'begin-education' });
  assert.throws(() => transitionConsentWorkflow(state, { type: 'sign', patientReference: patient, signedAt: '2026-08-01T12:00:00.000Z' }), /blocked/u);
  state = transitionConsentWorkflow(state, { type: 'record-assessment', concepts: understood() });
  assert.equal(state.status, 'ready');
  state = transitionConsentWorkflow(state, { type: 'sign', patientReference: patient, signedAt: '2026-08-01T12:00:00.000Z' });
  assert.equal(state.status, 'completed');
  assert.equal(state.consentStatus, 'active');
});

test('contradictions, stale options, and open reviews block consent', () => {
  const concepts = understood();
  concepts[1] = { ...concepts[1]!, status: 'contradicted' };
  let state = initialConsentWorkflow(patient, version, concepts);
  state = transitionConsentWorkflow(state, { type: 'begin-education' });
  state = transitionConsentWorkflow(state, { type: 'mark-snapshot-stale' });
  state = transitionConsentWorkflow(state, { type: 'open-review', taskId: 'task-1' });
  assert.equal(state.status, 'review');
  assert.equal(workflowBlockers(state).length, 3);
  assert.throws(() => transitionConsentWorkflow(state, { type: 'resolve-review', taskId: 'task-1', actorReference: patient }), /clinical review/ui);
});

test('clinician review can clear blockers but patient identity is enforced at signature', () => {
  let state = initialConsentWorkflow(patient, version, understood());
  state = transitionConsentWorkflow(state, { type: 'begin-education' });
  state = transitionConsentWorkflow(state, { type: 'record-assessment', concepts: understood() });
  state = transitionConsentWorkflow(state, { type: 'open-review', taskId: 'task-1' });
  state = transitionConsentWorkflow(state, { type: 'resolve-review', taskId: 'task-1', actorReference: 'Practitioner/doctor-1' });
  assert.equal(state.status, 'ready');
  assert.throws(() => transitionConsentWorkflow(state, { type: 'sign', patientReference: 'Patient/other', signedAt: '2026-08-01T12:00:00.000Z' }), /Only the patient/u);
});

test('repeated events are no-ops and skipped or unauthorized transitions are rejected', () => {
  let state = initialConsentWorkflow(patient, version, defaultComprehensionConcepts());
  assert.throws(() => transitionConsentWorkflow(state, { type: 'sign', patientReference: patient, signedAt: '2026-08-01T12:00:00.000Z' }), /blocked/u);
  state = transitionConsentWorkflow(state, { type: 'begin-education' });
  const first = transitionConsentWorkflow(state, { type: 'open-review', taskId: 'task-1' });
  const repeated = transitionConsentWorkflow(first, { type: 'open-review', taskId: 'task-1' });
  assert.deepEqual(repeated, first);
  assert.throws(() => transitionConsentWorkflow(first, { type: 'review-snapshot', snapshotVersion: version, actorReference: patient }), /Clinical review/u);
});
