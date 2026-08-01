# Person 1 — Medplum / FHIR workflow

Everything in this lane is written, typechecked, and logic-verified. The one
thing left needs a human with a browser: creating the Medplum project.

```bash
npm install
npm run selftest      # 27 checks, no credentials needed — run this first
```

If `selftest` is green, the consent state machine is correct. Everything
below is about connecting it to a real server.

---

## What's done

| Area | Status |
|---|---|
| Shared TS contracts (`packages/shared`) | ✅ done — everyone imports these |
| Patient / Practitioner / Encounter / ServiceRequest fixtures | ✅ done |
| Comprehension `Questionnaire` | ✅ done — 3 concepts, 5-status answer set |
| prepare-consent Bot | ✅ written, logic verified |
| assess-teachback Bot | ✅ written, logic verified |
| Consent state machine | ✅ verified — 27 selftest checks |
| `Provenance` on every state change | ✅ verified |
| Seed / reset scripts | ✅ written, unrun against live server |
| Subscriptions wiring | ✅ written, unrun against live server |
| Read models for both UIs | ✅ written, unrun against live server |
| **Live Medplum project** | ❌ **needs a human — see below** |

---

## The one remaining step (~30 min)

### 1. Create the project

1. `app.medplum.com` → sign up → create a project
2. Admin → **Client Applications** → Create
3. `cp .env.local.example .env.local`, paste in the client ID + secret

### 2. Run the chain

```bash
npm run seed                  # Patient, Practitioner, Questionnaire
npm run deploy:bots           # bundles + uploads both bots
npm run setup:subscriptions   # wires ServiceRequest + QuestionnaireResponse triggers
npm run verify                # full journey against the real server
```

`npm run verify` is the real proof. It should print all ✓ and end with
`✅ all checks passed`.

### 3. Then the live demo path

```bash
npm run reset          # clears the run, keeps the seeded patient
npm run create-order   # fires the Subscription for real
```

Watch Project → Task / Consent / QuestionnaireResponse in the console.

---

## What will probably break, and what to do

**`deploy:bots` fails.** This is the single unverified API surface in the
repo — no one has run `Bot/$deploy` against a live project. The script tells
you whether *creating* the Bot or *uploading the code* failed, and prints
Medplum's actual `OperationOutcome` text rather than a raw error.

Either way the bot logic is fine (selftest proves it). Fallback:

```bash
npm run deploy:bots -- --print
```

Copy the output, paste into Project → Bots → (bot) → Editor, hit Deploy.
Two minutes, zero API guessing.

**`setup:subscriptions` says it can't find a Bot.** It looks bots up by name.
If you created them by hand, the names must match exactly:

- `consentloop-prepare-consent`
- `consentloop-assess-teachback`

(Both defined in `packages/fhir/src/constants.ts`.)

**`verify` fails on a search parameter.** The search params
(`focus`, `part-of`, `source-reference`, `based-on`) are standard FHIR R4, but
if Medplum indexes one differently, `packages/fhir/src/session.ts` is the only
file that changes — the bots and state machine don't do their own searching.

**Frontend can't read resources.** The browser client
(`VITE_MEDPLUM_CLIENT_ID`) needs an AccessPolicy allowing reads on Patient,
ServiceRequest, Task, Consent, QuestionnaireResponse, Provenance. That's a
console step, not a code change.

---

## For Person 2 and Person 3

**Import the contracts now — don't wait for the Medplum project.**

```ts
import type {
  ConsentSession, ComprehensionConcept, ConsentEvent,
  TeachBackResult, SceneCommand,
} from "@consentloop/shared";
import { CONCEPT_DEFINITIONS } from "@consentloop/shared";
```

`CONCEPT_DEFINITIONS` maps each concept id to its title and `sceneId`, so
Person 2's scene picker and Person 3's evaluator key off the same ids the
Questionnaire uses. Nothing can drift.

**Person 3 — writing teach-back results.** Update the session
`QuestionnaireResponse` with grouped items:

```
item[linkId = "tissue-treated"]
  item[linkId = "tissue-treated.status"]        answer.valueCoding.code = "contradicted"
  item[linkId = "tissue-treated.evidence"]      answer.valueString      = "<patient's words>"
  item[linkId = "tissue-treated.misconception"] answer.valueString      = "<what they got wrong>"
```

Status must be one of: `understood`, `partial`, `contradicted`, `uncertain`,
`not-discussed`.

⚠️ **Keep `QuestionnaireResponse.status` as `in-progress` until the session is
truly finished.** Consent only activates on `completed` + all-understood. This
is the safety invariant — a mid-conversation snapshot that happens to look
good must never activate consent. Don't set `completed` to "make it work."

**Person 3 — clinician dashboard.** Three functions, all in
`packages/fhir/src/session.ts`:

```ts
getConsentSession(medplum, patientId)          // → ConsentSession
listComprehensionConcepts(medplum, qrId)       // → ComprehensionConcept[]
listConsentEvents(medplum, patientId)          // → ConsentEvent[] (event stream)
```

`ConsentEvent.resource` carries the real FHIR JSON for the expand-to-JSON view.

**"Reset demo" button:** call `resetDemoRun(medplum)` from `@consentloop/fhir`
rather than shelling out to the script. It clears the run and leaves the
seeded patient alone, so it's fast enough to hit between takes.

---

## Workflow rules (what the state machine actually does)

| Teach-back outcome | Education Task | Consent | Clinician Task |
|---|---|---|---|
| Any concept `contradicted` | `on-hold` | stays `draft` | created, **urgent** |
| Any concept `uncertain` | `on-hold` | stays `draft` | created, routine |
| Some concepts unanswered | `in-progress` | stays `draft` | — |
| All `understood`, QR `in-progress` | `completed` | **stays `draft`** | closed if open |
| All `understood`, QR `completed` | `completed` | **`active`** | closed if open |

Two safety properties, both covered by selftest:

1. **Consent never activates on a mid-conversation snapshot.** It requires a
   final (`completed`) submission, not just a good-looking evaluation.
2. **Consent is a one-way door.** Once active, a redelivered
   QuestionnaireResponse can't reopen the Task or revert the Consent —
   Subscriptions can and do redeliver.
