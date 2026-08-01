import type { MedplumClient } from '@medplum/core';
import type { Subscription } from '@medplum/fhirtypes';

export async function syncSubscription(
  medplum: MedplumClient,
  desired: Subscription,
  query: string,
): Promise<Subscription & { id: string }> {
  const existing = await medplum.upsertResource(desired, query);
  return medplum.updateResource<Subscription>({
    ...desired,
    id: existing.id,
    meta: { ...existing.meta, tag: desired.meta?.tag ?? [] },
  });
}
