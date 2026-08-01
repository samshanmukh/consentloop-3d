import type {
  AccessPolicy,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  ImagingStudy,
  Observation,
  Patient,
  PlanDefinition,
  Practitioner,
  Questionnaire,
  Resource,
  ServiceRequest,
} from '@medplum/fhirtypes';
import {
  demoTag,
  DEMO_TAG,
  IDENTIFIER_SYSTEM,
  KNEE_ARTHROSCOPY_CODE,
  OPTION_CATALOG_URL,
  PROCEDURE_CODE_SYSTEM,
  TAG_SYSTEM,
} from '../shared/index.js';
import type { FhirWriter, Identified } from './client.js';
import { buildOptionCatalog } from './option-catalog.js';
import { clinicianDemoAccessPolicy, patientSessionAccessPolicy } from './session-read-model.js';

export const DEMO_IDENTIFIERS = {
  patient: 'patient-arjun-synthetic',
  practitioner: 'practitioner-maya-rao-synthetic',
  encounter: 'encounter-right-knee-evaluation',
  examination: 'observation-right-knee-exam',
  xray: 'diagnostic-report-right-knee-xray',
  mriStudy: 'imaging-study-right-knee-mri',
  mri: 'diagnostic-report-right-knee-mri',
  questionnaire: 'questionnaire-meniscus-teachback',
  consentDocument: 'document-meniscus-consent-v1',
  serviceRequest: 'service-request-knee-arthroscopy',
} as const;

export interface SeededDemo {
  catalog: Identified<PlanDefinition>;
  patient: Identified<Patient>;
  practitioner: Identified<Practitioner>;
  encounter: Identified<Encounter>;
  examination: Identified<Observation>;
  xray: Identified<DiagnosticReport>;
  mriStudy: Identified<ImagingStudy>;
  mri: Identified<DiagnosticReport>;
  questionnaire: Identified<Questionnaire>;
  consentDocument: Identified<DocumentReference>;
  serviceRequest: Identified<ServiceRequest>;
  patientAccessPolicy: Identified<AccessPolicy>;
  clinicianAccessPolicy: Identified<AccessPolicy>;
}

export function identifierQuery(value: string): string {
  return new URLSearchParams({ identifier: `${IDENTIFIER_SYSTEM}|${value}` }).toString();
}

function identified<T extends Resource>(resource: T, value: string): T {
  return {
    ...resource,
    identifier: [{ system: IDENTIFIER_SYSTEM, value }],
    meta: { ...resource.meta, tag: [demoTag()] },
  };
}

async function upsert<T extends Resource>(client: FhirWriter, resource: T, value: string): Promise<Identified<T>> {
  return client.upsertResource(identified(resource, value), identifierQuery(value));
}

function reference(resource: Identified<Resource>): { reference: string } {
  return { reference: `${resource.resourceType}/${resource.id}` };
}

export async function seedDemo(client: FhirWriter): Promise<SeededDemo> {
  const catalog = await client.upsertResource(buildOptionCatalog(), `url=${encodeURIComponent(OPTION_CATALOG_URL)}`);
  const patient = await upsert(client, patientResource(), DEMO_IDENTIFIERS.patient);
  const practitioner = await upsert(client, practitionerResource(), DEMO_IDENTIFIERS.practitioner);
  const encounter = await upsert(client, encounterResource(patient, practitioner), DEMO_IDENTIFIERS.encounter);
  const examination = await upsert(client, examinationResource(patient, encounter), DEMO_IDENTIFIERS.examination);
  const xray = await upsert(client, xrayResource(patient, encounter, practitioner), DEMO_IDENTIFIERS.xray);
  const mriStudy = await upsert(client, mriStudyResource(patient, encounter), DEMO_IDENTIFIERS.mriStudy);
  const mri = await upsert(client, mriResource(patient, encounter, practitioner, mriStudy), DEMO_IDENTIFIERS.mri);
  const questionnaire = await upsert(client, questionnaireResource(), DEMO_IDENTIFIERS.questionnaire);
  const consentDocument = await upsert(client, consentDocumentResource(patient), DEMO_IDENTIFIERS.consentDocument);
  const serviceRequest = await upsert(
    client,
    serviceRequestResource(patient, practitioner, encounter, mri),
    DEMO_IDENTIFIERS.serviceRequest,
  );
  const patientPolicy = patientSessionAccessPolicy(patient.id);
  const clinicianPolicy = clinicianDemoAccessPolicy();
  const patientAccessPolicy = await client.upsertResource(patientPolicy, `name=${encodeURIComponent(patientPolicy.name ?? '')}`);
  const clinicianAccessPolicy = await client.upsertResource(clinicianPolicy, `name=${encodeURIComponent(clinicianPolicy.name ?? '')}`);
  return {
    catalog, patient, practitioner, encounter, examination, xray, mriStudy, mri, questionnaire,
    consentDocument, serviceRequest, patientAccessPolicy, clinicianAccessPolicy,
  };
}

function patientResource(): Patient {
  return {
    resourceType: 'Patient',
    active: true,
    name: [{ use: 'official', family: 'Demo', given: ['Arjun'] }],
    gender: 'unknown',
    communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en-IN', display: 'English (India)' }] }, preferred: true }],
  };
}

function practitionerResource(): Practitioner {
  return {
    resourceType: 'Practitioner',
    active: true,
    name: [{ use: 'official', family: 'Rao', given: ['Maya'], prefix: ['Dr'] }],
  };
}

