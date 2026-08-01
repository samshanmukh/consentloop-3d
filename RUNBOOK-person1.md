# Person 1: Medplum workflow runbook

The Person 1 implementation creates an evidence-labelled option snapshot for a knee-arthroscopy order, records patient preferences and referral questions, verifies teach-back, blocks unsafe consent transitions, and preserves FHIR provenance and audit history.

## Configure

Copy `.env.example` to `.env` and provide a confidential-client application with Bot execution access:

```dotenv
MEDPLUM_BASE_URL=https://api.medplum.com/
MEDPLUM_CLIENT_ID=
MEDPLUM_CLIENT_SECRET=
```

Keep these values server-side. Do not expose them through `VITE_` or `NEXT_PUBLIC_` variables.

## Verify locally

```bash
npm install
npm run test:fhir
```

## Deploy and test against Medplum

```bash
npm run deploy:bots
npm run smoke:prepare
npm run smoke:full
```

`deploy:bots` upserts both Bots and their Subscriptions. Because some Medplum projects do not dispatch matching Subscriptions reliably, the trusted workflow explicitly calls the same Bots through `$execute` after writing each triggering resource. The Bots remain the validation and transaction boundary; the fallback only replaces event delivery.

`smoke:full` resets tagged synthetic resources, seeds the complete Arjun knee journey, exercises all four care paths, referral resolution, comprehension escalation and correction, stale-snapshot review, signature, read models, provenance, audit events, and idempotency checks.

## Demo care paths

1. Structured rehabilitation and reassessment
2. Arthroscopic meniscus repair
3. Arthroscopic partial meniscectomy
4. Regenerative or stem-cell specialist review

The fourth path is labelled as referral-only and requiring specialist/regulatory review; it is not represented as established routine care.

## Reset

```bash
npm run reset:demo
```

Reset only removes resources carrying the exact synthetic demo tag and never removes Bot or Subscription infrastructure.
