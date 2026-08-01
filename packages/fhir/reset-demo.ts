import type { MedplumClient } from '@medplum/core';
import type { Resource, ResourceType } from '@medplum/fhirtypes';
import { DEMO_TAG, TAG_SYSTEM } from '../shared/index.js';

export const RESET_RESOURCE_TYPES = [
  'Provenance', 'Task', 'Consent', 'QuestionnaireResponse', 'CarePlan', 'ServiceRequest',
  'DocumentReference', 'DiagnosticReport', 'ImagingStudy', 'Observation', 'Encounter',
  'AccessPolicy', 'Questionnaire', 'PlanDefinition', 'Practitioner', 'Patient', 'Device',
] as const satisfies readonly ResourceType[];

export function assertDemoResource(resource: Resource): asserts resource is Resource & { id: string } {
  const tagged = resource.meta?.tag?.some((tag) => tag.system === TAG_SYSTEM && tag.code === DEMO_TAG);
  if (!resource.id || !tagged) throw new Error(`Refusing to delete untagged ${resource.resourceType}/${resource.id ?? 'unknown'}`);
}

export async function resetDemo(medplum: MedplumClient): Promise<{ deleted: string[] }> {
  const deleted: string[] = [];
  const query = new URLSearchParams({ _tag: `${TAG_SYSTEM}|${DEMO_TAG}`, _count: '1000' });
  for (const resourceType of RESET_RESOURCE_TYPES) {
    const resources: Resource[] = [];
    for await (const page of medplum.searchResourcePages(resourceType, query)) resources.push(...page);
    for (const resource of resources) {
      assertDemoResource(resource);
      await medplum.deleteResource(resourceType, resource.id);
      deleted.push(`${resourceType}/${resource.id}`);
    }
  }
  return { deleted };
}