function encounterResource(patient: Identified<Patient>, practitioner: Identified<Practitioner>): Encounter {
  return {
    resourceType: 'Encounter',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: reference(patient),
    participant: [{ individual: reference(practitioner) }],
    period: { start: '2026-05-01T09:00:00.000Z', end: '2026-06-01T10:00:00.000Z' },
    reasonCode: [{ text: 'Persistent right-knee discomfort after sports activity' }],
  };
}

function examinationResource(patient: Identified<Patient>, encounter: Identified<Encounter>): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: `${PROCEDURE_CODE_SYSTEM}/findings`, code: 'right-knee-exam' }], text: 'Initial right-knee examination' },
    subject: reference(patient),
    encounter: reference(encounter),
    effectiveDateTime: '2026-05-01T09:30:00.000Z',
    valueString: 'Physical examination did not identify a definitive cause for the persistent discomfort.',
  };
}

function xrayResource(
  patient: Identified<Patient>,
  encounter: Identified<Encounter>,
  practitioner: Identified<Practitioner>,
): DiagnosticReport {
  return {
    resourceType: 'DiagnosticReport',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '36643-5', display: 'XR Knee' }], text: 'Right-knee X-ray report' },
    subject: reference(patient),
    encounter: reference(encounter),
    effectiveDateTime: '2026-05-15T11:00:00.000Z',
    issued: '2026-05-15T12:00:00.000Z',
    resultsInterpreter: [reference(practitioner)],
    conclusion: 'No radiographic finding explains the persistent symptoms. Soft-tissue injury is not excluded.',
  };
}

function mriStudyResource(patient: Identified<Patient>, encounter: Identified<Encounter>): ImagingStudy {
  return {
    resourceType: 'ImagingStudy',
    status: 'available',
    subject: reference(patient),
    encounter: reference(encounter),
    started: '2026-06-01T08:00:00.000Z',
    modality: [{ system: 'http://dicom.nema.org/resources/ontology/DCM', code: 'MR', display: 'Magnetic Resonance' }],
    numberOfSeries: 1,
    numberOfInstances: 0,
    description: 'Synthetic right-knee MRI metadata. No real scan or image pixels are stored.',
  };
}

function mriResource(
  patient: Identified<Patient>,
  encounter: Identified<Encounter>,
  practitioner: Identified<Practitioner>,
  study: Identified<ImagingStudy>,
): DiagnosticReport {
  return {
    resourceType: 'DiagnosticReport',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '30799-1', display: 'MR Knee' }], text: 'Right-knee MRI report' },
    subject: reference(patient),
    encounter: reference(encounter),
    effectiveDateTime: '2026-06-01T08:00:00.000Z',
    issued: '2026-06-01T10:00:00.000Z',
    resultsInterpreter: [reference(practitioner)],
    imagingStudy: [reference(study)],
    conclusion: 'Synthetic finding: complex irregular meniscal tear with additional knee findings requiring orthopedic review.',
    conclusionCode: [{ coding: [{ system: 'http://snomed.info/sct', code: '202735001', display: 'Tear of meniscus of knee' }] }],
  };
}

function questionnaireResource(): Questionnaire {
  return {
    resourceType: 'Questionnaire',
    url: `${OPTION_CATALOG_URL}/Questionnaire/meniscus-teachback`,
    version: '1.0.0',
    name: 'MeniscusTeachBack',
    title: 'Meniscus consent teach-back',
    status: 'active',
    experimental: true,
    date: '2026-08-01',
    item: [
      { linkId: 'procedure-identity', text: 'Describe the procedure or plan being considered.', type: 'text', required: true },
      { linkId: 'tissue-treated', text: 'Which tissue is being treated or preserved?', type: 'text', required: true },
      { linkId: 'important-limitation-risk', text: 'Name one important limitation or risk.', type: 'text', required: true },
    ],
  };
}

function consentDocumentResource(patient: Identified<Patient>): DocumentReference {
  const content = Buffer.from('# Synthetic meniscus consent\nClinician-approved demo content only.\n').toString('base64');
  return {
    resourceType: 'DocumentReference',
    status: 'current',
    type: { text: 'Versioned synthetic meniscus consent content' },
    subject: reference(patient),
    date: '2026-08-01T00:00:00.000Z',
    description: 'Synthetic versioned consent content for the ConsentLoop demo.',
    content: [{ attachment: { contentType: 'text/markdown', data: content, title: 'Synthetic meniscus consent v1' } }],
  };
}

function serviceRequestResource(
  patient: Identified<Patient>,
  practitioner: Identified<Practitioner>,
  encounter: Identified<Encounter>,
  mri: Identified<DiagnosticReport>,
): ServiceRequest {
  return {
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    code: { coding: [{ system: PROCEDURE_CODE_SYSTEM, code: KNEE_ARTHROSCOPY_CODE, display: 'Knee arthroscopy review' }] },
    subject: reference(patient),
    encounter: reference(encounter),
    authoredOn: '2026-06-02T09:00:00.000Z',
    requester: reference(practitioner),
    reasonReference: [reference(mri)],
    note: [{ text: 'Review repair versus limited damaged-tissue removal and all clinically relevant alternatives.' }],
    meta: { tag: [{ system: TAG_SYSTEM, code: DEMO_TAG }] },
  };
}
