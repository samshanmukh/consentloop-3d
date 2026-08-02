import { MedplumClient } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';

export type Identified<T extends Resource> = T & { id: string };

export interface FhirWriter {
  upsertResource<T extends Resource>(resource: T, query: string): Promise<Identified<T>>;
}

function requiredEnvironment(name: 'MEDPLUM_CLIENT_ID' | 'MEDPLUM_CLIENT_SECRET'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function connectMedplum(): Promise<MedplumClient> {
  const baseUrl = process.env.MEDPLUM_BASE_URL?.trim() || 'https://api.medplum.com/';
  const medplum = new MedplumClient({ baseUrl });
  await medplum.startClientLogin(
    requiredEnvironment('MEDPLUM_CLIENT_ID'),
    requiredEnvironment('MEDPLUM_CLIENT_SECRET'),
  );
  return medplum;
}
