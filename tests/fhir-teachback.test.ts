import assert from "node:assert/strict";
import test from "node:test";

import type { QuestionnaireResponse } from "@medplum/fhirtypes";
import type { TeachBackResult } from "@consentloop/shared";
import {
  COMPREHENSION_QUESTIONNAIRE_URL,
  buildPatient,
  buildPractitioner,
  buildServiceRequest,
  parseTeachBackResults,
  upsertTeachBackResult,
} from "@consentloop/fhir";

function emptyResponse(
  status: QuestionnaireResponse["status"] = "in-progress",
): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    id: "qr-test",
    questionnaire: COMPREHENSION_QUESTIONNAIRE_URL,
    status,
    item: [],
  };
}

function result(
  overrides: Partial<TeachBackResult> = {},
): TeachBackResult {
  return {
    conceptId: "tissue-treated",
    status: "contradicted",
    evidence: "The whole knee is being replaced.",
    misconception: "Believes this is a total knee replacement.",
    clarification: "Only the torn meniscus may be trimmed or repaired.",
    requiresClinician: true,
    ...overrides,
  };
}

test("upsertTeachBackResult creates a complete grouped answer without mutating input", () => {
  const before = emptyResponse();
  const snapshot = structuredClone(before);

  const after = upsertTeachBackResult(before, result());

  assert.deepEqual(before, snapshot);
  assert.notEqual(after, before);
  assert.equal(after.status, "in-progress");
  assert.deepEqual(parseTeachBackResults(after), [result()]);
});

test("a correction retains the original misconception and preserves sibling groups", () => {
  const procedureGroup = {
    linkId: "procedure-identity",
    item: [
      {
        linkId: "procedure-identity.status",
        answer: [{ valueCoding: { code: "partial" } }],
      },
      {
        linkId: "procedure-identity.evidence",
        answer: [{ valueString: "They will look inside with a camera." }],
      },
    ],
  };
  const contradicted = upsertTeachBackResult(
    { ...emptyResponse(), item: [procedureGroup] },
    result(),
  );

  const corrected = upsertTeachBackResult(
    contradicted,
    result({
      status: "understood",
      evidence: "Only the torn meniscus may be trimmed or repaired.",
      misconception: undefined,
      clarification: "The whole joint remains in place.",
      requiresClinician: false,
    }),
  );

  assert.deepEqual(corrected.item?.[0], procedureGroup);
  assert.deepEqual(parseTeachBackResults(corrected), [
    {
      conceptId: "procedure-identity",
      status: "partial",
      evidence: "They will look inside with a camera.",
      requiresClinician: false,
    },
    {
      conceptId: "tissue-treated",
      status: "understood",
      evidence: "Only the torn meniscus may be trimmed or repaired.",
      misconception: "Believes this is a total knee replacement.",
      clarification: "The whole joint remains in place.",
      requiresClinician: false,
    },
  ]);
});

test("teach-back updates never complete a response implicitly", () => {
  assert.equal(
    upsertTeachBackResult(emptyResponse("in-progress"), result()).status,
    "in-progress",
  );
  assert.equal(
    upsertTeachBackResult(emptyResponse("completed"), result()).status,
    "completed",
  );
});

test("FHIR fixtures match the patient UI and encode the affected side", () => {
  const patient = buildPatient();
  const practitioner = buildPractitioner();
  const serviceRequest = buildServiceRequest({
    patientId: "patient-1",
    practitionerId: "practitioner-1",
    encounterId: "encounter-1",
  });

  assert.deepEqual(patient.name?.[0], {
    given: ["Sam"],
    family: "Lee",
  });
  assert.deepEqual(practitioner.name?.[0], {
    given: ["Maya"],
    family: "Chen",
    prefix: ["Dr."],
  });
  assert.equal(serviceRequest.bodySite?.[0]?.text, "Right knee");
});
