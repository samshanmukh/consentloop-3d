import type { MedplumClient } from "@medplum/core";
import type { Provenance } from "@medplum/fhirtypes";
import { RUN_TAG } from "./constants";

/**
 * One Provenance per workflow-rule decision, pointing at everything the
 * decision touched. `derivedFromRef` is the resource that triggered the bot
 * (the ServiceRequest or QuestionnaireResponse) — the audit trail the
 * clinician dashboard's event stream and README's safety principles depend on.
 */
export async function createProvenance(
  medplum: MedplumClient,
  args: {
    targetRefs: string[];
    activityText: string;
    agentDisplay: string;
    derivedFromRef?: string;
  }
): Promise<Provenance> {
  return medplum.createResource<Provenance>({
    resourceType: "Provenance",
    meta: { tag: [RUN_TAG] },
    target: args.targetRefs.map((reference) => ({ reference })),
    recorded: new Date().toISOString(),
    activity: { text: args.activityText },
    agent: [{ who: { display: args.agentDisplay } }],
    entity: args.derivedFromRef
      ? [{ role: "source", what: { reference: args.derivedFromRef } }]
      : undefined,
  });
}
