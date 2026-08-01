import { build } from 'esbuild';
import type { MedplumClient } from '@medplum/core';
import type { Bot, QuestionnaireResponse, Subscription } from '@medplum/fhirtypes';
import { ASSESS_BOT_IDENTIFIER, ASSESS_SUBSCRIPTION_TAG, DEMO_TAG, IDENTIFIER_SYSTEM, TAG_SYSTEM } from '../shared/index.js';
import { identifierQuery } from './demo-resources.js';
import { syncSubscription } from './subscription.js';

export function assessmentBotResource(): Bot {
  return {
    resourceType: 'Bot', identifier: [{ system: IDENTIFIER_SYSTEM, value: ASSESS_BOT_IDENTIFIER }],
    name: 'ConsentLoop teach-back assessment',
    description: 'Applies structured teach-back results to consent workflow safeguards.',
    runtimeVersion: 'awslambda', timeout: 30, auditEventTrigger: 'always',
    meta: { tag: [{ system: TAG_SYSTEM, code: ASSESS_BOT_IDENTIFIER }] },
  };
}

export function assessmentSubscriptionResource(botId: string): Subscription {
  const criteria = new URLSearchParams({ status: 'completed,amended', _tag: `${TAG_SYSTEM}|${DEMO_TAG}` });
  return {
    resourceType: 'Subscription', status: 'active', reason: 'Assess completed ConsentLoop teach-back responses.',
    criteria: `QuestionnaireResponse?${criteria.toString()}`,
    channel: { type: 'rest-hook', endpoint: `Bot/${botId}`, payload: 'application/fhir+json' },
    meta: { tag: [{ system: TAG_SYSTEM, code: ASSESS_SUBSCRIPTION_TAG }] },
    extension: [{ url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction', valueCode: 'update' }],
  };
}

export async function bundleAssessmentBot(): Promise<string> {
  const result = await build({
    entryPoints: ['bots/assess-teachback/index.ts'], bundle: true, write: false, platform: 'node', target: 'node22', format: 'cjs',
    external: ['@medplum/core', '@medplum/fhirtypes'],
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error('esbuild produced no assessment Bot output');
  return output;
}

export async function executeAssessmentAutomation(
  medplum: MedplumClient,
  response: QuestionnaireResponse & { id: string },
): Promise<void> {
  await medplum.executeBot(
    { system: IDENTIFIER_SYSTEM, value: ASSESS_BOT_IDENTIFIER },
    response,
    'application/fhir+json',
  );
}

export async function deployAssessmentAutomation(medplum: MedplumClient): Promise<{ bot: Bot & { id: string }; subscription: Subscription & { id: string } }> {
  const bot = await medplum.upsertResource(assessmentBotResource(), identifierQuery(ASSESS_BOT_IDENTIFIER));
  const code = await bundleAssessmentBot();
  await medplum.post(medplum.fhirUrl('Bot', bot.id, '$deploy'), { filename: 'assess-teachback.js', code });
  const subscription = await syncSubscription(
    medplum,
    assessmentSubscriptionResource(bot.id),
    new URLSearchParams({ _tag: `${TAG_SYSTEM}|${ASSESS_SUBSCRIPTION_TAG}` }).toString(),
  );
  return { bot, subscription };
}
