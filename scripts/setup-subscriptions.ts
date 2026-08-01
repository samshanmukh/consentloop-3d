/**
 * Wires the two Subscriptions to the two deployed Bots. Run after
 * `npm run deploy:bots` — looks bots up by name (BOT_TAG), no ids to paste.
 *
 *   npm run setup:subscriptions
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();
requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);

import type { Subscription } from "@medplum/fhirtypes";
import {
  getMedplum,
  SUBSCRIPTION_TAG,
  PREPARE_CONSENT_BOT_NAME,
  ASSESS_TEACHBACK_BOT_NAME,
  PREPARE_CONSENT_SUBSCRIPTION_REASON,
  ASSESS_TEACHBACK_SUBSCRIPTION_REASON,
  COMPREHENSION_QUESTIONNAIRE_URL,
} from "@consentloop/fhir";

const SUBSCRIPTIONS = [
  {
    botName: PREPARE_CONSENT_BOT_NAME,
    criteria: "ServiceRequest?status=active",
    reason: PREPARE_CONSENT_SUBSCRIPTION_REASON,
  },
  {
    botName: ASSESS_TEACHBACK_BOT_NAME,
    criteria: `QuestionnaireResponse?questionnaire=${COMPREHENSION_QUESTIONNAIRE_URL}`,
    reason: ASSESS_TEACHBACK_SUBSCRIPTION_REASON,
  },
];

async function main() {
  const medplum = await getMedplum();
  console.log("→ connected to Medplum\n");

  for (const sub of SUBSCRIPTIONS) {
    const bots = await medplum.searchResources("Bot", { name: sub.botName, _count: 1 });
    const bot = bots[0];
    if (!bot?.id) {
      console.error(`✗ no deployed Bot named ${sub.botName} — run npm run deploy:bots first`);
      process.exitCode = 1;
      continue;
    }

    const existing = await medplum.searchResources("Subscription", {
      _tag: `${SUBSCRIPTION_TAG.system}|${SUBSCRIPTION_TAG.code}`,
      criteria: sub.criteria,
      _count: 1,
    });

    const payload: Subscription = {
      resourceType: "Subscription",
      meta: { tag: [SUBSCRIPTION_TAG] },
      status: "active",
      reason: sub.reason,
      criteria: sub.criteria,
      channel: {
        type: "rest-hook",
        endpoint: `Bot/${bot.id}`,
        payload: "application/fhir+json",
      },
    };

    if (existing[0]?.id) {
      await medplum.updateResource({ ...payload, id: existing[0].id });
      console.log(`updated Subscription for ${sub.criteria} → Bot/${bot.id}`);
    } else {
      const created = await medplum.createResource(payload);
      console.log(`created Subscription ${created.id} for ${sub.criteria} → Bot/${bot.id}`);
    }
  }

  console.log("\nNext: npm run create-order   (fires the live workflow)");
}

main().catch((err) => {
  console.error("\n❌ subscription setup failed:", err);
  process.exit(1);
});
