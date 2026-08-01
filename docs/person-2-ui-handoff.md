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
preferences, estimate acknowledgement, teach-back states, live voice-session
state, and recovery-support conflicts are local UI state. No real patient
information is stored in the frontend.

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

Person 3's first live integration is implemented with `@deepgram/agents`. The
browser never receives `DEEPGRAM_API_KEY`; the Worker route
`GET /api/deepgram-token` returns only a short-lived Deepgram grant. Add the
key to `.env` for local Vinext/Cloudflare development and configure the same
server-side runtime variable in hosting. Do not use a `VITE_` or
`NEXT_PUBLIC_` prefix.

The voice guide is persistent across all seven views and begins only after the
patient presses **Start voice**. Its lifecycle is driven by real SDK events:
connecting, listening, thinking, speaking, reconnecting, stopped, or error.
Speech playback is interrupted when the user begins talking, and typed input
is available without a microphone.

The agent exposes only read-only client tools:

| Tool | UI effect | Explicit non-effect |
| --- | --- | --- |
| `open_consent_section` | Opens one of the seven journey views | Does not complete a step |
| `focus_anatomy` | Opens Procedure, waits for the viewer bridge, and focuses a semantic target | Does not accept raw mesh names |
| `preview_procedure_step` | Opens Procedure and runs an approved arthroscopy scene | Does not imply that step will occur |
| `focus_option` | Opens Options and highlights therapy, possible trim, or possible repair | Does not record a preference |
| `request_human` | Prepares a clinician, scheduler, or financial-help handoff in the UI | Does not send, schedule, or authorize anything |

Function responses are returned to Deepgram only after the local UI action is
validated. Unknown functions and invalid arguments receive structured errors.
The agent must call a tool before saying it changed the screen.

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

The viewer starts at `anatomy.body`. Commands that select the knee, meniscus,
tear, ligaments, portals, or a non-overview procedure stage automatically move
the camera into the right knee. A body command returns to whole-person
orientation:

```ts
await window.consentLoopViz?.execute({
  schema: "consentloop.viz-command.v1",
  id: crypto.randomUUID(),
  issuedAt: new Date().toISOString(),
  source: { kind: "voice", utterance: "Show the whole person" },
  action: { type: "target.select", targets: ["anatomy.body"] },
});
```

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

## 3D models

The whole-body orientation asset is stored at
`public/models/body/anatomy.glb`. It is a Draco-compressed muscular BodyParts3D
model with 418 structures. The renderer rotates, normalizes, recolors, and
merges those structures at runtime to reduce draw calls. Its right-knee anchor
is the transition point for the detailed joint scene.

The body asset is CC BY-SA 2.1 Japan. Attribution, upstream source, and a record
of runtime modifications are in `public/models/body/ATTRIBUTION.md`.

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
