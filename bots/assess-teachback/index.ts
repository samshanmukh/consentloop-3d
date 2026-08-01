import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry, CarePlan, Consent, Provenance, QuestionnaireResponse, Resource, Task } from '@medplum/fhirtypes';
import {
  canonicalJson,
  consentWorkflowSchema,
  defaultComprehensionConcepts,
  demoTag,
  deterministicUuid,
  FHIR_BASE,
  IDENTIFIER_SYSTEM,
  SESSION_KEY_EXTENSION_URL,
  TAG_SYSTEM,
  teachBackResultSchema,
  transitionConsentWorkflow,
  WORKFLOW_EXTENSION_URL,
  type ConsentWorkflow,
  type TeachBackResult,
} from '../../packages/shared/index.js';
import { getStringExtension, replaceStringExtension, stringExtension } from '../../packages/fhir/extensions.js';
import { identifierQuery, type Identified } from '../../packages/fhir/index.js';

export interface AssessmentInput {
  response: Identified<QuestionnaireResponse>;
  educationTask: Identified<Task>;
  consent: Identified<Consent>;
  carePlan: Identified<CarePlan>;
  botReference: string;
  now: string;
}

function sessionRequestId(response: QuestionnaireResponse): string {
  const reference = response.basedOn?.find((item) => item.reference?.startsWith('ServiceRequest/'))?.reference;
  if (!reference) throw new Error('QuestionnaireResponse must be based on a ServiceRequest');
  return reference.slice('ServiceRequest/'.length);
}

export function validateAssessmentResponse(response: QuestionnaireResponse): asserts response is Identified<QuestionnaireResponse> {
  const tagged = response.meta?.tag?.some((tag) => tag.system === TAG_SYSTEM && tag.code === 'synthetic-demo');
  const patientAuthored = response.source?.reference?.startsWith('Patient/');
  const sessionKey = getStringExtension(response.extension, SESSION_KEY_EXTENSION_URL);
  if (!response.id || !response.meta?.versionId || !['completed', 'amended'].includes(response.status) || !tagged || !patientAuthored || !sessionKey?.startsWith('prepare:')) {
    throw new Error('QuestionnaireResponse is not an eligible completed ConsentLoop response');
  }
  sessionRequestId(response);
}

export function readTeachBackResults(response: QuestionnaireResponse): TeachBackResult[] {
  const expected = new Set(defaultComprehensionConcepts().map((concept) => concept.id));
  const results = (response.item ?? []).map((item) => {
    if (!item.linkId || !expected.has(item.linkId)) throw new Error(`Unexpected teach-back concept: ${item.linkId ?? 'missing'}`);
    const encoded = item.answer?.[0]?.valueString;
    if (!encoded) throw new Error(`Teach-back result is missing for ${item.linkId}`);
    const result = teachBackResultSchema.parse(JSON.parse(encoded));
    if (result.conceptId !== item.linkId) throw new Error(`Teach-back concept mismatch for ${item.linkId}`);
    return result;
  });
  if (results.length !== expected.size || new Set(results.map((result) => result.conceptId)).size !== expected.size) {
    throw new Error('A completed response requires one result for every comprehension concept');
  }
  return results;
}

function currentWorkflow(consent: Consent): ConsentWorkflow {
  const encoded = getStringExtension(consent.extension, WORKFLOW_EXTENSION_URL);
  if (!encoded) throw new Error('Consent has no ConsentLoop workflow');
  return consentWorkflowSchema.parse(JSON.parse(encoded));
}

function assessedWorkflow(consent: Consent, results: TeachBackResult[], escalationIds: string[]): ConsentWorkflow {
  const existing = currentWorkflow(consent);
  const concepts = defaultComprehensionConcepts().map((concept) => {
    const result = results.find((candidate) => candidate.conceptId === concept.id);
    if (!result) throw new Error(`Missing result for ${concept.id}`);
    return { ...concept, status: result.status };
  });
  let workflow = transitionConsentWorkflow(existing, { type: 'begin-education' });
  workflow = transitionConsentWorkflow(workflow, { type: 'record-assessment', concepts });
  for (const taskId of escalationIds) workflow = transitionConsentWorkflow(workflow, { type: 'open-review', taskId });
  return workflow;
}

function escalationRequired(result: TeachBackResult): boolean {
  return result.requiresClinician || result.status === 'contradicted' || result.status === 'uncertain';
}

