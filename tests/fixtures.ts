import type { CatalogTreatmentOption, EvidenceSource, TreatmentOption } from '../packages/shared/index.js';

export const aaosEvidence: EvidenceSource = {
  id: 'aaos-meniscus-2024',
  title: 'Management of Acute Isolated Meniscal Pathology',
  url: 'https://orthoinfo.aaos.org/globalassets/pdfs/plain-language-summary_meniscus-tears-2024.pdf',
  jurisdiction: 'US',
  publishedAt: '2024-07-10',
  reviewedAt: '2026-08-01',
  evidenceStrength: 'moderate',
  regulatoryStatus: 'Clinical guidance',
  claims: ['Physical therapy can be used with or without surgery.'],
};

export const rehabCatalogOption: CatalogTreatmentOption = {
  id: 'structured-rehabilitation',
  title: 'Structured rehabilitation and reassessment',
  summary: 'A supervised rehabilitation plan followed by clinical reassessment.',
  expectedBenefits: ['May improve symptoms and function without surgery.'],
  materialRisks: ['Symptoms can persist and may still require reassessment.'],
  eligibilityQuestions: ['Is the knee locking or significantly swollen?'],
  recoveryConsiderations: ['Activity is adjusted according to symptoms and clinician guidance.'],
  evidence: [aaosEvidence],
};

export const rehabPatientOption: TreatmentOption = {
  ...rehabCatalogOption,
  clinicalStatus: 'appropriate',
  availability: 'available-here',
};
