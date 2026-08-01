import type { BotEvent, MedplumClient } from '@medplum/core';
import type {
  Bundle,
  BundleEntry,
  Consent,
  Device,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  Patient,
  PlanDefinition,
  Provenance,
  Questionnaire,
  QuestionnaireResponse,
  Resource,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import {
  buildOptionCarePlan,
  diagnosticReferences,
  identifierQuery,
  readOptionSnapshot,
  type Identified,
  type OptionDecision,
} from '../../packages/fhir/index.js';
import {
  demoTag,
  canonicalJson,
  defaultComprehensionConcepts,
  deterministicUuid,
  FHIR_BASE,
  IDENTIFIER_SYSTEM,
  KNEE_ARTHROSCOPY_CODE,
  OPTION_CATALOG_URL,
  PREPARE_BOT_IDENTIFIER,
  PROCEDURE_CODE_SYSTEM,
  SESSION_KEY_EXTENSION_URL,
  TAG_SYSTEM,
  WORKFLOW_EXTENSION_URL,
  initialConsentWorkflow,
} from '../../packages/shared/index.js';
import { stringExtension } from '../../packages/fhir/extensions.js';

const PROVENANCE_TAG_PREFIX = 'prepare-provenance:';
const SESSION_RESOURCE_PREFIXES = ['options', 'task', 'consent', 'questionnaire-response'] as const;

export interface PreparationInput {
  request: Identified<ServiceRequest>;
  patient: Identified<Patient>;
  encounter: Identified<Encounter>;
  diagnostics: Identified<DiagnosticReport>[];
  catalog: Identified<PlanDefinition>;
  questionnaire: Identified<Questionnaire>;
  consentDocument: Identified<DocumentReference>;
  botReference: string;
  now: string;
}

function reference<T extends Resource>(resource: Identified<T>): { reference: string } {
  return { reference: `${resource.resourceType}/${resource.id}` };
}

function sessionIdentifier(prefix: (typeof SESSION_RESOURCE_PREFIXES)[number], requestId: string): string {
  return `${prefix}:${requestId}`;
}

function conditionalEntry(resource: Resource, fullUrl: string, query: string): BundleEntry {
  return { fullUrl, resource, request: { method: 'POST', url: resource.resourceType, ifNoneExist: query } };
}

function tagged<T extends Resource>(resource: T): T {
  return { ...resource, meta: { ...resource.meta, tag: [demoTag()] } };
}

function requesterReference(
  request: ServiceRequest,
): NonNullable<ServiceRequest['requester']> & { reference: string } {
  if (!request.requester?.reference) throw new Error('ServiceRequest requester reference is required');
  return { ...request.requester, reference: request.requester.reference };
}

function defaultDecisions(): Record<string, OptionDecision> {
  return {
    'structured-rehabilitation': { clinicalStatus: 'appropriate', availability: 'available-here' },
    'meniscus-repair': { clinicalStatus: 'needs-specialist-review', availability: 'available-here' },
    'partial-meniscectomy': { clinicalStatus: 'needs-specialist-review', availability: 'available-here' },
    'regenerative-specialist-review': {
      clinicalStatus: 'needs-specialist-review',
      availability: 'referral-available',
    },
  };
}

export function validatePreparationRequest(resource: ServiceRequest): asserts resource is Identified<ServiceRequest> {
  const isKneeArthroscopy = resource.code?.coding?.some(
    (coding) => coding.system === PROCEDURE_CODE_SYSTEM && coding.code === KNEE_ARTHROSCOPY_CODE,
  );
  const isDemo = resource.meta?.tag?.some((tag) => tag.system === TAG_SYSTEM && tag.code === 'synthetic-demo');
  if (!resource.id || resource.status !== 'active' || resource.intent !== 'order' || !isKneeArthroscopy || !isDemo) {
    throw new Error('ServiceRequest is not an eligible active ConsentLoop knee-arthroscopy order');
  }
  if (!resource.subject?.reference || !resource.encounter?.reference || !resource.requester?.reference) {
    throw new Error('ServiceRequest requires patient, encounter, and requester references');
  }
  if (!resource.reasonReference?.some((reason) => reason.reference?.startsWith('DiagnosticReport/'))) {
    throw new Error('ServiceRequest requires a referenced diagnostic report');
  }
}

function taskResource(input: PreparationInput, carePlanUrl: string): Task {
  return tagged({
    resourceType: 'Task',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: sessionIdentifier('task', input.request.id) }],
    basedOn: [reference(input.request)],
    status: 'in-progress',
    intent: 'plan',
    code: { coding: [{ system: `${FHIR_BASE}/CodeSystem/tasks`, code: 'consent-education' }] },
    description: 'Complete option review and teach-back before consent.',
    focus: { reference: carePlanUrl },
    for: reference(input.patient),
    encounter: reference(input.encounter),
    authoredOn: input.now,
    lastModified: input.now,
    requester: requesterReference(input.request),
    extension: [stringExtension(SESSION_KEY_EXTENSION_URL, `prepare:${input.request.id}`)],
  });
}

