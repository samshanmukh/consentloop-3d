import type { MedplumClient } from "@medplum/core";
import type { ResourceType } from "@medplum/fhirtypes";
import { SEED_TAG, RUN_TAG } from "./constants";

async function wipeTag(
  medplum: MedplumClient,
  tag: { system: string; code: string },
  resourceTypes: ResourceType[]
): Promise<void> {
  const tagFilter = `${tag.system}|${tag.code}`;
  for (const resourceType of resourceTypes) {
    const found = await medplum.searchResources(resourceType, {
      _tag: tagFilter,
      _count: 100,
    });
    for (const r of found) {
      if (r.id) await medplum.deleteResource(resourceType, r.id);
    }
    if (found.length) console.log(`  wiped ${found.length} ${resourceType}`);
  }
}

/**
 * Wipes everything created during a demo run (order, session, workflow
 * state) but leaves the seeded Patient/Practitioner/Questionnaire in place —
 * this is what the clinician dashboard's "Reset demo" button should call
 * between takes, since re-seeding the patient every time is unnecessary and
 * slower than it needs to be live.
 */
export async function resetDemoRun(medplum: MedplumClient): Promise<void> {
  await wipeTag(medplum, RUN_TAG, [
    "Provenance",
    "Consent",
    "Task",
    "QuestionnaireResponse",
    "ServiceRequest",
    "Encounter",
  ]);
}

/** Wipes the durable seed fixtures. Only `seed-demo` should call this. */
export async function wipeSeedFixtures(medplum: MedplumClient): Promise<void> {
  await wipeTag(medplum, SEED_TAG, ["Questionnaire", "Patient", "Practitioner"]);
}
