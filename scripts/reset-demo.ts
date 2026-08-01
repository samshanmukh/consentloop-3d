/**
 * Fast reset between demo takes: wipes the ServiceRequest/Task/Consent/
 * QuestionnaireResponse/Provenance from the last run, leaves the seeded
 * Patient/Practitioner/Questionnaire alone. Safe to wire directly to the
 * clinician dashboard's "Reset demo" button (call resetDemoRun from
 * @consentloop/fhir instead of shelling out to this script, if calling from
 * a server route — this file is the CLI entry point for local use).
 *
 *   npm run reset
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();
requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);

import { getMedplum, resetDemoRun } from "@consentloop/fhir";

async function main() {
  const medplum = await getMedplum();
  console.log("→ connected to Medplum\n");
  await resetDemoRun(medplum);
  console.log("\n✅ demo run reset — seeded patient/practitioner untouched");
  console.log("Next: npm run create-order");
}

main().catch((err) => {
  console.error("\n❌ reset failed:", err);
  process.exit(1);
});
