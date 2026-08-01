const NS = "https://consentloop-3d.dev";

/** Applied to durable demo fixtures: Patient, Practitioner, Questionnaire. */
export const SEED_TAG = { system: `${NS}/tags`, code: "seed" };

/**
 * Applied to everything created per demo run: ServiceRequest, Encounter, Task,
 * Consent, QuestionnaireResponse, Provenance. `reset-demo` wipes only this tag
 * so the patient/practitioner/questionnaire don't need re-seeding between
 * takes — only `seed-demo` touches SEED_TAG.
 */
export const RUN_TAG = { system: `${NS}/tags`, code: "demo-run" };

/** Applied to the two deployed Bot resources so setup scripts can find them by tag. */
export const BOT_TAG = { system: `${NS}/tags`, code: "bot" };

/** Applied to the two Subscription resources wiring ServiceRequest/QuestionnaireResponse to the bots. */
export const SUBSCRIPTION_TAG = { system: `${NS}/tags`, code: "subscription" };

export const COMPREHENSION_QUESTIONNAIRE_URL = `${NS}/fhir/Questionnaire/comprehension`;

/** Coding system for each teach-back concept's answer (ComprehensionStatus). */
export const COMPREHENSION_STATUS_SYSTEM = `${NS}/fhir/CodeSystem/comprehension-status`;

/** SNOMED CT — Arthroscopy of knee. */
export const KNEE_ARTHROSCOPY_CODE = {
  system: "http://snomed.info/sct",
  code: "73761001",
  display: "Arthroscopy of knee (procedure)",
};

/** Distinguishes the clinician-escalation Task from the education Task, both of which share `focus`/`partOf` chains. */
export const TASK_KIND_SYSTEM = `${NS}/fhir/CodeSystem/task-kind`;
export const CLINICIAN_REVIEW_TASK_CODE = "clinician-review";

export const PREPARE_CONSENT_BOT_NAME = "consentloop-prepare-consent";
export const ASSESS_TEACHBACK_BOT_NAME = "consentloop-assess-teachback";

export const PREPARE_CONSENT_SUBSCRIPTION_REASON =
  "ConsentLoop: fire the consent-preparation bot when a knee-arthroscopy ServiceRequest goes active";
export const ASSESS_TEACHBACK_SUBSCRIPTION_REASON =
  "ConsentLoop: fire the comprehension bot whenever the session QuestionnaireResponse is updated";
