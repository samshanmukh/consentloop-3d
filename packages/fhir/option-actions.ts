import type { Bundle, BundleEntry, CarePlan, Consent, Provenance, Resource, Task } from '@medplum/fhirtypes';
import {
  demoTag,
  deterministicUuid,
  FHIR_BASE,
  IDENTIFIER_SYSTEM,
  REVIEW_QUESTION_EXTENSION_URL,
  SESSION_KEY_EXTENSION_URL,
  TAG_SYSTEM,
  WORKFLOW_EXTENSION_URL,
  canonicalJson,
  consentWorkflowSchema,
  transitionConsentWorkflow,
  type OptionQuestion,
  type OptionSnapshot,
} from '../shared/index.js';
import { getStringExtension, replaceStringExtension, stringExtension } from './extensions.js';
import { readOptionSnapshot, writeOptionSnapshot } from './option-snapshot.js';

export interface PreferenceInput {
  optionId: string;
  status: 'preferred' | 'not-preferred' | 'unsure';
  reason: string;
  patientReference: string;
  now: string;
}

export interface ReviewRequestInput {
  optionId: string;
  kind: 'question' | 'second-opinion' | 'referral';
  question: string;
  patientReference: string;
  now: string;
}

export interface ReviewResolutionInput {
  questionId: string;
  response: string;
  clinicianReference: string;
  now: string;
}

function requireText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function requirePatient(snapshot: OptionSnapshot, reference: string): void {
  if (reference !== `Patient/${snapshot.patientId}`) throw new Error('Patient cannot update another patient\'s options');
}

function requireVersioned<T extends Resource>(resource: T): T & { id: string; meta: { versionId: string } } {
  if (!resource.id || !resource.meta?.versionId) throw new Error(`${resource.resourceType} id and version are required`);
  return resource as T & { id: string; meta: { versionId: string } };
}

function updateOption(snapshot: OptionSnapshot, optionId: string, update: (option: OptionSnapshot['options'][number]) => OptionSnapshot['options'][number]): OptionSnapshot {
  let found = false;
  const options = snapshot.options.map((option) => {
    if (option.id !== optionId) return option;
    found = true;
    return update(option);
  });
  if (!found) throw new Error(`Unknown treatment option: ${optionId}`);
  return { ...snapshot, options };
}

export function recordOptionPreference(carePlan: CarePlan, input: PreferenceInput): CarePlan {
  const snapshot = readOptionSnapshot(carePlan);
  requirePatient(snapshot, input.patientReference);
  const updated = updateOption(snapshot, input.optionId, (option) => ({
    ...option,
    preference: {
      status: input.status,
      reason: requireText(input.reason, 'Preference reason'),
      recordedBy: input.patientReference,
      recordedAt: input.now,
    },
  }));
  return writeOptionSnapshot(carePlan, updated);
}

function questionId(snapshot: OptionSnapshot, input: ReviewRequestInput): string {
  const material = [snapshot.serviceRequestId, input.optionId, input.kind, input.question.trim(), input.patientReference].join('|');
  return deterministicUuid(material);
}

export function recordReviewRequest(carePlan: CarePlan, input: ReviewRequestInput): { carePlan: CarePlan; question: OptionQuestion; created: boolean } {
  const snapshot = readOptionSnapshot(carePlan);
  requirePatient(snapshot, input.patientReference);
  const id = questionId(snapshot, input);
  let question: OptionQuestion | undefined;
  let created = false;
  const updated = updateOption(snapshot, input.optionId, (option) => {
    question = option.questions?.find((candidate) => candidate.id === id) ?? {
      id,
      kind: input.kind,
      text: requireText(input.question, 'Question'),
      status: 'open',
      requestedBy: input.patientReference,
      createdAt: input.now,
    };
    if (option.questions?.some((candidate) => candidate.id === id)) return option;
    created = true;
    return { ...option, questions: [...(option.questions ?? []), question] };
  });
  if (!question) throw new Error('Question could not be recorded');
  return { carePlan: writeOptionSnapshot(carePlan, updated), question, created };
}

