import assert from 'node:assert/strict';
import test from 'node:test';
import type { Resource } from '@medplum/fhirtypes';
import { seedDemo, type FhirWriter, type Identified } from '../packages/fhir/index.js';

class MemoryWriter implements FhirWriter {
  readonly resources = new Map<string, Identified<Resource>>();

  async upsertResource<T extends Resource>(resource: T, query: string): Promise<Identified<T>> {
    const key = `${resource.resourceType}?${query}`;
    const existing = this.resources.get(key);
    const saved = { ...structuredClone(resource), id: existing?.id ?? `id-${this.resources.size + 1}` } as Identified<T>;
    this.resources.set(key, saved);
    return structuredClone(saved);
  }
}

test('seeds the complete synthetic journey idempotently', async () => {
  const writer = new MemoryWriter();
  const first = await seedDemo(writer);
  const second = await seedDemo(writer);

  assert.equal(writer.resources.size, 13);
  assert.equal(first.patient.id, second.patient.id);
  assert.equal(first.serviceRequest.id, second.serviceRequest.id);
  assert.equal(first.patientAccessPolicy.id, second.patientAccessPolicy.id);
  assert.equal(first.clinicianAccessPolicy.id, second.clinicianAccessPolicy.id);
  assert.match(first.xray.conclusion ?? '', /No radiographic finding explains/u);
  assert.match(first.mri.conclusion ?? '', /complex irregular meniscal tear/u);
  assert.match(first.mriStudy.description ?? '', /No real scan/u);
  assert.equal(first.serviceRequest.reasonReference?.[0]?.reference, `DiagnosticReport/${first.mri.id}`);
  assert.equal(first.catalog.action?.length, 4);
});

test('contains no user identity or raw image payload', async () => {
  const seeded = await seedDemo(new MemoryWriter());
  const serialized = JSON.stringify(seeded);

  assert.equal(seeded.patient.name?.[0]?.family, 'Demo');
  assert.equal(seeded.mriStudy.series, undefined);
  assert.doesNotMatch(serialized, /siddharth|real patient|pixel data/iu);
});
