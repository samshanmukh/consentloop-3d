import type { MedplumClient } from '@medplum/core';
import type {
  AccessPolicy,
  AuditEvent,
  CarePlan,
  Consent,
  DiagnosticReport,
  PlanDefinition,
  Provenance,
  QuestionnaireResponse,
  Resource,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import {
  consentWorkflowSchema,
  DEMO_TAG,
  IDENTIFIER_SYSTEM,
  OPTION_CATALOG_URL,
  TAG_SYSTEM,
  WORKFLOW_EXTENSION_URL,
  workflowBlockers,
  type ConsentEvent,
  type ConsentWorkflow,
  type OptionSnapshot,
} from '../shared/index.js';
import { getStringExtension } from './extensions.js';
import { readOptionSnapshot } from './option-snapshot.js';
import type { Identified } from './client.js';

export class SessionNotFoundError extends Error {}
export class SessionForbiddenError extends Error {}

function identifierQuery(value: string): string {
  return new URLSearchParams({ identifier: `${IDENTIFIER_SYSTEM}|${value}` }).toString();
}

export interface SessionResources {
  serviceRequest: Identified<ServiceRequest>;
  carePlan: Identified<CarePlan>;
  educationTask: Identified<Task>;
  consent: Identified<Consent>;
  response: Identified<QuestionnaireResponse>;
  diagnostics: Identified<DiagnosticReport>[];
  reviewTasks: Identified<Task>[];
  provenance: Identified<Provenance>[];
  auditEvents?: Identified<AuditEvent>[];
  catalog?: Identified<PlanDefinition>;
}

export interface SessionReadModel {
  patientId: string;
  serviceRequestId: string;
  procedure: string;
  status: ConsentWorkflow['status'];
  consentStatus: ConsentWorkflow['consentStatus'];
  stale: boolean;
  blockers: string[];
  options: OptionSnapshot['options'];
  comprehension: ConsentWorkflow['concepts'];
  diagnosticSummaries: { reference: string; conclusion: string }[];
  tasks: { id: string; status: Task['status']; description: string }[];
  events: ConsentEvent[];
  resourceIds: Record<string, string>;
  resources?: Resource[];
}

function workflow(consent: Consent): ConsentWorkflow {
  const encoded = getStringExtension(consent.extension, WORKFLOW_EXTENSION_URL);
  if (!encoded) throw new Error('Consent has no ConsentLoop workflow');
  return consentWorkflowSchema.parse(JSON.parse(encoded));
}

function patientId(request: ServiceRequest): string {
  const reference = request.subject?.reference;
  if (!reference?.startsWith('Patient/')) throw new Error('ServiceRequest patient reference is required');
  return reference.slice('Patient/'.length);
}

export function optionSnapshotIsStale(
  snapshot: OptionSnapshot,
  state: ConsentWorkflow,
  diagnostics: DiagnosticReport[],
  catalog?: PlanDefinition,
): boolean {
  if (state.optionSnapshotStale || state.optionSnapshotVersion !== snapshot.snapshotVersion) return true;
  if (catalog?.version && catalog.version !== snapshot.catalogVersion) return true;
  return diagnostics.some((report) => {
    const reference = report.id ? `DiagnosticReport/${report.id}` : '';
    const current = report.meta?.versionId ?? report.meta?.lastUpdated ?? 'unknown';
    return snapshot.diagnosticVersions?.[reference] !== undefined && snapshot.diagnosticVersions[reference] !== current;
  });
}

function event(resource: Identified<Provenance | AuditEvent>, includeRaw: boolean): ConsentEvent {
  const isProvenance = resource.resourceType === 'Provenance';
  const timestamp = isProvenance ? resource.recorded : resource.recorded;
  const action = isProvenance ? resource.activity?.coding?.[0]?.code : resource.action;
  const summary = isProvenance
    ? resource.reason?.[0]?.text ?? resource.activity?.coding?.[0]?.display
    : resource.outcomeDesc ?? resource.subtype?.[0]?.display;
  return {
    timestamp,
    resourceType: resource.resourceType,
    resourceId: resource.id,
    action: action ?? 'recorded',
    summary: summary ?? 'FHIR workflow event',
    resource: includeRaw
      ? structuredClone(resource) as unknown as Record<string, unknown>
      : { resourceType: resource.resourceType, id: resource.id, recorded: timestamp, action: action ?? 'recorded' },
  };
}

function resourceIds(resources: SessionResources): Record<string, string> {
  return {
    serviceRequest: `ServiceRequest/${resources.serviceRequest.id}`,
    carePlan: `CarePlan/${resources.carePlan.id}`,
    educationTask: `Task/${resources.educationTask.id}`,
    consent: `Consent/${resources.consent.id}`,
    questionnaireResponse: `QuestionnaireResponse/${resources.response.id}`,
  };
}

export function buildSessionReadModel(
  resources: SessionResources,
  viewer: { role: 'patient'; patientId: string } | { role: 'clinician' },
): SessionReadModel {
  const ownerId = patientId(resources.serviceRequest);
  if (viewer.role === 'patient' && viewer.patientId !== ownerId) throw new SessionForbiddenError('Patient cannot view another patient\'s session');
  const snapshot = readOptionSnapshot(resources.carePlan);
  const state = workflow(resources.consent);
  const stale = optionSnapshotIsStale(snapshot, state, resources.diagnostics, resources.catalog);
  const blockers = [...workflowBlockers(state), ...(stale && !state.optionSnapshotStale ? ['Treatment option snapshot is stale'] : [])];
  const result: SessionReadModel = {
    patientId: ownerId,
    serviceRequestId: resources.serviceRequest.id,
    procedure: resources.serviceRequest.code?.coding?.[0]?.display ?? resources.serviceRequest.code?.text ?? 'Procedure',
    status: stale && state.status !== 'completed' ? 'review' : state.status,
    consentStatus: state.consentStatus,
    stale,
    blockers,
    options: structuredClone(snapshot.options),
    comprehension: structuredClone(state.concepts),
    diagnosticSummaries: resources.diagnostics.map((report) => ({
      reference: `DiagnosticReport/${report.id}`,
      conclusion: report.conclusion ?? 'No conclusion recorded',
    })),
    tasks: [resources.educationTask, ...resources.reviewTasks].map((task) => ({
      id: task.id, status: task.status, description: task.description ?? task.code?.text ?? 'Clinical task',
    })),
    events: [...resources.provenance, ...(resources.auditEvents ?? [])]
      .map((item) => event(item, viewer.role === 'clinician'))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.resourceId.localeCompare(right.resourceId)),
    resourceIds: resourceIds(resources),
  };
  if (viewer.role === 'clinician') result.resources = structuredClone([
    resources.serviceRequest, resources.carePlan, resources.educationTask, resources.consent,
    resources.response, ...resources.diagnostics, ...resources.reviewTasks, ...resources.provenance, ...(resources.auditEvents ?? []),
  ]);
  return result;
}

