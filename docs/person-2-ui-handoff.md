# Person 2 UI handoff

This document describes the synthetic, demo-first frontend now implemented in
this repository and the seams Person 1 and Person 3 can integrate against.

## What is implemented

The patient experience is a single responsive application with seven directly
reachable views:

1. Overview
2. Interactive procedure
3. Options comparison
4. Timeline and recovery plan
5. Cost details
6. Teach-back
7. Review and FHIR event summary

The demo uses Jordan Lee's synthetic right-meniscus scenario. Patient
preferences, estimate acknowledgement, teach-back states, voice-demo states,
and recovery-support conflicts are local UI state. No real patient information
is stored or transmitted.

## Person 1: Medplum/data integration

Replace the exports in `app/lib/demo-data.ts` with a data adapter that maps
Medplum resources into the existing UI shapes. Suggested resource boundaries:

| UI data | FHIR source |
| --- | --- |
| Patient and procedure context | `Patient`, `ServiceRequest`, `Encounter` |
| Approved choices | versioned procedure-content artifact referenced by `ServiceRequest` |
| Appointment windows | `Appointment`, `Schedule`, `HealthcareService` |
| Preferences and priorities | `QuestionnaireResponse` |
| Recovery-support escalation | `Task` |
| Coverage context | `Coverage`, `CoverageEligibilityResponse` |
| Pre-service estimate | versioned payer/facility estimate artifact |
| Final consent state | `Consent` |
| Traceability | `Provenance`, `AuditEvent` |

Keep the UI's safety invariants when wiring real data:

- only clinician-approved options may appear;
- cost and appointment availability never hide a clinically reasonable option;
- a recorded preference is not consent;
- stale clinical or financial snapshots must be invalidated before signature;
- unresolved critical teach-back concepts keep consent blocked.

The demo uses the canonical `ComprehensionConceptId` and
`ComprehensionStatus` types from `@consentloop/shared`, including
`not-discussed`. The UI may keep richer view state, but the persistence adapter
should write Person 1's shared concept IDs directly.

## Person 3: voice-to-3D integration

The viewer accepts a versioned semantic command rather than a raw transcript or
Three.js mesh name. The public contract lives in `app/lib/viz-contract.ts`.

The browser bridge exposes both a direct API and DOM events:

```ts
const result = await window.consentLoopViz?.execute({
  schema: "consentloop.viz-command.v1",
  id: crypto.randomUUID(),
  issuedAt: new Date().toISOString(),
  source: {
    kind: "voice",
    sessionId: "DEMO-CL-042",
    utterance: "Show me the damaged part",
    confidence: 0.96,
  },
  action: {
    type: "target.isolate",
    targets: ["anatomy.meniscus.tear"],
    contextOpacity: 0.2,
  },
});
```

Equivalent event bridge:

```ts
window.dispatchEvent(
  new CustomEvent("consentloop:viz-command", { detail: command }),
);

window.addEventListener("consentloop:viz-result", (event) => {
  const result = (event as CustomEvent).detail;
  console.log(result.status, result.stateRevision);
});
```

Valid targets and aliases are published at
`window.consentLoopViz.capabilities`. Resolve a transcript against that
manifest and send only supported semantic IDs. Unknown targets and unsupported
actions are rejected. Duplicate command IDs are not applied twice.

Person 3 can also send the frozen `SceneCommand` type from
`@consentloop/shared` without knowing the versioned renderer shape:

```ts
await window.consentLoopViz?.executeSceneCommand({
  type: "focus",
  target: "meniscus",
});

window.dispatchEvent(
  new CustomEvent("consentloop:scene-command", {
    detail: { type: "animate", animation: "arthroscope insertion" },
  }),
);
```

`sceneCommandToVizCommand` in `app/lib/viz-contract.ts` is the explicit adapter
between the frozen team contract and the renderer's versioned capabilities.

Visualization commands are intentionally unable to choose a procedure, accept
a cost estimate, schedule an appointment, or sign consent.

## 3D model

The primary knee anatomy asset is stored at
`public/models/knee/anatomy.glb`. It includes separately named bones, menisci,
ligaments, cartilage, tendons, and other tissues. A procedural knee remains as
the loading fallback and provides the arthroscope/recovery overlays.

The asset is licensed CC BY-SA 4.0. Attribution and source links are in
`public/models/knee/ATTRIBUTION.md`. It is an illustrative educational model,
not a diagnostic or surgical-planning tool.

## Local checks

```bash
npm run dev
npm run lint
npm test
npm run selftest
./node_modules/.bin/tsc --noEmit --incremental false
```

The production build targets the existing Vinext/Cloudflare Worker scaffold.
