import type {
  Patient,
  Practitioner,
  Encounter,
  ServiceRequest,
} from "@medplum/fhirtypes";
import { KNEE_ARTHROSCOPY_CODE, SEED_TAG, RUN_TAG } from "./constants";

/** Synthetic demo patient. No real PHI — this ships to git. */
export function buildPatient(): Patient {
  return {
    resourceType: "Patient",
    meta: { tag: [SEED_TAG] },
    name: [{ given: ["Sam"], family: "Lee" }],
    gender: "unknown",
    birthDate: "1988-09-02",
    telecom: [{ system: "phone", value: "555-0199", use: "mobile" }],
    communication: [
      {
        language: {
          coding: [{ system: "urn:ietf:bcp:47", code: "en", display: "English" }],
        },
        preferred: true,
      },
    ],
  };
}

export function buildPractitioner(): Practitioner {
  return {
    resourceType: "Practitioner",
    meta: { tag: [SEED_TAG] },
    name: [{ given: ["Maya"], family: "Chen", prefix: ["Dr."] }],
    qualification: [{ code: { text: "Orthopedic Surgery" } }],
  };
}

export function buildEncounter(ids: {
  patientId: string;
  practitionerId: string;
}): Encounter {
  return {
    resourceType: "Encounter",
    meta: { tag: [RUN_TAG] },
    status: "in-progress",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    subject: { reference: `Patient/${ids.patientId}` },
    participant: [
      {
        individual: { reference: `Practitioner/${ids.practitionerId}` },
      },
    ],
    reasonCode: [{ text: "Pre-procedure informed consent" }],
  };
}

/** The order that kicks off the whole workflow via the ServiceRequest Subscription. */
export function buildServiceRequest(ids: {
  patientId: string;
  practitionerId: string;
  encounterId: string;
}): ServiceRequest {
  return {
    resourceType: "ServiceRequest",
    meta: { tag: [RUN_TAG] },
    status: "active",
    intent: "order",
    code: { coding: [KNEE_ARTHROSCOPY_CODE], text: KNEE_ARTHROSCOPY_CODE.display },
    subject: { reference: `Patient/${ids.patientId}` },
    encounter: { reference: `Encounter/${ids.encounterId}` },
    requester: { reference: `Practitioner/${ids.practitionerId}` },
    bodySite: [{ text: "Right knee" }],
    authoredOn: new Date().toISOString(),
    reasonCode: [{ text: "Symptomatic medial meniscus tear, confirmed on MRI" }],
  };
}
