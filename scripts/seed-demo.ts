/**
 * Seeds the durable demo fixtures — Practitioner, Patient, comprehension
 * Questionnaire — into Medplum.
 *
 *   npm run seed
 *
 * Idempotent: wipes anything already tagged `seed` (and any leftover
 * `demo-run` resources) first, so it's safe to run repeatedly. Does NOT
 * create the ServiceRequest — that's the visible "order the procedure" demo
 * step, run separately via `npm run create-order`.
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();
requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);

import { getMedplum, wipeSeedFixtures, resetDemoRun, buildPatient, buildPractitioner } from "@consentloop/fhir";
import { buildComprehensionQuestionnaire } from "@consentloop/fhir";

async function main() {
  const medplum = await getMedplum();
  console.log("→ connected to Medplum\n");

  console.log("wiping previous demo run and seed…");
  await resetDemoRun(medplum);
  await wipeSeedFixtures(medplum);

  const practitioner = await medplum.createResource(buildPractitioner());
  const patient = await medplum.createResource(buildPatient());
  const questionnaire = await medplum.createResource(buildComprehensionQuestionnaire());

  console.log("\n✅ seed complete\n");
  console.log("── paste into .env.local if your scripts need fixed ids ──");
  console.log(`SEED_PATIENT_ID=${patient.id}`);
  console.log(`SEED_PRACTITIONER_ID=${practitioner.id}`);
  console.log(`SEED_QUESTIONNAIRE_ID=${questionnaire.id}`);
  console.log("───────────────────────────────────────────────────────────");
  console.log("\nNext: npm run create-order   (fires the ServiceRequest Subscription)");
}

main().catch((err) => {
  console.error("\n❌ seed failed:", err);
  process.exit(1);
});
