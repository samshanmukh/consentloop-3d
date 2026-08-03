import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consentSessionSchema,
  evidenceSourceSchema,
  treatmentOptionSchema,
  type ConsentSession,
} from '../packages/shared/index.js';
import { aaosEvidence, rehabPatientOption } from './fixtures.js';

test('parses a complete option-bearing consent session', () => {
  const session: ConsentSession = {
    patientId: 'patient-1',
    serviceRequestId: 'request-1',
    taskId: 'task-1',
    consentId: 'consent-1',
    questionnaireResponseId: 'response-1',
    carePlanId: 'care-plan-1',
    procedureCode: 'knee-arthroscopy',
    status: 'educating',
    optionSnapshot: {
      id: 'snapshot-1',
      patientId: 'patient-1',
      serviceRequestId: 'request-1',
      catalogVersion: '1.0.0',
      snapshotVersion: 'a'.repeat(64),
      createdAt: '2026-08-01T12:00:00.000Z',
      diagnosticReferences: ['DiagnosticReport/mri-1'],
      sourceCoverage: 'Meniscal treatment paths reviewed for the India demo.',
      options: [rehabPatientOption],
    },
  };

  assert.deepEqual(consentSessionSchema.parse(session), session);
});

test('rejects malformed evidence and excluded options without decisions', () => {
  assert.throws(() => evidenceSourceSchema.parse({ ...aaosEvidence, reviewedAt: 'yesterday' }));
  assert.throws(() =>
    treatmentOptionSchema.parse({ ...rehabPatientOption, clinicalStatus: 'not-appropriate' }),
  );
});

test('rejects research-only options presented as clinically appropriate', () => {
  assert.throws(() =>
    treatmentOptionSchema.parse({ ...rehabPatientOption, availability: 'research-only' }),
  );
});
