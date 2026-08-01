import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected YYYY-MM-DD');
const reference = z.string().regex(/^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]+$/u, 'Expected a FHIR reference');

export const clinicalStatusSchema = z.enum([
  'appropriate',
  'not-appropriate',
  'needs-specialist-review',
  'insufficient-information',
]);

export const availabilityStatusSchema = z.enum([
  'available-here',
  'referral-available',
  'research-only',
  'unknown',
]);

export const evidenceStrengthSchema = z.enum(['high', 'moderate', 'low', 'very-low', 'not-rated']);

export const evidenceSourceSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  url: z.url(),
  jurisdiction: nonEmpty,
  publishedAt: date,
  reviewedAt: date,
  evidenceStrength: evidenceStrengthSchema,
  regulatoryStatus: nonEmpty,
  claims: z.array(nonEmpty).min(1),
});

export const catalogTreatmentOptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  title: nonEmpty,
  summary: nonEmpty,
  expectedBenefits: z.array(nonEmpty).min(1),
  materialRisks: z.array(nonEmpty).min(1),
  eligibilityQuestions: z.array(nonEmpty).min(1),
  recoveryConsiderations: z.array(nonEmpty).min(1),
  evidence: z.array(evidenceSourceSchema).min(1),
});

const exclusionSchema = z.object({
  reason: nonEmpty,
  sourceId: nonEmpty,
  decidedBy: reference,
  decidedAt: z.iso.datetime(),
});

export const treatmentOptionSchema = catalogTreatmentOptionSchema
  .extend({
    clinicalStatus: clinicalStatusSchema,
    availability: availabilityStatusSchema,
    exclusion: exclusionSchema.optional(),
  })
  .superRefine((option, context) => {
    if (option.clinicalStatus === 'not-appropriate' && !option.exclusion) {
      context.addIssue({ code: 'custom', path: ['exclusion'], message: 'Excluded options require a sourced decision' });
    }
    if (option.clinicalStatus !== 'not-appropriate' && option.exclusion) {
      context.addIssue({ code: 'custom', path: ['exclusion'], message: 'Only excluded options can have an exclusion' });
    }
    if (option.availability === 'research-only' && option.clinicalStatus === 'appropriate') {
      context.addIssue({ code: 'custom', path: ['clinicalStatus'], message: 'Research-only options require specialist review' });
    }
  });

export const optionSnapshotSchema = z.object({
  id: nonEmpty,
  patientId: nonEmpty,
  serviceRequestId: nonEmpty,
  catalogVersion: nonEmpty,
  snapshotVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  sourceCoverage: nonEmpty,
  options: z.array(treatmentOptionSchema).min(1),
});

export const comprehensionStatusSchema = z.enum([
  'understood',
  'partial',
  'contradicted',
  'uncertain',
  'not-discussed',
]);

export const comprehensionConceptSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  critical: z.boolean(),
  status: comprehensionStatusSchema,
  sceneId: nonEmpty,
});

export const consentEventSchema = z.object({
  timestamp: z.iso.datetime(),
  resourceType: nonEmpty,
  resourceId: nonEmpty,
  action: nonEmpty,
  summary: nonEmpty,
  resource: z.record(z.string(), z.unknown()),
});

export const consentSessionSchema = z.object({
  patientId: nonEmpty,
  serviceRequestId: nonEmpty,
  taskId: nonEmpty,
  consentId: nonEmpty,
  questionnaireResponseId: nonEmpty,
  carePlanId: nonEmpty,
  procedureCode: nonEmpty,
  status: z.enum(['preparing', 'educating', 'review', 'ready', 'completed']),
  optionSnapshot: optionSnapshotSchema,
});

export type ClinicalStatus = z.infer<typeof clinicalStatusSchema>;
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type CatalogTreatmentOption = z.infer<typeof catalogTreatmentOptionSchema>;
export type TreatmentOption = z.infer<typeof treatmentOptionSchema>;
export type OptionSnapshot = z.infer<typeof optionSnapshotSchema>;
export type ComprehensionConcept = z.infer<typeof comprehensionConceptSchema>;
export type ConsentEvent = z.infer<typeof consentEventSchema>;
export type ConsentSession = z.infer<typeof consentSessionSchema>;
