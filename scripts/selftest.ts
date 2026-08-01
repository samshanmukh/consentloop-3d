/**
 * Runs the consent state machine against an in-memory fake Medplum, with
 * ZERO credentials. This is the fast feedback loop — `npm run selftest`
 * before every push. `npm run verify` is the same journey against the real
 * server, and is what actually proves the transport layer.
 *
 * What this proves: the workflow rules, the state transitions, the safety
 * invariants, and the Provenance trail are correct.
 * What this cannot prove: that Medplum's search parameters, reference
 * formats, and Bot runtime behave the way findSessionRefs assumes.
 */
import type { Resource, Task, Consent, QuestionnaireResponse, QuestionnaireResponseItem } from "@medplum/fhirtypes";
import type { MedplumClient } from "@medplum/core";
import { COMPREHENSION_STATUS_SYSTEM, COMPREHENSION_QUESTIONNAIRE_URL } from "@consentloop/fhir";
import { applyWorkflowRules, deriveConsentAction, parseComprehensionConcepts } from "@consentloop/fhir";
import { COMPREHENSION_CONCEPT_IDS, type ComprehensionStatus } from "@consentloop/shared";

let failures = 0;
function check(label: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

// ─── In-memory fake Medplum ─────────────────────────────────────────────────
// Only the four methods the state machine actually calls. Search support is
// deliberately narrow: `part-of` is the sole parameter findClinicianTask uses.

function makeFakeMedplum() {
  const store = new Map<string, Resource>();
  let counter = 0;

  const client = {
    async createResource<T extends Resource>(resource: T): Promise<T> {
      const id = `fake-${++counter}`;
      const saved = { ...resource, id } as T;
      store.set(`${resource.resourceType}/${id}`, saved);
      return saved;
    },
    async updateResource<T extends Resource>(resource: T): Promise<T> {
      if (!resource.id) throw new Error("updateResource requires an id");
      const key = `${resource.resourceType}/${resource.id}`;
      if (!store.has(key)) throw new Error(`updateResource on missing ${key}`);
      store.set(key, resource);
      return resource;
    },
    async readResource<T extends Resource>(resourceType: string, id: string): Promise<T> {
      const found = store.get(`${resourceType}/${id}`);
      if (!found) throw new Error(`readResource missing ${resourceType}/${id}`);
      return found as T;
    },
    async searchResources(resourceType: string, params: Record<string, string | number>): Promise<Resource[]> {
      const all = [...store.values()].filter((r) => r.resourceType === resourceType);
      const partOf = params["part-of"];
      if (typeof partOf === "string") {
        return all.filter((r) =>
          (r as Task).partOf?.some((p) => p.reference === partOf)
        );
      }
      return all;
    },
    _store: store,
  };

  return client as unknown as MedplumClient & { _store: Map<string, Resource> };
}

function qrWith(
  statuses: Partial<Record<(typeof COMPREHENSION_CONCEPT_IDS)[number], ComprehensionStatus>>,
  status: QuestionnaireResponse["status"]
): QuestionnaireResponse {
  const item: QuestionnaireResponseItem[] = COMPREHENSION_CONCEPT_IDS.map((conceptId) => ({
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
    ],
  }));
  return {
    resourceType: "QuestionnaireResponse",
    id: "qr-1",
    questionnaire: COMPREHENSION_QUESTIONNAIRE_URL,
    status,
    item,
  };
}

const ALL_UNDERSTOOD = {
  "procedure-identity": "understood",
  "tissue-treated": "understood",
  "risk-limitation": "understood",
} as const;

async function seedSession(medplum: MedplumClient) {
  const task = await medplum.createResource<Task>({
    resourceType: "Task",
    status: "requested",
    intent: "order",
    description: "Consent education",
  });
  const consent = await medplum.createResource<Consent>({
    resourceType: "Consent",
    status: "draft",
    scope: {},
    category: [],
  });
  return { task, consent };
}

