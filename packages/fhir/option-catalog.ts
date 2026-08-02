import type { PlanDefinition, PlanDefinitionAction, RelatedArtifact } from '@medplum/fhirtypes';
import {
  catalogTreatmentOptionSchema,
  canonicalJson,
  demoTag,
  OPTION_CATALOG_URL,
  OPTION_EXTENSION_URL,
  sha256,
  type CatalogTreatmentOption,
  type EvidenceSource,
} from '../shared/index.js';
import { getStringExtension, stringExtension } from './extensions.js';

const COVERAGE_EXTENSION_URL = `${OPTION_CATALOG_URL}/coverage`;
export const CATALOG_REVIEW_DATE = '2026-08-01';
export const CATALOG_COVERAGE =
  'Meniscal treatment paths for the India hackathon demo; not a complete worldwide treatment registry.';

const aaos: EvidenceSource = {
  id: 'aaos-meniscus-2024',
  title: 'Management of Acute Isolated Meniscal Pathology',
  url: 'https://orthoinfo.aaos.org/globalassets/pdfs/plain-language-summary_meniscus-tears-2024.pdf',
  jurisdiction: 'US',
  publishedAt: '2024-07-10',
  reviewedAt: CATALOG_REVIEW_DATE,
  evidenceStrength: 'moderate',
  regulatoryStatus: 'Clinical guidance',
  claims: [
    'Physical therapy is an option with or without surgery.',
    'Surgery should preserve as much healthy meniscal tissue as possible.',
  ],
};

const indiaDhr: EvidenceSource = {
  id: 'india-dhr-orthopedic-stem-cell-2026',
  title: 'Evidence-based Guidelines for Stem Cell Therapy in Orthopedic Conditions',
  url: 'https://www.dhr.gov.in/static/uploads/2025/10/f97c65c08c132edfedb703d719ec1748.pdf',
  jurisdiction: 'IN',
  publishedAt: '2026-01-01',
  reviewedAt: CATALOG_REVIEW_DATE,
  evidenceStrength: 'very-low',
  regulatoryStatus: 'Conditionally not recommended for routine meniscal care',
  claims: ['Stem-cell therapy is not recommended in routine clinical practice for meniscal tears.'],
};

const fda: EvidenceSource = {
  id: 'fda-regenerative-medicine-2021',
  title: 'Important Patient and Consumer Information About Regenerative Medicine Therapies',
  url: 'https://www.fda.gov/vaccines-blood-biologics/consumers-biologics/important-patient-and-consumer-information-about-regenerative-medicine-therapies',
  jurisdiction: 'US',
  publishedAt: '2021-06-03',
  reviewedAt: CATALOG_REVIEW_DATE,
  evidenceStrength: 'not-rated',
  regulatoryStatus: 'Not FDA-approved for orthopedic conditions',
  claims: ['Regenerative medicine therapies are not FDA-approved for orthopedic conditions.'],
};

export const MENISCUS_OPTIONS: readonly CatalogTreatmentOption[] = [
  {
    id: 'structured-rehabilitation',
    title: 'Structured rehabilitation and reassessment',
    summary: 'A supervised rehabilitation plan followed by clinical reassessment.',
    expectedBenefits: ['May improve symptoms and function without surgery.'],
    materialRisks: ['Symptoms may persist or worsen while the tear remains untreated surgically.'],
    eligibilityQuestions: ['Is the knee locking, significantly swollen, or unable to move normally?'],
    recoveryConsiderations: ['Activity changes and therapy attendance are required.'],
    evidence: [aaos],
  },
  {
    id: 'meniscus-repair',
    title: 'Arthroscopic meniscus repair',
    summary: 'The surgeon sutures repairable meniscal tissue while preserving as much tissue as possible.',
    expectedBenefits: ['Preserves meniscal tissue when the tear can heal.'],
    materialRisks: ['Repair can fail and recovery is usually longer than partial meniscectomy.'],
    eligibilityQuestions: ['Are the tear location, blood supply, tissue quality, and pattern repairable?'],
    recoveryConsiderations: ['Protected weight bearing, a brace, and rehabilitation may be required.'],
    evidence: [aaos],
  },
  {
    id: 'partial-meniscectomy',
    title: 'Arthroscopic partial meniscectomy',
    summary: 'The surgeon removes only damaged tissue that cannot be preserved or repaired.',
    expectedBenefits: ['May reduce mechanical symptoms when non-operative care is insufficient.'],
    materialRisks: ['Removing tissue can reduce shock absorption and has surgical risks.'],
    eligibilityQuestions: ['Why is repair not feasible, and how much tissue may be removed?'],
    recoveryConsiderations: ['Recovery may be shorter than repair but still requires rehabilitation.'],
    evidence: [aaos],
  },
  {
    id: 'regenerative-specialist-review',
    title: 'Regenerative or stem-cell-based specialist review',
    summary: 'A specialist reviews the exact product, evidence, regulation, and trial status; this is not routine care.',
    expectedBenefits: ['Potential benefit is uncertain and must not be promised.'],
    materialRisks: ['Evidence is very limited; products can be unapproved, ineffective, costly, or harmful.'],
    eligibilityQuestions: ['What is the exact product, approval status, evidence, and clinical-trial oversight?'],
    recoveryConsiderations: ['Follow-up and restrictions depend on the exact intervention or trial protocol.'],
    evidence: [indiaDhr, fda],
  },
] as const;

