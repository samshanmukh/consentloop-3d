# Person 1 — Medplum / FHIR workflow

**This lane has been run end-to-end against a real Medplum server** (v5.1.27,
self-hosted locally) — real Bots, real Subscriptions, real Consent lifecycle.
The full demo script works. What's left is pointing it at *your* project.

```bash
npm install
npm run selftest      # 27 checks, no credentials needed — run this first
```

If `selftest` is green, the consent state machine is correct. Everything
below is about connecting it to a real server.

## Verified live

The complete demo path, driven entirely by Medplum automation:

```
ServiceRequest created
  → Subscription fired
  → prepare-consent Bot ran
  → Task(requested) + Consent(draft) + QuestionnaireResponse(in-progress) + Provenance
Teach-back written with "tissue-treated: contradicted"
  → Subscription fired
  → assess-teachback Bot ran
  → education Task → on-hold, clinician Task created (urgent), Consent HELD at draft
Corrected teach-back written, QuestionnaireResponse → completed
  → assess-teachback Bot ran
  → education Task → completed, escalation → completed, Consent → ACTIVE
```

`getConsentSession`, `listComprehensionConcepts`, and `listConsentEvents` were
all confirmed against this live data — the event stream returned 8 events
spanning all three bot invocations, each carrying its real FHIR resource body.

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
| Seed / reset scripts | ✅ verified against a live server |
| Bot deploy + Subscriptions wiring | ✅ verified against a live server |
| Read models for both UIs | ✅ verified against a live server |
| **Your team's Medplum project** | ❌ **needs a human — see below** |

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

## Two project settings you must enable first

Both of these were found the hard way. Neither is a code problem, and both
are silent-ish failures.

**1. Bots must be enabled on the project.** Otherwise `$deploy` returns
`Bots not enabled`. On a hosted medplum.com project this is a plan/feature
setting — if you don't see Bots in the console, contact Medplum (they enable
it for hackathons readily).

**2. The ClientApplication needs *admin* on its ProjectMembership.** Bot
creation goes through `admin/projects/{id}/bot`, which requires an admin
membership; without it you get a bare `Forbidden`. In the console:
Admin → Clients → your client → check **Admin**.

If you'd rather not grant that, create both bots by hand in the console
instead — the names must match exactly, or `setup:subscriptions` won't find
them:

- `consentloop-prepare-consent`
- `consentloop-assess-teachback`

(Defined in `packages/fhir/src/constants.ts`.)

## What will probably break, and what to do

**`deploy:bots` fails.** The script distinguishes *creating* the Bot from
*uploading the code* and prints Medplum's real `OperationOutcome` text. Both
paths are verified working, so a failure here is almost certainly one of the
two project settings above. Fallback that always works:

```bash
npm run deploy:bots -- --print
```

Copy the output, paste into Project → Bots → (bot) → Editor, hit Deploy.

**Bot runtime version.** Hosted medplum.com runs `awslambda` (the default
here); self-hosted usually runs `vmcontext`. Override with
`MEDPLUM_BOT_RUNTIME=vmcontext` in `.env.local`. Getting this wrong fails at
*execution* time, not deploy time.

**The subscription fires but nothing happens.** Check
Project → Bots → (bot) → the AuditEvent log, not the server log — bot runtime
errors are recorded there and the Subscription job still reports
`completed`. This is how the `exports.handler is not a function` bundling bug
was found; it's fixed (see the footer in `scripts/deploy-bots.ts`), but the
same diagnostic applies to anything else that goes wrong inside a bot.

**Frontend can't read resources.** The browser client
(`VITE_MEDPLUM_CLIENT_ID`) needs an AccessPolicy allowing reads on Patient,
ServiceRequest, Task, Consent, QuestionnaireResponse, Provenance. Console
step, not a code change.

## FHIR gotchas already handled

Recorded because they cost real debugging time and would silently re-break if
someone "simplifies" the code:

- **`Consent` requires `policy` or `policyRule`** (invariant `ppc-1`). A
  Consent with neither is rejected outright. We set `policy[0].uri` to
  `CONSENT_POLICY_URI`.
- **`Consent.sourceReference` cannot point at a `ServiceRequest`.** Legal
  targets are Consent, DocumentReference, Contract, QuestionnaireResponse.
  Ours points at the QuestionnaireResponse, which is why prepare-consent
  creates the QuestionnaireResponse *before* the Consent, and why Consent
  lookups go through the QuestionnaireResponse rather than the ServiceRequest.
- **Bots need a `ProjectMembership` to execute.** `createResource("Bot")`
  does not create one; the admin endpoint does. Without it every invocation
  dies with `Could not find project membership for bot`.

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
