import assert from "node:assert/strict";
import test from "node:test";
import type { SessionReadModel } from "../packages/fhir/session-read-model";
import { optionAwareSessionToSnapshot } from "../worker/medplum-option-workflow";

const version = "a".repeat(64);

function session(): SessionReadModel {
  return {
    patientId: "patient-sam",
    serviceRequestId: "request-1",
    procedure: "Knee arthroscopy review",
    status: "review",
    consentStatus: "draft",
    stale: false,
    optionSnapshotVersion: version,
    catalogVersion: "2026.08.demo",
    sourceCoverage: "Reviewed meniscal treatment paths.",
    blockers: ["Tissue being treated: partial"],
    options: [
      {
        id: "meniscus-repair",
        title: "Arthroscopic meniscus repair",
        summary: "Repair the meniscus when the tissue can heal.",
        expectedBenefits: ["Preserves tissue"],
        materialRisks: ["Repair can fail"],
        eligibilityQuestions: ["Is the tear repairable?"],
        recoveryConsiderations: ["Protected weight bearing"],
        evidence: [
          {
            id: "source-1",
            title: "Reviewed guidance",
            url: "https://example.com/guidance",
            jurisdiction: "US",
            publishedAt: "2026-01-01",
            reviewedAt: "2026-08-01",
            evidenceStrength: "moderate",
            regulatoryStatus: "Clinical guidance",
            claims: ["Preserve healthy tissue"],
          },
        ],
        clinicalStatus: "appropriate",
        availability: "available-here",
        questions: [
          {
            id: "question-1",
            kind: "question",
            text: "How long would I use crutches?",
            status: "open",
            requestedBy: "Patient/patient-sam",
            createdAt: "2026-08-01T12:00:00.000Z",
          },
        ],
      },
    ],
    comprehension: [
      {
        id: "procedure-identity",
        title: "Procedure identity",
        critical: true,
        status: "understood",
        sceneId: "arthroscope-insertion",
      },
      {
        id: "tissue-treated",
        title: "Tissue being treated",
        critical: true,
        status: "partial",
        sceneId: "damaged-meniscus",
      },
      {
        id: "risk-limitation",
        title: "Important limitation or risk",
        critical: true,
        status: "not-discussed",
        sceneId: "treated-region",
      },
    ],
    teachBackResults: [
      {
        conceptId: "tissue-treated",
        status: "partial",
        evidence: "The meniscus is involved.",
        requiresClinician: false,
      },
    ],
    diagnosticSummaries: [
      { reference: "DiagnosticReport/mri-1", conclusion: "Meniscus tear" },
    ],
    tasks: [{ id: "task-1", status: "on-hold", description: "Education" }],
    events: [
      {
        timestamp: "2026-08-01T12:00:00.000Z",
        resourceType: "Provenance",
        resourceId: "event-1",
        action: "prepare-consent",
        summary: "Session prepared",
        resource: { resourceType: "Provenance", id: "event-1" },
      },
    ],
    resourceIds: {
      serviceRequest: "ServiceRequest/request-1",
      carePlan: "CarePlan/care-plan-1",
      educationTask: "Task/task-1",
      consent: "Consent/consent-1",
      questionnaireResponse: "QuestionnaireResponse/response-1",
    },
  };
}

test("maps the option-aware Medplum session into the existing patient API", () => {
  const snapshot = optionAwareSessionToSnapshot(
    session(),
    "2026-08-01T12:01:00.000Z",
  );

  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.source, "medplum");
  assert.equal(snapshot.patientId, "patient-sam");
  assert.equal(snapshot.workflowStatus, "review");
  assert.equal(snapshot.taskStatus, "on-hold");
  assert.equal(snapshot.optionSnapshotVersion, version);
  assert.equal(snapshot.treatmentOptions?.[0]?.id, "meniscus-repair");
  assert.deepEqual(snapshot.unresolvedQuestions, ["How long would I use crutches?"]);
  assert.equal(snapshot.concepts["tissue-treated"].status, "partial");
  assert.equal(
    snapshot.concepts["tissue-treated"].evidence,
    "The meniscus is involved.",
  );
});
