import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOptionCarePlan,
  buildOptionCatalog,
  buildOptionSnapshot,
  readOptionSnapshot,
  type SnapshotInput,
} from '../packages/fhir/index.js';

function snapshotInput(): SnapshotInput {
  return {
    patientId: 'patient-1',
    serviceRequestId: 'request-1',
    encounterReference: 'Encounter/encounter-1',
    authorReference: 'Practitioner/practitioner-1',
    diagnosticReferences: ['DiagnosticReport/mri-1'],
    catalog: buildOptionCatalog(),
    createdAt: '2026-08-01T12:00:00.000Z',
    decisions: {
      'structured-rehabilitation': { clinicalStatus: 'appropriate', availability: 'available-here' },
      'meniscus-repair': { clinicalStatus: 'needs-specialist-review', availability: 'available-here' },
      'partial-meniscectomy': { clinicalStatus: 'needs-specialist-review', availability: 'available-here' },
      'regenerative-specialist-review': {
        clinicalStatus: 'needs-specialist-review',
        availability: 'referral-available',
      },
    },
  };
}

test('keeps every relevant option when one is unavailable locally', () => {
  const input = snapshotInput();
  const before = structuredClone(input);
  const snapshot = buildOptionSnapshot(input);
  const regenerative = snapshot.options.find((option) => option.id === 'regenerative-specialist-review');

  assert.equal(snapshot.options.length, 4);
  assert.equal(regenerative?.availability, 'referral-available');
  assert.equal(regenerative?.clinicalStatus, 'needs-specialist-review');
  assert.deepEqual(input, before);
});

test('defaults incomplete decisions instead of hiding options', () => {
  const snapshot = buildOptionSnapshot({ ...snapshotInput(), decisions: {} });

  assert.equal(snapshot.options.length, 4);
  assert.ok(snapshot.options.every((option) => option.clinicalStatus === 'insufficient-information'));
  assert.ok(snapshot.options.every((option) => option.availability === 'unknown'));
});

test('round-trips through a CarePlan and versions material changes', () => {
  const input = snapshotInput();
  const first = buildOptionCarePlan(input);
  const second = buildOptionCarePlan(input);
  const changed = buildOptionSnapshot({
    ...input,
    decisions: {
      ...input.decisions,
      'regenerative-specialist-review': { clinicalStatus: 'needs-specialist-review', availability: 'research-only' },
    },
  });

  assert.deepEqual(first, second);
  assert.deepEqual(readOptionSnapshot(first), buildOptionSnapshot(input));
  assert.notEqual(readOptionSnapshot(first).snapshotVersion, changed.snapshotVersion);
});

test('rejects an unsourced clinical exclusion', () => {
  const input = snapshotInput();
  assert.throws(() =>
    buildOptionSnapshot({
      ...input,
      decisions: {
        ...input.decisions,
        'meniscus-repair': { clinicalStatus: 'not-appropriate', availability: 'available-here' },
      },
    }),
  );
});
