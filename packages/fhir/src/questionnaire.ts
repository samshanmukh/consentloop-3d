import type { Questionnaire } from "@medplum/fhirtypes";
import {
  CONCEPT_DEFINITIONS,
  COMPREHENSION_CONCEPT_IDS,
  type ComprehensionStatus,
} from "@consentloop/shared";
import { COMPREHENSION_QUESTIONNAIRE_URL, COMPREHENSION_STATUS_SYSTEM, SEED_TAG } from "./constants";

const STATUS_OPTIONS: ComprehensionStatus[] = [
  "understood",
  "partial",
  "contradicted",
  "uncertain",
  "not-discussed",
];

/**
 * One comprehension Questionnaire, three concept groups. Each group has a
 * `status` item (Person 3's evaluator writes one of STATUS_OPTIONS here), an
 * `evidence` item (the patient's own words, for the clinician transcript),
 * and optional misconception/clarification entries for the correction trail.
 *
 * linkIds are the ComprehensionConceptId values themselves — the
 * assess-teachback bot reads QuestionnaireResponse.item[].linkId directly
 * against @consentloop/shared's CONCEPT_DEFINITIONS, so this file and the bot
 * can never drift out of sync with what Person 3 writes.
 */
export function buildComprehensionQuestionnaire(): Questionnaire {
  return {
    resourceType: "Questionnaire",
    meta: { tag: [SEED_TAG] },
    url: COMPREHENSION_QUESTIONNAIRE_URL,
    status: "active",
    title: "Knee arthroscopy — comprehension teach-back",
    item: COMPREHENSION_CONCEPT_IDS.map((conceptId) => ({
      linkId: conceptId,
      text: CONCEPT_DEFINITIONS[conceptId].title,
      type: "group",
      item: [
        {
          linkId: `${conceptId}.status`,
          text: "Comprehension status",
          type: "choice",
          answerOption: STATUS_OPTIONS.map((code) => ({
            valueCoding: {
              system: COMPREHENSION_STATUS_SYSTEM,
              code,
              display: code,
            },
          })),
        },
        {
          linkId: `${conceptId}.evidence`,
          text: "Patient's own words",
          type: "string",
        },
        {
          linkId: `${conceptId}.misconception`,
          text: "Misconception, if any",
          type: "string",
        },
        {
          linkId: `${conceptId}.clarification`,
          text: "Clarification provided, if any",
          type: "string",
        },
      ],
    })),
  };
}
