import type { BotEvent, MedplumClient } from "@medplum/core";
import type { QuestionnaireResponse } from "@medplum/fhirtypes";
import {
  COMPREHENSION_QUESTIONNAIRE_URL,
  parseComprehensionConcepts,
  findSessionRefs,
  applyWorkflowRules,
  type WorkflowResult,
} from "@consentloop/fhir";

/**
 * Fires on the QuestionnaireResponse Subscription (see
 * scripts/setup-subscriptions.ts) every time Person 3's voice agent writes a
 * teach-back update. Re-derives the whole state from the QuestionnaireResponse
 * every time — see consent-state.ts's safety invariant.
 */
export async function handler(
  medplum: MedplumClient,
  event: BotEvent<QuestionnaireResponse>
): Promise<WorkflowResult | undefined> {
  const qr = event.input;
  if (qr.resourceType !== "QuestionnaireResponse") return;
  if (qr.questionnaire !== COMPREHENSION_QUESTIONNAIRE_URL) return;

  const concepts = parseComprehensionConcepts(qr);
  if (concepts.length === 0) {
    console.log("assess-teachback: no answers yet on", qr.id);
    return;
  }

  const refs = await findSessionRefs(medplum, qr);
  if (!refs) {
    console.warn("assess-teachback: no session found for QuestionnaireResponse", qr.id);
    return;
  }

  const result = await applyWorkflowRules(medplum, {
    task: refs.task,
    consent: refs.consent,
    questionnaireResponse: qr,
    concepts,
  });

  console.log("assess-teachback:", result.action.reason, {
    task: result.taskStatus,
    consent: result.consentStatus,
    clinicianTask: result.clinicianTaskId,
  });

  return result;
}