function consentResource(input: PreparationInput, snapshotVersion: string): Consent {
  const workflow = initialConsentWorkflow(`Patient/${input.patient.id}`, snapshotVersion, defaultComprehensionConcepts());
  return tagged({
    resourceType: 'Consent',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: sessionIdentifier('consent', input.request.id) }],
    status: 'draft',
    scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'treatment' }] },
    category: [{ coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Patient Consent' }] }],
    patient: reference(input.patient),
    dateTime: input.now,
    performer: [reference(input.patient)],
    sourceReference: reference(input.consentDocument),
    extension: [
      stringExtension(SESSION_KEY_EXTENSION_URL, `prepare:${input.request.id}`),
      stringExtension(WORKFLOW_EXTENSION_URL, canonicalJson(workflow)),
    ],
  });
}

function responseResource(input: PreparationInput, carePlanUrl: string): QuestionnaireResponse {
  return tagged({
    resourceType: 'QuestionnaireResponse',
    identifier: { system: IDENTIFIER_SYSTEM, value: sessionIdentifier('questionnaire-response', input.request.id) },
    basedOn: [reference(input.request), { reference: carePlanUrl }],
    questionnaire: `Questionnaire/${input.questionnaire.id}`,
    status: 'in-progress',
    subject: reference(input.patient),
    encounter: reference(input.encounter),
    authored: input.now,
    source: reference(input.patient),
    extension: [stringExtension(SESSION_KEY_EXTENSION_URL, `prepare:${input.request.id}`)],
  });
}

function agentDevice(input: PreparationInput): Device {
  return tagged({
    resourceType: 'Device',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: `bot-agent:${PREPARE_BOT_IDENTIFIER}` }],
    status: 'active',
    deviceName: [{ name: 'ConsentLoop preparation Bot', type: 'user-friendly-name' }],
    note: [{ text: `Medplum automation represented by ${input.botReference}` }],
  });
}

function provenanceResource(input: PreparationInput, targets: string[], deviceUrl: string): Provenance {
  const tag = `${PROVENANCE_TAG_PREFIX}${input.request.id}`;
  return {
    resourceType: 'Provenance',
    meta: { tag: [demoTag(), { system: TAG_SYSTEM, code: tag }] },
    target: targets.map((target) => ({ reference: target })),
    recorded: input.now,
    activity: { coding: [{ system: `${FHIR_BASE}/CodeSystem/provenance-activity`, code: 'prepare-consent' }] },
    reason: [{ text: 'Eligible knee-arthroscopy ServiceRequest created a consent education session.' }],
    agent: [{ type: { text: 'software author' }, who: { reference: deviceUrl } }],
    entity: [{ role: 'source', what: reference(input.request) }],
    extension: [
      stringExtension(`${FHIR_BASE}/StructureDefinition/medplum-bot-reference`, input.botReference),
      stringExtension(SESSION_KEY_EXTENSION_URL, `prepare:${input.request.id}`),
    ],
  };
}

