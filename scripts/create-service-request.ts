/**
 * The visible "clinician orders the procedure" demo step — creates the
 * Encounter + knee-arthroscopy ServiceRequest for the seeded patient, which
 * fires the prepare-consent Subscription live.
 *
 *   npm run create-order
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();
requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);

import {
  getMedplum,
  SEED_TAG,
  buildEncounter,
  buildServiceRequest,
} from "@consentloop/fhir";

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
    throw new Error("No seeded Patient/Practitioner found — run `npm run seed` first.");
  }

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

  console.log("✅ ServiceRequest created — the prepare-consent Subscription should fire now.\n");
  console.log(`ServiceRequest/${serviceRequest.id}`);
  console.log(`Encounter/${encounter.id}`);
  console.log(`Patient/${patient.id}`);
  console.log("\nCheck Project > Task / Consent / QuestionnaireResponse in the Medplum console, or run npm run verify.");
}

main().catch((err) => {
  console.error("\n❌ create-order failed:", err);
  process.exit(1);
});
