/**
 * Bundles each bot (resolving the @consentloop/* workspace imports so the
 * Medplum bot runtime doesn't need to) and deploys it as a Medplum Bot
 * resource.
 *
 *   npm run deploy:bots            # create/update + deploy both bots
 *   npm run deploy:bots -- --print # bundle only, print sizes, deploy nothing
 *
 * ─── THE ONE UNVERIFIED SURFACE IN THIS REPO ─────────────────────────────
 * Checked against the installed SDK: `post(fhirUrl(...))` matches Medplum's
 * own documented pattern for custom operations, `runtimeVersion: 'awslambda'`
 * is a valid Bot value, and `$deploy`'s `{ code }` body matches
 * `Bot.executableCode`'s role. But no one has run this against a live project,
 * so treat a failure here as expected-and-recoverable, not as broken code.
 *
 * If `$deploy` fails, the deploy step is the ONLY thing affected — the bot
 * logic itself is already proven by `npm run selftest`. Two fallbacks, in
 * order of preference:
 *
 *   1. `npm run deploy:bots -- --print`, copy the bundled output, paste into
 *      Project > Bots > (bot) > Editor in the Medplum console, click Deploy.
 *      Same result, zero API guessing. Takes about two minutes.
 *   2. If Bot creation itself fails, create both bots by hand in the console
 *      (names must match PREPARE_CONSENT_BOT_NAME / ASSESS_TEACHBACK_BOT_NAME
 *      in packages/fhir/src/constants.ts, or setup:subscriptions won't find
 *      them), then use fallback 1 for the code.
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
      try {
        bot = await medplum.createResource<Bot>({
          resourceType: "Bot",
          meta: { tag: [BOT_TAG] },
          name: botDef.name,
          description: botDef.description,
          runtimeVersion: "awslambda",
        });
      } catch (err) {
        console.error(`\n✗ could not CREATE Bot ${botDef.name}:`, describe(err));
        console.error(
          "  Most likely your ClientApplication lacks permission to create Bots, or the\n" +
            "  project is on a plan where bots must be created from the console. See\n" +
            "  fallback 2 in this file's header — create it by hand with this exact name."
        );
        throw err;
      }
      console.log(`created Bot ${botDef.name} → ${bot.id}`);
    } else {
      console.log(`found existing Bot ${botDef.name} → ${bot.id}`);
    }

    try {
      await medplum.post(medplum.fhirUrl("Bot", bot.id!, "$deploy"), { code }, "application/json");
    } catch (err) {
      console.error(`\n✗ could not DEPLOY code to ${botDef.name}:`, describe(err));
      console.error(
        `  The Bot resource exists (${bot.id}) — only the code upload failed, and the bot\n` +
          "  logic itself is already proven by `npm run selftest`. Use fallback 1 in this\n" +
          "  file's header: rerun with --print and paste into the console editor."
      );
      throw err;
    }
    console.log(`deployed ${botDef.name}\n`);
  }

  console.log("Next: npm run setup:subscriptions");
}

/** Medplum errors carry the useful detail in `outcome`, not in `message`. */
function describe(err: unknown): string {
  const outcome = (err as { outcome?: { issue?: { details?: { text?: string }; diagnostics?: string }[] } })?.outcome;
  const issues = outcome?.issue
    ?.map((i) => i.details?.text ?? i.diagnostics)
    .filter(Boolean)
    .join("; ");
  return issues || (err instanceof Error ? err.message : String(err));
}

main().catch((err) => {
  console.error("\n❌ bot deploy failed:", describe(err));
  console.error("See the warning banner at the top of scripts/deploy-bots.ts for the manual fallback.");
  process.exit(1);
});