export function buildPreparationBundle(input: PreparationInput): Bundle {
  validatePreparationRequest(input.request);
  if (input.diagnostics.length === 0) throw new Error('At least one diagnostic report is required');
  const urn = (name: string): string => `urn:uuid:${deterministicUuid(`${input.request.id}:${name}`)}`;
  const carePlanUrl = urn('care-plan');
  const taskUrl = urn('task');
  const consentUrl = urn('consent');
  const responseUrl = urn('questionnaire-response');
  const deviceUrl = urn('device');
  const carePlan = tagged(buildOptionCarePlan({
    patientId: input.patient.id,
    serviceRequestId: input.request.id,
    encounterReference: `Encounter/${input.encounter.id}`,
    authorReference: requesterReference(input.request).reference,
    diagnosticReferences: diagnosticReferences(input.request, input.diagnostics),
    diagnosticVersions: Object.fromEntries(input.diagnostics.map((report) => [
      `DiagnosticReport/${report.id}`,
      report.meta?.versionId ?? report.meta?.lastUpdated ?? 'unknown',
    ])),
    catalog: input.catalog,
    decisions: defaultDecisions(),
    createdAt: input.now,
  }));
  const targets = [carePlanUrl, taskUrl, consentUrl, responseUrl];
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      conditionalEntry(carePlan, carePlanUrl, identifierQuery(sessionIdentifier('options', input.request.id))),
      conditionalEntry(taskResource(input, carePlanUrl), taskUrl, identifierQuery(sessionIdentifier('task', input.request.id))),
      conditionalEntry(consentResource(input, readOptionSnapshot(carePlan).snapshotVersion), consentUrl, identifierQuery(sessionIdentifier('consent', input.request.id))),
      conditionalEntry(responseResource(input, carePlanUrl), responseUrl, identifierQuery(sessionIdentifier('questionnaire-response', input.request.id))),
      conditionalEntry(agentDevice(input), deviceUrl, identifierQuery(`bot-agent:${PREPARE_BOT_IDENTIFIER}`)),
      conditionalEntry(
        provenanceResource(input, targets, deviceUrl),
        urn('provenance'),
        new URLSearchParams({ _tag: `${TAG_SYSTEM}|${PROVENANCE_TAG_PREFIX}${input.request.id}` }).toString(),
      ),
    ],
  };
}

async function readPreparationInput(
  medplum: MedplumClient,
  request: Identified<ServiceRequest>,
  event: BotEvent<ServiceRequest>,
): Promise<PreparationInput> {
  const patient = await medplum.readReference(request.subject);
  const encounter = await medplum.readReference(request.encounter as { reference: string });
  const diagnostics = await Promise.all(
    (request.reasonReference ?? [])
      .filter((reason) => reason.reference?.startsWith('DiagnosticReport/'))
      .map((reason) => medplum.readReference(reason)),
  );
  const catalog = await medplum.searchOne('PlanDefinition', `url=${encodeURIComponent(OPTION_CATALOG_URL)}`);
  const questionnaire = await medplum.searchOne('Questionnaire', identifierQuery('questionnaire-meniscus-teachback'));
  const consentDocument = await medplum.searchOne('DocumentReference', identifierQuery('document-meniscus-consent-v1'));
  if (!catalog || !questionnaire || !consentDocument) throw new Error('Seeded catalog, questionnaire, and consent document are required');
  if (patient.resourceType !== 'Patient' || encounter.resourceType !== 'Encounter' || diagnostics.some((r) => r.resourceType !== 'DiagnosticReport')) {
    throw new Error('ServiceRequest references have unexpected resource types');
  }
  return {
    request,
    patient,
    encounter,
    diagnostics: diagnostics as Identified<DiagnosticReport>[],
    catalog,
    questionnaire,
    consentDocument,
    botReference: event.bot.reference ?? `Bot/${PREPARE_BOT_IDENTIFIER}`,
    now: new Date().toISOString(),
  };
}

export async function handler(medplum: MedplumClient, event: BotEvent<ServiceRequest>): Promise<{ sessionKey: string }> {
  validatePreparationRequest(event.input);
  const input = await readPreparationInput(medplum, event.input, event);
  await medplum.executeBatch(buildPreparationBundle(input));
  return { sessionKey: `prepare:${event.input.id}` };
}
