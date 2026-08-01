import { build } from 'esbuild';
import type { MedplumClient } from '@medplum/core';
import type { Bot, Subscription } from '@medplum/fhirtypes';
import {
  DEMO_TAG,
  IDENTIFIER_SYSTEM,
  KNEE_ARTHROSCOPY_CODE,
  PREPARE_BOT_IDENTIFIER,
  PREPARE_SUBSCRIPTION_TAG,
  PROCEDURE_CODE_SYSTEM,
  TAG_SYSTEM,
} from '../shared/index.js';
import { identifierQuery } from './demo-resources.js';
import { syncSubscription } from './subscription.js';

export function prepareBotResource(): Bot {
  return {
    resourceType: 'Bot',
    identifier: [{ system: IDENTIFIER_SYSTEM, value: PREPARE_BOT_IDENTIFIER }],
    name: 'ConsentLoop consent preparation',
    description: 'Creates an option-aware consent education session from an eligible ServiceRequest.',
    runtimeVersion: 'awslambda',
    timeout: 30,
    auditEventTrigger: 'always',
    meta: { tag: [{ system: TAG_SYSTEM, code: PREPARE_BOT_IDENTIFIER }] },
  };
}

export function prepareSubscriptionResource(botId: string): Subscription {
  const criteria = new URLSearchParams({
    status: 'active',
    intent: 'order',
    _tag: `${TAG_SYSTEM}|${DEMO_TAG}`,
    code: `${PROCEDURE_CODE_SYSTEM}|${KNEE_ARTHROSCOPY_CODE}`,
  });
  return {
    resourceType: 'Subscription',
    status: 'active',
    reason: 'Create a ConsentLoop consent session for eligible knee-arthroscopy requests.',
    criteria: `ServiceRequest?${criteria.toString()}`,
    channel: { type: 'rest-hook', endpoint: `Bot/${botId}`, payload: 'application/fhir+json' },
    meta: { tag: [{ system: TAG_SYSTEM, code: PREPARE_SUBSCRIPTION_TAG }] },
    extension: [
      {
        url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction',
        valueCode: 'create',
      },
    ],
  };
}

export async function bundlePreparationBot(): Promise<string> {
  const result = await build({
    entryPoints: ['bots/prepare-consent/index.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['@medplum/core', '@medplum/fhirtypes'],
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error('esbuild produced no preparation Bot output');
  return output;
}

export async function deployPreparationAutomation(
  medplum: MedplumClient,
): Promise<{ bot: Bot & { id: string }; subscription: Subscription & { id: string } }> {
  const bot = await medplum.upsertResource(prepareBotResource(), identifierQuery(PREPARE_BOT_IDENTIFIER));
  const code = await bundlePreparationBot();
  await medplum.post(medplum.fhirUrl('Bot', bot.id, '$deploy'), { filename: 'prepare-consent.js', code });
  const subscription = await syncSubscription(
    medplum,
    prepareSubscriptionResource(bot.id),
    new URLSearchParams({ _tag: `${TAG_SYSTEM}|${PREPARE_SUBSCRIPTION_TAG}` }).toString(),
  );
  return { bot, subscription };
}
