export const FHIR_BASE = 'https://consentloop.dev/fhir';
export const IDENTIFIER_SYSTEM = `${FHIR_BASE}/identifier`;
export const TAG_SYSTEM = `${FHIR_BASE}/tags`;
export const DEMO_TAG = 'synthetic-demo';
export const PROCEDURE_CODE_SYSTEM = `${FHIR_BASE}/CodeSystem/procedures`;
export const KNEE_ARTHROSCOPY_CODE = 'knee-arthroscopy';
export const OPTION_CATALOG_URL = `${FHIR_BASE}/PlanDefinition/meniscus-options`;
export const OPTION_EXTENSION_URL = `${FHIR_BASE}/StructureDefinition/treatment-option`;
export const SNAPSHOT_EXTENSION_URL = `${FHIR_BASE}/StructureDefinition/option-snapshot`;
export const SESSION_KEY_EXTENSION_URL = `${FHIR_BASE}/StructureDefinition/session-key`;
export const PREPARE_BOT_IDENTIFIER = 'prepare-consent';
export const PREPARE_SUBSCRIPTION_TAG = 'prepare-consent-subscription';

export function demoTag(): { system: string; code: string; display: string } {
  return { system: TAG_SYSTEM, code: DEMO_TAG, display: 'ConsentLoop synthetic demo data' };
}
