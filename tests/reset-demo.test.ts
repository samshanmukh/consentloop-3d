import assert from 'node:assert/strict';
import test from 'node:test';
import type { Patient } from '@medplum/fhirtypes';
import { assertDemoResource, RESET_RESOURCE_TYPES } from '../packages/fhir/index.js';
import { DEMO_TAG, TAG_SYSTEM } from '../packages/shared/index.js';

test('reset accepts only identified resources with the exact synthetic tag', () => {
  const safe: Patient = { resourceType: 'Patient', id: 'patient-1', meta: { tag: [{ system: TAG_SYSTEM, code: DEMO_TAG }] } };
  const untagged: Patient = { resourceType: 'Patient', id: 'patient-1' };
  const unidentified: Patient = { resourceType: 'Patient', meta: safe.meta! };
  assert.doesNotThrow(() => assertDemoResource(safe));
  assert.throws(() => assertDemoResource(untagged), /Refusing to delete/u);
  assert.throws(() => assertDemoResource(unidentified), /Refusing to delete/u);
});

test('reset allowlist cannot remove automation infrastructure', () => {
  assert.equal(RESET_RESOURCE_TYPES.includes('Bot' as never), false);
  assert.equal(RESET_RESOURCE_TYPES.includes('Subscription' as never), false);
});
