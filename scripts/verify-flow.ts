/**
 * End-to-end verification of the full resource flow, calling both bot
 * handlers directly against live Medplum rather than waiting on Subscription
 * delivery — deterministic, and it exercises consent-state.ts's actual logic
 * rather than re-implementing assertions against it.
 *
 *   npm run verify
 *
 * Requires `npm run seed` to have run first. Leaves its resources tagged
 * `demo-run`, so `npm run reset` cleans up afterward.
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();
requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);

import type { QuestionnaireResponseItem } from "@medplum/fhirtypes";
import {
  getMedplum,
  SEED_TAG,
  buildEncounter,
  buildServiceRequest,
  COMPREHENSION_STATUS_SYSTEM,
} from "@consentloop/fhir";
import { COMPREHENSION_CONCEPT_IDS, type ComprehensionStatus } from "@consentloop/shared";
import { handler as prepareConsent } from "@consentloop/bot-prepare-consent";
import { handler as assessTeachback } from "@consentloop/bot-assess-teachback";

let failures = 0;
function check(label: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

function answerItems(
  statuses: Partial<Record<(typeof COMPREHENSION_CONCEPT_IDS)[number], ComprehensionStatus>>
): QuestionnaireResponseItem[] {
  return COMPREHENSION_CONCEPT_IDS.map((conceptId) => ({
    linkId: conceptId,
    item: [
      {
        linkId: `${conceptId}.status`,
        answer: [
          {
            valueCoding: {
              system: COMPREHENSION_STATUS_SYSTEM,
              code: statuses[conceptId] ?? "not-discussed",
            },
          },
        ],
      },
      {
        linkId: `${conceptId}.evidence`,
        answer: [{ valueString: "synthetic verify-flow answer" }],
      },
    ],
  }));
}

async function main() {
  const medplum = await getMedplum();
  console.log("→ connected to Medplum\n");

  const tagFilter = `${SEED_TAG.system}|${SEED_TAG.code}`;
  const [patients, practitioners] = await Promise.all([
    medplum.searchResources("Patient", { _tag: tagFilter, _count: 1 }),
    medplum.searchResources("Practitioner", { _tag: tagFilter, _count: 1 }),
  ]);
  const patient = patients[0];
  const practitioner = practitioners[0];
  if (!patient?.id || !practitioner?.id) {
    throw new Error("No seeded Patient/Practitioner — run `npm run seed` first.");
  }

  console.log("1. ServiceRequest → prepare-consent bot");
  const encounter = await medplum.createResource(
    buildEncounter({ patientId: patient.id, practitionerId: practitioner.id })
  );
  const serviceRequest = await medplum.createResource(
    buildServiceRequest({
      patientId: patient.id,
      practitionerId: practitioner.id,
      encounterId: encounter.id!,
    })
  );

  const prepared = await prepareConsent(medplum, { input: serviceRequest } as never);
  check("Task created", Boolean(prepared?.task.id));
  check("Consent created (draft)", prepared?.consent.status === "draft");
  check("QuestionnaireResponse created (in-progress)", prepared?.questionnaireResponse.status === "in-progress");
  if (!prepared) {
    console.error("\nprepare-consent returned nothing — aborting rest of verification.");
    process.exit(1);
  }

  console.log("\n2. Contradiction → blocked Consent + urgent clinician Task");
  const contradictedQr = await medplum.updateResource({
    ...prepared.questionnaireResponse,
    status: "in-progress",
    item: answerItems({
      "procedure-identity": "understood",
      "tissue-treated": "contradicted",
      "risk-limitation": "understood",
    }),
  });
  const contradictedResult = await assessTeachback(medplum, { input: contradictedQr } as never);
  check("Consent still draft", contradictedResult?.consentStatus === "draft");
  check("Education task on-hold", contradictedResult?.taskStatus === "on-hold");
  check("Clinician task created", Boolean(contradictedResult?.clinicianTaskId));

  console.log("\n3. Corrected teach-back, final submission → Task completes, Consent activates");
  const correctedQr = await medplum.updateResource({
    ...contradictedQr,
    status: "completed",
    item: answerItems({
      "procedure-identity": "understood",
      "tissue-treated": "understood",
      "risk-limitation": "understood",
    }),
  });
  const correctedResult = await assessTeachback(medplum, { input: correctedQr } as never);
  check("Education task completed", correctedResult?.taskStatus === "completed");
  check("Consent active", correctedResult?.consentStatus === "active");
  check("No further clinician escalation", !correctedResult?.clinicianTaskId);

  // Assert the *stored* state, not just the returned summary: the escalation
  // opened in step 2 must actually be closed in Medplum, or the clinician's
  // unresolved-task queue still shows it after the demo's happy ending.
  const escalation = await medplum.readResource("Task", contradictedResult!.clinicianTaskId!);
  check("Earlier clinician escalation closed", escalation.status === "completed", `status=${escalation.status}`);

  console.log("\n4. Stray redelivery after activation is a no-op");
  const replayed = await assessTeachback(medplum, { input: correctedQr } as never);
  const consentAfterReplay = await medplum.readResource("Consent", prepared.consent.id!);
  const taskAfterReplay = await medplum.readResource("Task", prepared.task.id!);
  check("Consent still active", consentAfterReplay.status === "active");
  check("Education task still completed", taskAfterReplay.status === "completed");
  check("No escalation reopened", !replayed?.clinicianTaskId);

  console.log(`\n${failures === 0 ? "✅ all checks passed" : `❌ ${failures} check(s) failed`}`);
  console.log("\nRun `npm run reset` to clear this run before the next take.");
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ verify failed:", err);
  process.exit(1);
});
