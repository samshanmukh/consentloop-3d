/**
 * Bundles each bot (resolving the @consentloop/* workspace imports so the
 * Medplum bot runtime doesn't need to) and deploys it as a Medplum Bot
 * resource.
 *
 *   npm run deploy:bots            # create/update + deploy both bots
 *   npm run deploy:bots -- --print # bundle only, print sizes, deploy nothing
 *
 * ─── VERIFY THE $deploy SHAPE AGAINST MEDPLUM'S DOCS BEFORE TRUSTING IT ───
 * Bot creation + the `Bot/$deploy` operation are the one part of this repo
 * nobody has exercised against a live project yet. If `$deploy` 400s or the
 * body shape below is stale, this file — and only this file — is what
 * changes; check app.medplum.com's "Bots" documentation and the
 * medplum-demo-bots example repo for the current contract.
 *
 * Fallback if this keeps failing under time pressure: run with `--print`,
 * copy the bundled code, and paste it into Project > Bots > (bot) > Editor
 * in the console manually — same result, zero API guessing.
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();

import { build } from "esbuild";
import { resolve } from "node:path";
import type { Bot } from "@medplum/fhirtypes";
import {
  getMedplum,
  BOT_TAG,
  PREPARE_CONSENT_BOT_NAME,
  ASSESS_TEACHBACK_BOT_NAME,
} from "@consentloop/fhir";

const BOTS = [
  {
    name: PREPARE_CONSENT_BOT_NAME,
    entry: "bots/prepare-consent/src/index.ts",
    description:
      "Creates the consent-education session when a knee-arthroscopy ServiceRequest goes active.",
  },
  {
    name: ASSESS_TEACHBACK_BOT_NAME,
    entry: "bots/assess-teachback/src/index.ts",
    description:
      "Applies comprehension workflow rules whenever the session QuestionnaireResponse updates.",
  },
];

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [resolve(process.cwd(), entry)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "es2022",
    external: ["@medplum/core", "@medplum/fhirtypes"],
  });
  return result.outputFiles[0].text;
}

async function main() {
  const printOnly = process.argv.includes("--print");

  if (printOnly) {
    for (const botDef of BOTS) {
      const code = await bundle(botDef.entry);
      console.log(`── ${botDef.name} — ${code.length} bytes bundled ──`);
      console.log(code);
      console.log("");
    }
    return;
  }

  requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);
  const medplum = await getMedplum();
  console.log("→ connected to Medplum\n");

  for (const botDef of BOTS) {
    const code = await bundle(botDef.entry);

    const existing = await medplum.searchResources("Bot", {
      name: botDef.name,
      _count: 1,
    });
    let bot: Bot | undefined = existing[0];

    if (!bot) {
      bot = await medplum.createResource<Bot>({
        resourceType: "Bot",
        meta: { tag: [BOT_TAG] },
        name: botDef.name,
        description: botDef.description,
        runtimeVersion: "awslambda",
      });
      console.log(`created Bot ${botDef.name} → ${bot.id}`);
    } else {
      console.log(`found existing Bot ${botDef.name} → ${bot.id}`);
    }

    await medplum.post(medplum.fhirUrl("Bot", bot.id!, "$deploy"), { code }, "application/json");
    console.log(`deployed ${botDef.name}\n`);
  }

  if (!printOnly) console.log("Next: npm run setup:subscriptions");
}

main().catch((err) => {
  console.error("\n❌ bot deploy failed:", err);
  console.error("See the warning banner at the top of scripts/deploy-bots.ts for the manual fallback.");
  process.exit(1);
});