async function required<T extends Resource>(promise: Promise<T | undefined>, label: string): Promise<T & { id: string }> {
  const resource = await promise;
  if (!resource?.id) throw new SessionNotFoundError(`${label} was not found`);
  return resource as T & { id: string };
}

async function collectSessionEvents(medplum: MedplumClient, serviceRequestId: string): Promise<{ reviewTasks: Identified<Task>[]; provenance: Identified<Provenance>[]; auditEvents: Identified<AuditEvent>[] }> {
  const taskQuery = new URLSearchParams({ basedon: `ServiceRequest/${serviceRequestId}`, _tag: `${TAG_SYSTEM}|${DEMO_TAG}`, _count: '100' });
  const provenanceQuery = new URLSearchParams({ _tag: `${TAG_SYSTEM}|${DEMO_TAG}`, _count: '100', _sort: 'recorded' });
  const auditQuery = new URLSearchParams({ entity: `ServiceRequest/${serviceRequestId}`, _count: '100', _sort: 'date' });
  const reviewTasks: Identified<Task>[] = [];
  const provenance: Identified<Provenance>[] = [];
  const auditEvents: Identified<AuditEvent>[] = [];
  for await (const page of medplum.searchResourcePages('Task', taskQuery)) reviewTasks.push(...page);
  for await (const page of medplum.searchResourcePages('Provenance', provenanceQuery)) provenance.push(...page);
  for await (const page of medplum.searchResourcePages('AuditEvent', auditQuery)) auditEvents.push(...page);
  return { reviewTasks, provenance, auditEvents };
}

async function serviceRequestIdFromReference(medplum: MedplumClient, reference: string): Promise<string> {
  if (reference.startsWith('ServiceRequest/')) return reference.slice('ServiceRequest/'.length);
  if (reference.startsWith('Task/')) {
    const task = await required(medplum.readResource('Task', reference.slice('Task/'.length)), 'Task');
    const basedOn = task.basedOn?.find((item) => item.reference?.startsWith('ServiceRequest/'))?.reference;
    if (!basedOn) throw new SessionNotFoundError('Task is not linked to a consent session');
    return basedOn.slice('ServiceRequest/'.length);
  }
  if (/^[A-Za-z0-9.-]+$/u.test(reference)) return reference;
  throw new SessionNotFoundError('Session reference is invalid');
}

