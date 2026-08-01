import type { CarePlan, DiagnosticReport, PlanDefinition, ServiceRequest } from '@medplum/fhirtypes';
import {
  canonicalJson,
  IDENTIFIER_SYSTEM,
  OPTION_CATALOG_URL,
  OPTION_EXTENSION_URL,
  optionSnapshotSchema,
  sha256,
  SNAPSHOT_EXTENSION_URL,
  type AvailabilityStatus,
  type ClinicalStatus,
  type OptionSnapshot,
  type TreatmentOption,
} from '../shared/index.js';
import { getStringExtension, stringExtension } from './extensions.js';
import { CATALOG_COVERAGE, readCatalogOptions, validateOptionCatalog } from './option-catalog.js';

export interface OptionDecision {
  clinicalStatus?: ClinicalStatus;
  availability?: AvailabilityStatus;
  exclusion?: TreatmentOption['exclusion'];
}

export interface SnapshotInput {
  patientId: string;
  serviceRequestId: string;
  encounterReference?: string;
  authorReference: string;
  diagnosticReferences: string[];
  catalog: PlanDefinition;
  decisions: Readonly<Record<string, OptionDecision>>;
  createdAt: string;
}

function patientOption(
  catalogOption: ReturnType<typeof readCatalogOptions>[number],
  decision: OptionDecision | undefined,
): TreatmentOption {
  const candidate = {
    ...catalogOption,
    clinicalStatus: decision?.clinicalStatus ?? 'insufficient-information',
    availability: decision?.availability ?? 'unknown',
    ...(decision?.exclusion ? { exclusion: decision.exclusion } : {}),
  };
  return optionSnapshotSchema.shape.options.element.parse(candidate);
}

export function buildOptionSnapshot(input: SnapshotInput): OptionSnapshot {
  validateOptionCatalog(input.catalog);
  const catalogVersion = input.catalog.version;
  if (!catalogVersion) throw new Error('Option catalog version is required');
  const options = readCatalogOptions(input.catalog).map((option) => patientOption(option, input.decisions[option.id]));
  const material = {
    patientId: input.patientId,
    serviceRequestId: input.serviceRequestId,
    diagnosticReferences: [...input.diagnosticReferences].sort(),
    catalogVersion,
    sourceCoverage: input.catalog.description ?? CATALOG_COVERAGE,
    options,
  };
  return optionSnapshotSchema.parse({
    id: `options:${input.serviceRequestId}`,
    ...material,
    snapshotVersion: sha256(material),
    createdAt: input.createdAt,
  });
}

function activity(option: TreatmentOption, catalogVersion: string): NonNullable<CarePlan['activity']>[number] {
  return {
    id: option.id,
    detail: {
      status: option.clinicalStatus === 'not-appropriate' ? 'on-hold' : 'not-started',
      doNotPerform: option.clinicalStatus === 'not-appropriate',
      instantiatesCanonical: [`${OPTION_CATALOG_URL}|${catalogVersion}`],
      code: { coding: [{ system: `${OPTION_CATALOG_URL}/options`, code: option.id, display: option.title }] },
      reasonCode: [{ text: `${option.clinicalStatus}; ${option.availability}` }],
      description: option.summary,
      extension: [stringExtension(OPTION_EXTENSION_URL, canonicalJson(option))],
    },
  };
}

export function buildOptionCarePlan(input: SnapshotInput): CarePlan {
  const snapshot = buildOptionSnapshot(input);
  return {
    resourceType: 'CarePlan',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: snapshot.id }],
    instantiatesCanonical: [`${OPTION_CATALOG_URL}|${snapshot.catalogVersion}`],
    status: 'active',
    intent: 'proposal',
    title: 'ConsentLoop patient option snapshot',
    description: snapshot.sourceCoverage,
    subject: { reference: `Patient/${input.patientId}` },
    ...(input.encounterReference ? { encounter: { reference: input.encounterReference } } : {}),
    created: input.createdAt,
    author: { reference: input.authorReference },
    supportingInfo: [
      { reference: `ServiceRequest/${input.serviceRequestId}` },
      ...input.diagnosticReferences.map((reference) => ({ reference })),
    ],
    extension: [stringExtension(SNAPSHOT_EXTENSION_URL, canonicalJson(snapshot))],
    activity: snapshot.options.map((option) => activity(option, snapshot.catalogVersion)),
  };
}

export function readOptionSnapshot(carePlan: CarePlan): OptionSnapshot {
  const encoded = getStringExtension(carePlan.extension, SNAPSHOT_EXTENSION_URL);
  if (!encoded) throw new Error('CarePlan has no ConsentLoop option snapshot');
  return optionSnapshotSchema.parse(JSON.parse(encoded));
}

export function diagnosticReferences(request: ServiceRequest, reports: DiagnosticReport[]): string[] {
  const reportReferences = new Set(reports.map((report) => `DiagnosticReport/${report.id}`));
  return (request.reasonReference ?? [])
    .map((reason) => reason.reference)
    .filter((reference): reference is string => Boolean(reference && reportReferences.has(reference)));
}