function evidenceArtifacts(evidence: EvidenceSource[]): RelatedArtifact[] {
  return evidence.map((source) => ({
    type: 'documentation',
    label: source.title,
    display: `${source.jurisdiction}: ${source.regulatoryStatus}`,
    url: source.url,
  }));
}

function optionAction(option: CatalogTreatmentOption): PlanDefinitionAction {
  return {
    id: option.id,
    title: option.title,
    description: option.summary,
    textEquivalent: option.summary,
    code: [{ coding: [{ system: `${OPTION_CATALOG_URL}/options`, code: option.id, display: option.title }] }],
    documentation: evidenceArtifacts(option.evidence),
    extension: [stringExtension(OPTION_EXTENSION_URL, canonicalJson(option))],
  };
}

function catalogMaterial(options: readonly CatalogTreatmentOption[], coverage: string): unknown {
  return { options, coverage, reviewedAt: CATALOG_REVIEW_DATE };
}

export function buildOptionCatalog(options = MENISCUS_OPTIONS, coverage = CATALOG_COVERAGE): PlanDefinition {
  const parsed = options.map((option) => catalogTreatmentOptionSchema.parse(option));
  const version = `2026.08.${sha256(catalogMaterial(parsed, coverage)).slice(0, 12)}`;
  const sources = [...new Map(parsed.flatMap((option) => option.evidence).map((source) => [source.id, source])).values()];
  return {
    resourceType: 'PlanDefinition',
    url: OPTION_CATALOG_URL,
    identifier: [{ system: OPTION_CATALOG_URL, value: 'meniscus-options' }],
    version,
    name: 'ConsentLoopMeniscusOptions',
    title: 'ConsentLoop Meniscus Treatment Option Catalog',
    status: 'active',
    experimental: true,
    date: CATALOG_REVIEW_DATE,
    publisher: 'ConsentLoop 3D',
    description: coverage,
    jurisdiction: [{ coding: [{ system: 'urn:iso:std:iso:3166', code: 'IN', display: 'India demo' }] }],
    meta: { tag: [demoTag()] },
    extension: [stringExtension(COVERAGE_EXTENSION_URL, coverage)],
    relatedArtifact: evidenceArtifacts(sources),
    action: parsed.map(optionAction),
  };
}

export function readCatalogOptions(catalog: PlanDefinition): CatalogTreatmentOption[] {
  if (catalog.url !== OPTION_CATALOG_URL || catalog.status !== 'active' || !catalog.version) {
    throw new Error('Expected an active, versioned ConsentLoop option catalog');
  }
  const options = (catalog.action ?? []).map((action) => {
    const encoded = getStringExtension(action.extension, OPTION_EXTENSION_URL);
    if (!encoded) throw new Error(`Catalog action ${action.id ?? '<unknown>'} has no structured option`);
    return catalogTreatmentOptionSchema.parse(JSON.parse(encoded));
  });
  if (options.length === 0 || new Set(options.map((option) => option.id)).size !== options.length) {
    throw new Error('Catalog options must be non-empty and uniquely identified');
  }
  return options;
}

export function validateOptionCatalog(catalog: PlanDefinition, asOf = CATALOG_REVIEW_DATE): void {
  const options = readCatalogOptions(catalog);
  const coverage = getStringExtension(catalog.extension, COVERAGE_EXTENSION_URL);
  if (!coverage) throw new Error('Catalog source coverage is required');
  const asOfTime = Date.parse(asOf);
  for (const source of options.flatMap((option) => option.evidence)) {
    const ageDays = (asOfTime - Date.parse(source.reviewedAt)) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 366) {
      throw new Error(`Evidence source ${source.id} has an invalid or expired review date`);
    }
  }
  const expected = buildOptionCatalog(options, coverage).version;
  if (catalog.version !== expected) throw new Error('Catalog version does not match its material content');
}