async function loadSession(
  medplum: MedplumClient,
  serviceRequestId: string,
  viewer: { role: 'patient'; patientId: string } | { role: 'clinician' },
): Promise<SessionReadModel> {
  const request = await required(medplum.readResource('ServiceRequest', serviceRequestId), 'ServiceRequest');
  const requestPatientId = patientId(request);
  if (viewer.role === 'patient' && viewer.patientId !== requestPatientId) throw new SessionForbiddenError('Patient cannot view another patient\'s session');
  const [carePlan, educationTask, consent, response, catalog] = await Promise.all([
    required(medplum.searchOne('CarePlan', identifierQuery(`options:${serviceRequestId}`)), 'CarePlan'),
    required(medplum.searchOne('Task', identifierQuery(`task:${serviceRequestId}`)), 'education Task'),
    required(medplum.searchOne('Consent', identifierQuery(`consent:${serviceRequestId}`)), 'Consent'),
    required(medplum.searchOne('QuestionnaireResponse', identifierQuery(`questionnaire-response:${serviceRequestId}`)), 'QuestionnaireResponse'),
    medplum.searchOne('PlanDefinition', `url=${encodeURIComponent(OPTION_CATALOG_URL)}`),
  ]);
  const snapshot = readOptionSnapshot(carePlan);
  const diagnostics = await Promise.all(snapshot.diagnosticReferences.map(async (reference) => {
    const id = reference.slice('DiagnosticReport/'.length);
    return required(medplum.readResource('DiagnosticReport', id), reference);
  }));
  const { reviewTasks, provenance, auditEvents } = await collectSessionEvents(medplum, serviceRequestId);
  const sessionReferences = new Set([
    `ServiceRequest/${request.id}`, `CarePlan/${carePlan.id}`, `Task/${educationTask.id}`,
    `Consent/${consent.id}`, `QuestionnaireResponse/${response.id}`,
    ...reviewTasks.map((task) => `Task/${task.id}`),
  ]);
  const sessionProvenance = provenance.filter((item) =>
    item.target.some((target) => target.reference && sessionReferences.has(target.reference))
    || item.entity?.some((entity) => entity.what.reference && sessionReferences.has(entity.what.reference)),
  );
  return buildSessionReadModel({
    serviceRequest: request, carePlan, educationTask, consent, response, diagnostics,
    reviewTasks: reviewTasks.filter((task) => task.id !== educationTask.id) as Identified<Task>[],
    provenance: sessionProvenance,
    auditEvents,
    ...(catalog?.id ? { catalog: catalog as Identified<PlanDefinition> } : {}),
  }, viewer);
}

function forbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: number; statusCode?: number; response?: { status?: number } };
  return [401, 403].includes(candidate.status ?? candidate.statusCode ?? candidate.response?.status ?? 0);
}

export async function loadSessionReadModel(
  medplum: MedplumClient,
  sessionReference: string,
  viewer: { role: 'patient'; patientId: string } | { role: 'clinician' },
): Promise<SessionReadModel> {
  try {
    return await loadSession(medplum, await serviceRequestIdFromReference(medplum, sessionReference), viewer);
  } catch (error) {
    if (error instanceof SessionForbiddenError || error instanceof SessionNotFoundError) throw error;
    if (forbidden(error)) throw new SessionForbiddenError('Session access denied');
    throw error;
  }
}

const READ_INTERACTIONS = ['read', 'vread', 'history', 'search'] as const;

export function patientSessionAccessPolicy(patientId: string): AccessPolicy {
  if (!/^[A-Za-z0-9.-]+$/u.test(patientId)) throw new Error('Invalid patient id');
  const patient = `Patient/${patientId}`;
  return {
    resourceType: 'AccessPolicy', name: `ConsentLoop patient session ${patientId}`,
    compartment: { reference: patient }, meta: { tag: [{ system: TAG_SYSTEM, code: DEMO_TAG }] },
    resource: [
      { resourceType: 'Patient', criteria: `_id=${patientId}`, interaction: READ_INTERACTIONS.slice() },
      ...['ServiceRequest', 'CarePlan', 'DiagnosticReport', 'QuestionnaireResponse'].map((resourceType) => ({ resourceType, criteria: `subject=${patient}`, interaction: READ_INTERACTIONS.slice() })),
      { resourceType: 'Consent', criteria: `patient=${patient}`, interaction: READ_INTERACTIONS.slice() },
      { resourceType: 'Task', criteria: `patient=${patient}`, interaction: READ_INTERACTIONS.slice() },
      { resourceType: 'Questionnaire', interaction: READ_INTERACTIONS.slice() },
      { resourceType: 'PlanDefinition', criteria: `url=${encodeURIComponent(OPTION_CATALOG_URL)}`, interaction: READ_INTERACTIONS.slice() },
    ],
  };
}

export function clinicianDemoAccessPolicy(): AccessPolicy {
  return {
    resourceType: 'AccessPolicy', name: 'ConsentLoop synthetic-demo clinician',
    meta: { tag: [{ system: TAG_SYSTEM, code: DEMO_TAG }] },
    resource: ['Patient', 'ServiceRequest', 'CarePlan', 'DiagnosticReport', 'QuestionnaireResponse', 'Consent', 'Task', 'Provenance', 'AuditEvent', 'Questionnaire', 'PlanDefinition']
      .map((resourceType) => ({ resourceType, criteria: `_tag=${TAG_SYSTEM}|${DEMO_TAG}`, interaction: READ_INTERACTIONS.slice() })),
  };
}