function reviewTask(snapshot: OptionSnapshot, carePlanId: string, optionId: string, question: OptionQuestion): Task {
  const identifier = `option-review:${question.id}`;
  return {
    resourceType: 'Task',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: identifier }],
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: `${FHIR_BASE}/CodeSystem/tasks`, code: question.kind }] },
    description: question.text,
    basedOn: [{ reference: `ServiceRequest/${snapshot.serviceRequestId}` }],
    focus: { reference: `CarePlan/${carePlanId}` },
    for: { reference: `Patient/${snapshot.patientId}` },
    requester: { reference: question.requestedBy },
    authoredOn: question.createdAt,
    lastModified: question.createdAt,
    meta: { tag: [demoTag()] },
    extension: [
      stringExtension(REVIEW_QUESTION_EXTENSION_URL, question.id),
      stringExtension(SESSION_KEY_EXTENSION_URL, `prepare:${snapshot.serviceRequestId}`),
    ],
  };
}

function transactionPut(resource: Resource & { id: string; meta: { versionId: string } }): BundleEntry {
  return { resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}`, ifMatch: `W/\"${resource.meta.versionId}\"` } };
}

function conditionalPost(resource: Resource, key: string, fullUrl?: string): BundleEntry {
  return {
    ...(fullUrl ? { fullUrl } : {}),
    resource,
    request: { method: 'POST', url: resource.resourceType, ifNoneExist: new URLSearchParams({ identifier: `${IDENTIFIER_SYSTEM}|${key}` }).toString() },
  };
}

function provenance(targets: string[], actor: string, action: string, key: string, now: string): Provenance {
  return {
    resourceType: 'Provenance',
    meta: { tag: [demoTag(), { system: TAG_SYSTEM, code: key }] },
    target: targets.map((reference) => ({ reference })),
    recorded: now,
    activity: { coding: [{ system: `${FHIR_BASE}/CodeSystem/provenance-activity`, code: action }] },
    agent: [{ who: { reference: actor } }],
  };
}

function provenanceEntry(resource: Provenance, key: string): BundleEntry {
  return { resource, request: { method: 'POST', url: 'Provenance', ifNoneExist: new URLSearchParams({ _tag: `${TAG_SYSTEM}|${key}` }).toString() } };
}

export function buildPreferenceBundle(carePlan: CarePlan, input: PreferenceInput): Bundle {
  const current = requireVersioned(carePlan);
  const updated = requireVersioned(recordOptionPreference(current, input));
  const key = `preference:${readOptionSnapshot(updated).serviceRequestId}:${input.optionId}:${updated.meta.versionId}`;
  return {
    resourceType: 'Bundle', type: 'transaction',
    entry: [transactionPut(updated), provenanceEntry(provenance([`CarePlan/${updated.id}`], input.patientReference, 'record-option-preference', key, input.now), key)],
  };
}

function updateReviewWorkflow(consent: Consent, taskId: string, action: 'open' | 'resolve', actorReference?: string): Consent {
  const current = getStringExtension(consent.extension, WORKFLOW_EXTENSION_URL);
  if (!current) throw new Error('Consent has no ConsentLoop workflow');
  const state = consentWorkflowSchema.parse(JSON.parse(current));
  const workflow = action === 'open'
    ? transitionConsentWorkflow(state, { type: 'open-review', taskId })
    : transitionConsentWorkflow(state, { type: 'resolve-review', taskId, actorReference: actorReference ?? '' });
  return {
    ...structuredClone(consent), status: 'draft',
    extension: replaceStringExtension(consent.extension, WORKFLOW_EXTENSION_URL, canonicalJson(workflow)),
  };
}