function escalationTask(input: AssessmentInput, results: TeachBackResult[], id: string): Task {
  const requestId = sessionRequestId(input.response);
  if (!input.response.subject) throw new Error('QuestionnaireResponse subject is required');
  const contradictory = results.some((result) => result.status === 'contradicted');
  return {
    resourceType: 'Task',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: id }],
    status: 'requested', intent: 'order', priority: contradictory ? 'urgent' : 'routine',
    code: { coding: [{ system: `${FHIR_BASE}/CodeSystem/tasks`, code: 'comprehension-review' }] },
    description: results.map((result) => `${result.conceptId}: ${result.misconception ?? result.evidence}`).join('\n'),
    basedOn: [{ reference: `ServiceRequest/${requestId}` }],
    focus: { reference: `QuestionnaireResponse/${input.response.id}` },
    for: input.response.subject,
    requester: { reference: input.botReference },
    authoredOn: input.now,
    lastModified: input.now,
    meta: { tag: [demoTag()] },
    extension: [stringExtension(SESSION_KEY_EXTENSION_URL, `prepare:${requestId}`)],
  };
}

function versionedPut(resource: Resource): BundleEntry {
  if (!resource.id || !resource.meta?.versionId) throw new Error(`${resource.resourceType} id and version are required`);
  return { resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}`, ifMatch: `W/\"${resource.meta.versionId}\"` } };
}

function audit(input: AssessmentInput, targets: string[]): BundleEntry {
  const key = assessmentKey(input.response);
  return {
    resource: {
      resourceType: 'Provenance', meta: { tag: [demoTag(), { system: TAG_SYSTEM, code: key }] },
      target: targets.map((reference) => ({ reference })), recorded: input.now,
      activity: { coding: [{ system: `${FHIR_BASE}/CodeSystem/provenance-activity`, code: 'assess-teachback' }] },
      agent: [{ who: { reference: input.botReference } }],
      entity: [{ role: 'source', what: { reference: `QuestionnaireResponse/${input.response.id}` } }],
    },
    request: { method: 'POST', url: 'Provenance', ifNoneExist: new URLSearchParams({ _tag: `${TAG_SYSTEM}|${key}` }).toString() },
  };
}

function assessmentKey(response: Identified<QuestionnaireResponse>): string {
  return `assessment:${response.id}:${response.meta?.versionId ?? 'unknown'}`;
}

export function buildAssessmentBundle(input: AssessmentInput): Bundle {
  validateAssessmentResponse(input.response);
  const results = readTeachBackResults(input.response);
  const escalatedResults = results.filter(escalationRequired);
  const escalations = escalatedResults.length > 0 ? [{ results: escalatedResults, id: `comprehension-review:${input.response.id}` }] : [];
  const workflow = assessedWorkflow(input.consent, results, escalations.map(({ id }) => id));
  const consent: Consent = {
    ...structuredClone(input.consent), status: 'draft',
    extension: replaceStringExtension(input.consent.extension, WORKFLOW_EXTENSION_URL, canonicalJson(workflow)),
  };
  const task: Task = {
    ...structuredClone(input.educationTask),
    status: workflow.status === 'ready' ? 'completed' : workflow.status === 'review' ? 'on-hold' : 'in-progress',
    lastModified: input.now,
  };
  const taskEntries: BundleEntry[] = escalations.map(({ results: taskResults, id }) => ({
    fullUrl: `urn:uuid:${deterministicUuid(id)}`,
    resource: escalationTask(input, taskResults, id),
    request: { method: 'POST', url: 'Task', ifNoneExist: identifierQuery(id) },
  }));
  const targets = [`Consent/${consent.id}`, `Task/${task.id}`, ...taskEntries.map((entry) => entry.fullUrl as string)];
  return { resourceType: 'Bundle', type: 'transaction', entry: [versionedPut(consent), versionedPut(task), ...taskEntries, audit(input, targets)] };
}

async function loadInput(medplum: MedplumClient, response: Identified<QuestionnaireResponse>, event: BotEvent<QuestionnaireResponse>): Promise<AssessmentInput> {
  const requestId = sessionRequestId(response);
  const [educationTask, consent, carePlan] = await Promise.all([
    medplum.searchOne('Task', identifierQuery(`task:${requestId}`)),
    medplum.searchOne('Consent', identifierQuery(`consent:${requestId}`)),
    medplum.searchOne('CarePlan', identifierQuery(`options:${requestId}`)),
  ]);
  if (!educationTask || !consent || !carePlan) throw new Error('Prepared consent session resources are required');
  return { response, educationTask, consent, carePlan, botReference: event.bot.reference ?? 'Bot/assess-teachback', now: new Date().toISOString() };
}

export async function handler(medplum: MedplumClient, event: BotEvent<QuestionnaireResponse>): Promise<{ status: ConsentWorkflow['status'] }> {
  validateAssessmentResponse(event.input);
  const input = await loadInput(medplum, event.input, event);
  const alreadyProcessed = await medplum.searchOne(
    'Provenance',
    new URLSearchParams({ _tag: `${TAG_SYSTEM}|${assessmentKey(input.response)}` }).toString(),
  );
  if (alreadyProcessed) return { status: currentWorkflow(input.consent).status };
  const bundle = buildAssessmentBundle(input);
  await medplum.executeBatch(bundle);
  const consent = bundle.entry?.[0]?.resource as Consent;
  return { status: currentWorkflow(consent).status };
}
