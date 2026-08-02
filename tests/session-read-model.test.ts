import assert from 'node:assert/strict';
import test from 'node:test';
import type { Consent, DiagnosticReport, Provenance, QuestionnaireResponse, ServiceRequest, Task } from '@medplum/fhirtypes';
import {
  buildOptionCarePlan,
  buildOptionCatalog,
  buildSessionReadModel,
  clinicianDemoAccessPolicy,
  optionSnapshotIsStale,
  patientSessionAccessPolicy,
  readOptionSnapshot,
  SessionForbiddenError,
  type SessionResources,
} from '../packages/fhir/index.js';
import {
  canonicalJson,
  defaultComprehensionConcepts,
  initialConsentWorkflow,
  WORKFLOW_EXTENSION_URL,
} from '../packages/shared/index.js';
import { stringExtension } from '../packages/fhir/extensions.js';

function resources(): SessionResources {
  const catalog = { ...buildOptionCatalog(), id: 'catalog-1' };
  const carePlan = {
    ...buildOptionCarePlan({
      patientId: 'patient-1', serviceRequestId: 'request-1', authorReference: 'Practitioner/doctor-1',
      diagnosticReferences: ['DiagnosticReport/mri-1'], diagnosticVersions: { 'DiagnosticReport/mri-1': '4' },
      catalog, decisions: {
        'regenerative-specialist-review': { clinicalStatus: 'needs-specialist-review', availability: 'referral-available' },
      }, createdAt: '2026-08-01T12:00:00.000Z',
    }), id: 'care-plan-1',
  };
  const state = initialConsentWorkflow('Patient/patient-1', readOptionSnapshot(carePlan).snapshotVersion, defaultComprehensionConcepts());
  const request: ServiceRequest & { id: string } = {
    resourceType: 'ServiceRequest', id: 'request-1', status: 'active', intent: 'order',
    subject: { reference: 'Patient/patient-1' }, code: { text: 'Knee arthroscopy review' },
  };
  const educationTask: Task & { id: string } = { resourceType: 'Task', id: 'task-1', status: 'in-progress', intent: 'plan' };
  const consent: Consent & { id: string } = {
    resourceType: 'Consent', id: 'consent-1', status: 'draft', scope: { text: 'treatment' }, category: [{ text: 'consent' }],
    extension: [stringExtension(WORKFLOW_EXTENSION_URL, canonicalJson(state))],
  };
  const response: QuestionnaireResponse & { id: string } = { resourceType: 'QuestionnaireResponse', id: 'response-1', status: 'in-progress' };
  const diagnostic: DiagnosticReport & { id: string } = {
    resourceType: 'DiagnosticReport', id: 'mri-1', meta: { versionId: '4' }, status: 'final', code: { text: 'MRI' },
    conclusion: 'Synthetic complex meniscal tear.',
  };
  const provenance: Provenance & { id: string } = {
    resourceType: 'Provenance', id: 'provenance-1', target: [{ reference: 'CarePlan/care-plan-1' }],
    recorded: '2026-08-01T12:00:01.000Z', agent: [{ who: { reference: 'Bot/prepare-1' } }],
    activity: { coding: [{ code: 'prepare-consent' }] },
  };
  return { serviceRequest: request, carePlan, educationTask, consent, response, diagnostics: [diagnostic], reviewTasks: [], provenance: [provenance], catalog };
}

test('returns a patient-safe session while reserving raw resources for clinicians', () => {
  const session = resources();
  const patient = buildSessionReadModel(session, { role: 'patient', patientId: 'patient-1' });
  const clinician = buildSessionReadModel(session, { role: 'clinician' });
  assert.equal(patient.options.length, 4);
  assert.equal(patient.options.find((option) => option.id === 'regenerative-specialist-review')?.availability, 'referral-available');
  assert.equal(patient.diagnosticSummaries[0]?.conclusion, 'Synthetic complex meniscal tear.');
  assert.equal(patient.resources, undefined);
  assert.ok(clinician.resources && clinician.resources.length > 0);
  assert.throws(() => buildSessionReadModel(session, { role: 'patient', patientId: 'other' }), SessionForbiddenError);
});

test('detects catalog, diagnostic, and snapshot version changes', () => {
  const session = resources();
  const snapshot = readOptionSnapshot(session.carePlan);
  const state = initialConsentWorkflow('Patient/patient-1', snapshot.snapshotVersion, defaultComprehensionConcepts());
  assert.equal(optionSnapshotIsStale(snapshot, state, session.diagnostics, session.catalog), false);
  const changedDiagnostic = [{ ...session.diagnostics[0]!, meta: { versionId: '5' } }];
  const changedCatalog = structuredClone(session.catalog!);
  changedCatalog.version = '99.0.0';
  assert.equal(optionSnapshotIsStale(snapshot, state, changedDiagnostic, session.catalog), true);
  assert.equal(optionSnapshotIsStale(snapshot, state, [{ ...session.diagnostics[0]!, conclusion: 'Cosmetic wording change.' }], session.catalog), false);
  assert.equal(optionSnapshotIsStale(snapshot, state, session.diagnostics, changedCatalog), true);
  assert.equal(optionSnapshotIsStale(snapshot, { ...state, optionSnapshotVersion: 'b'.repeat(64) }, session.diagnostics, session.catalog), true);
});

test('access policies are read-only and patient-scoped', () => {
  const patient = patientSessionAccessPolicy('patient-1');
  const clinician = clinicianDemoAccessPolicy();
  assert.equal(patient.compartment?.reference, 'Patient/patient-1');
  assert.ok(patient.resource?.every((rule) => !rule.interaction?.some((interaction) => ['create', 'update', 'delete'].includes(interaction))));
  assert.ok(patient.resource?.some((rule) => rule.criteria?.includes('Patient/patient-1')));
  assert.ok(patient.resource?.filter((rule) => rule.criteria).every((rule) => rule.criteria?.startsWith(`${rule.resourceType}?`)));
  assert.ok(clinician.resource?.every((rule) => rule.criteria?.includes('synthetic-demo')));
  assert.ok(clinician.resource?.every((rule) => rule.criteria?.startsWith(`${rule.resourceType}?`)));
});
