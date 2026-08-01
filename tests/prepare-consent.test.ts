import assert from 'node:assert/strict';
import test from 'node:test';
import type { BundleEntry, CarePlan, Resource, ServiceRequest } from '@medplum/fhirtypes';
import { buildPreparationBundle, validatePreparationRequest } from '../bots/prepare-consent/index.js';
import {
  bundlePreparationBot,
  prepareBotResource,
  prepareSubscriptionResource,
  readOptionSnapshot,
  seedDemo,
  type FhirWriter,
  type Identified,
} from '../packages/fhir/index.js';

class MemoryWriter implements FhirWriter {
  private readonly resources = new Map<string, Identified<Resource>>();

  async upsertResource<T extends Resource>(resource: T, query: string): Promise<Identified<T>> {
    const key = `${resource.resourceType}?${query}`;
    const existing = this.resources.get(key);
    const saved = { ...structuredClone(resource), id: existing?.id ?? `id-${this.resources.size + 1}` } as Identified<T>;
    this.resources.set(key, saved);
    return structuredClone(saved);
  }
}

function resource<R extends Resource['resourceType']>(
  entry: BundleEntry | undefined,
  resourceType: R,
): Extract<Resource, { resourceType: R }> {
  assert.equal(entry?.resource?.resourceType, resourceType);
  return entry.resource as Extract<Resource, { resourceType: R }>;
}

test('builds one idempotent preparation transaction with all session resources', async () => {
  const seeded = await seedDemo(new MemoryWriter());
  const input = {
    request: seeded.serviceRequest,
    patient: seeded.patient,
    encounter: seeded.encounter,
    diagnostics: [seeded.mri],
    catalog: seeded.catalog,
    questionnaire: seeded.questionnaire,
    consentDocument: seeded.consentDocument,
    botReference: 'Bot/prepare-bot-1',
    now: '2026-08-01T12:00:00.000Z',
  };
  const first = buildPreparationBundle(input);
  const second = buildPreparationBundle(input);
  const entries = first.entry ?? [];
  const carePlan: CarePlan = resource(entries[0], 'CarePlan');

  assert.deepEqual(first, second);
  assert.equal(first.type, 'transaction');
  assert.deepEqual(entries.map((entry) => entry.resource?.resourceType), [
    'CarePlan',
    'Task',
    'Consent',
    'QuestionnaireResponse',
    'Device',
    'Provenance',
  ]);
  assert.ok(entries.every((entry) => entry.request?.method === 'POST' && entry.request.ifNoneExist));
  assert.equal(readOptionSnapshot(carePlan).options.length, 4);
  assert.equal(resource(entries[2], 'Consent').status, 'draft');
  assert.equal(resource(entries[3], 'QuestionnaireResponse').status, 'in-progress');
  assert.equal(resource(entries[5], 'Provenance').target.length, 4);
});

test('rejects unsupported or incomplete requests before creating a bundle', async () => {
  const seeded = await seedDemo(new MemoryWriter());
  const unsupported: ServiceRequest = {
    ...seeded.serviceRequest,
    code: { coding: [{ system: 'https://example.com', code: 'other-procedure' }] },
  };
  const missingDiagnostics: ServiceRequest = { ...seeded.serviceRequest, reasonReference: [] };

  assert.throws(() => validatePreparationRequest(unsupported), /not an eligible/u);
  assert.throws(() => validatePreparationRequest(missingDiagnostics), /diagnostic report/u);
});

test('builds deployable Bot code and a narrowly filtered Subscription', async () => {
  const bot = prepareBotResource();
  const subscription = prepareSubscriptionResource('bot-1');
  const code = await bundlePreparationBot();

  assert.equal(bot.publicWebhook, undefined);
  assert.equal(subscription.channel.endpoint, 'Bot/bot-1');
  assert.match(subscription.criteria, /^ServiceRequest\?/u);
  assert.match(decodeURIComponent(subscription.criteria), /synthetic-demo/u);
  assert.match(decodeURIComponent(subscription.criteria), /knee-arthroscopy/u);
  assert.match(code, /handler/u);
  assert.match(code, /buildPreparationBundle/u);
});
