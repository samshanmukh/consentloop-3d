import { randomUUID } from 'node:crypto';
import type { MedplumClient } from '@medplum/core';
import type { CarePlan, Consent, Provenance, QuestionnaireResponse, ServiceRequest, Task } from '@medplum/fhirtypes';
import { DEMO_TAG, IDENTIFIER_SYSTEM, TAG_SYSTEM } from '../shared/index.js';
import { identifierQuery, seedDemo } from './demo-resources.js';
import { readOptionSnapshot } from './option-snapshot.js';

interface SmokeResources {
  request: ServiceRequest & { id: string };
  task: Task & { id: string };
  consent: Consent & { id: string };
  response: QuestionnaireResponse & { id: string };
  carePlan: CarePlan & { id: string };
  provenance: Provenance & { id: string };
}

async function waitFor<T>(read: () => Promise<T | undefined>, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function runPreparationSmoke(medplum: MedplumClient): Promise<SmokeResources> {
  const seeded = await seedDemo(medplum);
  const template = seeded.serviceRequest;
  if (!template.code || !template.encounter || !template.requester || !template.reasonReference) {
    throw new Error('Seeded ServiceRequest is incomplete');
  }
  const runId = randomUUID();
  const smokeRequest: ServiceRequest = {
    resourceType: 'ServiceRequest',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: `smoke-service-request:${runId}` }],
    status: 'active',
    intent: 'order',
    code: template.code,
    subject: template.subject,
    encounter: template.encounter,
    authoredOn: new Date().toISOString(),
    requester: template.requester,
    reasonReference: template.reasonReference,
    note: [{ text: `ConsentLoop preparation smoke run ${runId}` }],
    meta: { tag: [{ system: TAG_SYSTEM, code: DEMO_TAG }] },
  };
  const request = await medplum.createResource(smokeRequest);
  const [task, consent, response, carePlan, provenance] = await Promise.all([
    waitFor(() => medplum.searchOne('Task', identifierQuery(`task:${request.id}`)), 'education Task'),
    waitFor(() => medplum.searchOne('Consent', identifierQuery(`consent:${request.id}`)), 'draft Consent'),
    waitFor(
      () => medplum.searchOne('QuestionnaireResponse', identifierQuery(`questionnaire-response:${request.id}`)),
      'QuestionnaireResponse',
    ),
    waitFor(() => medplum.searchOne('CarePlan', identifierQuery(`options:${request.id}`)), 'option CarePlan'),
    waitFor(
      () => medplum.searchOne('Provenance', new URLSearchParams({ _tag: `${TAG_SYSTEM}|prepare-provenance:${request.id}` }).toString()),
      'preparation Provenance',
    ),
  ]);
  if (task.status !== 'in-progress' || consent.status !== 'draft' || response.status !== 'in-progress') {
    throw new Error('Preparation resources have unexpected initial statuses');
  }
  if (readOptionSnapshot(carePlan).options.length !== 4 || provenance.target.length !== 4) {
    throw new Error('Preparation session is missing options or provenance targets');
  }
  return { request, task, consent, response, carePlan, provenance };
}