export function buildReviewRequestBundle(carePlan: CarePlan, consent: Consent, input: ReviewRequestInput): Bundle {
  const current = requireVersioned(carePlan);
  const currentConsent = requireVersioned(consent);
  const result = recordReviewRequest(current, input);
  const updated = requireVersioned(result.carePlan);
  const task = reviewTask(readOptionSnapshot(updated), updated.id, input.optionId, result.question);
  const taskKey = `option-review:${result.question.id}`;
  const taskUrl = `urn:uuid:${deterministicUuid(taskKey)}`;
  const auditKey = `request:${taskKey}`;
  const updatedConsent = requireVersioned(updateReviewWorkflow(currentConsent, taskKey, 'open'));
  if (!result.created) {
    return {
      resourceType: 'Bundle', type: 'transaction',
      entry: [
        conditionalPost(task, taskKey, taskUrl),
        provenanceEntry(provenance([`CarePlan/${updated.id}`, `Consent/${updatedConsent.id}`, taskUrl], input.patientReference, 'request-option-review', auditKey, input.now), auditKey),
      ],
    };
  }
  return {
    resourceType: 'Bundle', type: 'transaction',
    entry: [
      transactionPut(updated),
      transactionPut(updatedConsent),
      conditionalPost(task, taskKey, taskUrl),
      provenanceEntry(provenance([`CarePlan/${updated.id}`, `Consent/${updatedConsent.id}`, taskUrl], input.patientReference, 'request-option-review', auditKey, input.now), auditKey),
    ],
  };
}

function isClinician(reference: string): boolean {
  return /^(Practitioner|PractitionerRole)\/[A-Za-z0-9.-]+$/u.test(reference);
}

function resolveQuestion(snapshot: OptionSnapshot, input: ReviewResolutionInput): OptionSnapshot {
  let found = false;
  const options = snapshot.options.map((option) => ({
    ...option,
    questions: option.questions?.map((question) => {
      if (question.id !== input.questionId) return question;
      found = true;
      if (question.status === 'resolved') return question;
      return { ...question, status: 'resolved' as const, resolvedBy: input.clinicianReference, resolvedAt: input.now, response: requireText(input.response, 'Response') };
    }),
  }));
  if (!found) throw new Error(`Unknown option question: ${input.questionId}`);
  return { ...snapshot, options };
}

export function buildReviewResolutionBundle(carePlan: CarePlan, consent: Consent, task: Task, input: ReviewResolutionInput): Bundle {
  if (!isClinician(input.clinicianReference)) throw new Error('Only a clinician can resolve an option review');
  const currentCarePlan = requireVersioned(carePlan);
  const currentTask = requireVersioned(task);
  const currentConsent = requireVersioned(consent);
  if (getStringExtension(currentTask.extension, REVIEW_QUESTION_EXTENSION_URL) !== input.questionId) throw new Error('Review Task does not match the option question');
  if (!['requested', 'received', 'accepted', 'in-progress'].includes(currentTask.status)) throw new Error('Review Task is not open');
  const snapshot = resolveQuestion(readOptionSnapshot(currentCarePlan), input);
  const updatedCarePlan = requireVersioned(writeOptionSnapshot(currentCarePlan, snapshot));
  const updatedTask: typeof currentTask = {
    ...currentTask,
    status: 'completed',
    owner: { reference: input.clinicianReference },
    lastModified: input.now,
    output: [{ type: { text: 'Clinical response' }, valueString: requireText(input.response, 'Response') }],
  };
  const key = `resolve:option-review:${input.questionId}`;
  const taskKey = `option-review:${input.questionId}`;
  const updatedConsent = requireVersioned(updateReviewWorkflow(currentConsent, taskKey, 'resolve', input.clinicianReference));
  return {
    resourceType: 'Bundle', type: 'transaction',
    entry: [
      transactionPut(updatedCarePlan),
      transactionPut(updatedConsent),
      transactionPut(updatedTask),
      provenanceEntry(provenance([`CarePlan/${updatedCarePlan.id}`, `Consent/${updatedConsent.id}`, `Task/${updatedTask.id}`], input.clinicianReference, 'resolve-option-review', key, input.now), key),
    ],
  };
}