async function main() {
  console.log("1. deriveConsentAction — pure classification\n");

  const parsedContradiction = parseComprehensionConcepts(
    qrWith({ ...ALL_UNDERSTOOD, "tissue-treated": "contradicted" }, "in-progress")
  );
  const contradictedAction = deriveConsentAction(parsedContradiction);
  check("contradiction blocks", contradictedAction.blocked);
  check("contradiction escalates", contradictedAction.needsClinician);
  check("contradiction is urgent", contradictedAction.urgent);

  const uncertainAction = deriveConsentAction(
    parseComprehensionConcepts(qrWith({ ...ALL_UNDERSTOOD, "risk-limitation": "uncertain" }, "in-progress"))
  );
  check("uncertainty blocks", uncertainAction.blocked);
  check("uncertainty escalates", uncertainAction.needsClinician);
  check("uncertainty is NOT urgent", !uncertainAction.urgent);

  const partialAction = deriveConsentAction(
    parseComprehensionConcepts(qrWith({ "procedure-identity": "understood" }, "in-progress"))
  );
  check("partial progress blocks", partialAction.blocked);
  check("partial progress does NOT escalate", !partialAction.needsClinician);
  check("partial progress is not allUnderstood", !partialAction.allUnderstood);

  const goodAction = deriveConsentAction(parseComprehensionConcepts(qrWith(ALL_UNDERSTOOD, "completed")));
  check("all understood is unblocked", !goodAction.blocked);
  check("all understood needs no clinician", !goodAction.needsClinician);

  console.log("\n2. Safety invariant — in-progress submission never activates Consent\n");
  {
    const medplum = makeFakeMedplum();
    const { task, consent } = await seedSession(medplum);
    const qr = qrWith(ALL_UNDERSTOOD, "in-progress");
    const result = await applyWorkflowRules(medplum, {
      task,
      consent,
      questionnaireResponse: qr,
      concepts: parseComprehensionConcepts(qr),
    });
    check("Consent stays draft on a mid-conversation snapshot", result.consentStatus === "draft");
    check("Education task still completes", result.taskStatus === "completed");
  }

  console.log("\n3. Full journey — contradiction → escalation → correction → activation\n");
  {
    const medplum = makeFakeMedplum();
    const { task, consent } = await seedSession(medplum);

    const badQr = qrWith({ ...ALL_UNDERSTOOD, "tissue-treated": "contradicted" }, "in-progress");
    const blocked = await applyWorkflowRules(medplum, {
      task,
      consent,
      questionnaireResponse: badQr,
      concepts: parseComprehensionConcepts(badQr),
    });
    check("Consent blocked", blocked.consentStatus === "draft");
    check("Education task on-hold", blocked.taskStatus === "on-hold");
    check("Clinician task opened", Boolean(blocked.clinicianTaskId));

    const escalation = await medplum.readResource("Task", blocked.clinicianTaskId!);
    check("Escalation is urgent", escalation.priority === "urgent");

    const freshTask = await medplum.readResource("Task", task.id!);
    const freshConsent = await medplum.readResource("Consent", consent.id!);
    const goodQr = qrWith(ALL_UNDERSTOOD, "completed");
    const resolved = await applyWorkflowRules(medplum, {
      task: freshTask,
      consent: freshConsent,
      questionnaireResponse: goodQr,
      concepts: parseComprehensionConcepts(goodQr),
    });
    check("Education task completed", resolved.taskStatus === "completed");
    check("Consent activated", resolved.consentStatus === "active");

    const closedEscalation = await medplum.readResource("Task", blocked.clinicianTaskId!);
    check("Earlier escalation closed", closedEscalation.status === "completed", `status=${closedEscalation.status}`);
  }

  console.log("\n4. Stray redelivery after activation is a no-op\n");
  {
    const medplum = makeFakeMedplum();
    const { task, consent } = await seedSession(medplum);
    const goodQr = qrWith(ALL_UNDERSTOOD, "completed");
    await applyWorkflowRules(medplum, {
      task,
      consent,
      questionnaireResponse: goodQr,
      concepts: parseComprehensionConcepts(goodQr),
    });

    const activeConsent = await medplum.readResource("Consent", consent.id!);
    const completedTask = await medplum.readResource("Task", task.id!);
    const badQr = qrWith({ ...ALL_UNDERSTOOD, "tissue-treated": "contradicted" }, "in-progress");
    const replay = await applyWorkflowRules(medplum, {
      task: completedTask,
      consent: activeConsent,
      questionnaireResponse: badQr,
      concepts: parseComprehensionConcepts(badQr),
    });
    check("Active consent is not reverted", replay.consentStatus === "active");
    check("Completed task is not reopened", replay.taskStatus === "completed");
    check("No escalation opened against a closed session", !replay.clinicianTaskId);
  }

  console.log("\n5. Provenance trail\n");
  {
    const medplum = makeFakeMedplum();
    const { task, consent } = await seedSession(medplum);
    const qr = qrWith({ ...ALL_UNDERSTOOD, "tissue-treated": "contradicted" }, "in-progress");
    await applyWorkflowRules(medplum, {
      task,
      consent,
      questionnaireResponse: qr,
      concepts: parseComprehensionConcepts(qr),
    });
    const provenance = [...medplum._store.values()].filter((r) => r.resourceType === "Provenance");
    check("Provenance written", provenance.length === 1);
    const p = provenance[0] as import("@medplum/fhirtypes").Provenance;
    check("Provenance targets the education Task", p.target?.some((t) => t.reference === `Task/${task.id}`) ?? false);
    check("Provenance targets the Consent", p.target?.some((t) => t.reference === `Consent/${consent.id}`) ?? false);
    check("Provenance cites the QuestionnaireResponse", p.entity?.[0]?.what?.reference === `QuestionnaireResponse/${qr.id}`);
  }

  console.log(`\n${failures === 0 ? "✅ all checks passed" : `❌ ${failures} check(s) failed`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ selftest crashed:", err);
  process.exit(1);
});
