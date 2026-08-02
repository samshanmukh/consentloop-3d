import type { Bundle, BundleEntry, CarePlan, Consent, Provenance, Resource, Task } from '@medplum/fhirtypes';
import {
  canonicalJson,
  consentWorkflowSchema,
  demoTag,
  FHIR_BASE,
  IDENTIFIER_SYSTEM,
  TAG_SYSTEM,
  transitionConsentWorkflow,
  WORKFLOW_EXTENSION_URL,
} from '../shared/index.js';
import { getStringExtension, replaceStringExtension } from './extensions.js';
import { readOptionSnapshot } from './option-snapshot.js';

function versioned<T extends Resource>(resource: T): T & { id: string; meta: { versionId: string } } {
  if (!resource.id || !resource.meta?.versionId) throw new Error(`${resource.resourceType} id and version are required`);
  return resource as T & { id: string; meta: { versionId: string } };
}

function clinician(reference: string): void {
  if (!/^(Practitioner|PractitionerRole)\/[A-Za-z0-9.-]+$/u.test(reference)) throw new Error('Clinician authorization is required');
}

function workflow(consent: Consent) {
  const encoded = getStringExtension(consent.extension, WORKFLOW_EXTENSION_URL);
  if (!encoded) throw new Error('Consent has no ConsentLoop workflow');
  return consentWorkflowSchema.parse(JSON.parse(encoded));
}

function put(resource: Resource & { id: string; meta: { versionId: string } }): BundleEntry {
  return { resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}`, ifMatch: `W/\"${resource.meta.versionId}\"` } };
}

function audit(targets: string[], actor: string, action: string, key: string, now: string): BundleEntry {
  const resource: Provenance = {
    resourceType: 'Provenance', meta: { tag: [demoTag(), { system: TAG_SYSTEM, code: key }] },
    target: targets.map((reference) => ({ reference })), recorded: now,
    activity: { coding: [{ system: `${FHIR_BASE}/CodeSystem/provenance-activity`, code: action }] },
    agent: [{ who: { reference: actor } }],
  };
  return { resource, request: { method: 'POST', url: 'Provenance', ifNoneExist: new URLSearchParams({ _tag: `${TAG_SYSTEM}|${key}` }).toString() } };
}

export function buildClinicianTaskResolutionBundle(
  consent: Consent,
  task: Task,
  input: { clinicianReference: string; response: string; now: string },
): Bundle {
  clinician(input.clinicianReference);
  const currentConsent = versioned(consent);
  const currentTask = versioned(task);
  if (!['requested', 'received', 'accepted', 'in-progress'].includes(currentTask.status)) throw new Error('Clinical Task is not open');
  const taskKey = currentTask.identifier?.find((identifier) => identifier.system === IDENTIFIER_SYSTEM)?.value;
  if (!taskKey || !workflow(currentConsent).openReviewTaskIds.includes(taskKey)) throw new Error('Clinical Task is not an open workflow blocker');
  const next = transitionConsentWorkflow(workflow(currentConsent), { type: 'resolve-review', taskId: taskKey, actorReference: input.clinicianReference });
  const updatedConsent = versioned({
    ...structuredClone(currentConsent), status: 'draft' as const,
    extension: replaceStringExtension(currentConsent.extension, WORKFLOW_EXTENSION_URL, canonicalJson(next)),
  });
  const updatedTask = versioned({
    ...structuredClone(currentTask), status: 'completed' as const, owner: { reference: input.clinicianReference },
    lastModified: input.now, output: [{ type: { text: 'Clinical response' }, valueString: input.response.trim() }],
  });
  if (!input.response.trim()) throw new Error('Clinical response is required');
  const key = `resolve:${taskKey}`;
  return {
    resourceType: 'Bundle', type: 'transaction',
    entry: [put(updatedConsent), put(updatedTask), audit([`Consent/${updatedConsent.id}`, `Task/${updatedTask.id}`], input.clinicianReference, 'resolve-clinical-task', key, input.now)],
  };
}

export function buildSnapshotReviewBundle(
  consent: Consent,
  carePlan: CarePlan,
  input: { clinicianReference: string; now: string },
): Bundle {
  clinician(input.clinicianReference);
  const currentConsent = versioned(consent);
  const currentCarePlan = versioned(carePlan);
  const next = transitionConsentWorkflow(workflow(currentConsent), {
    type: 'review-snapshot', snapshotVersion: readOptionSnapshot(currentCarePlan).snapshotVersion,
    actorReference: input.clinicianReference,
  });
  const updated = versioned({
    ...structuredClone(currentConsent), status: 'draft' as const,
    extension: replaceStringExtension(currentConsent.extension, WORKFLOW_EXTENSION_URL, canonicalJson(next)),
  });
  const key = `review-snapshot:${currentCarePlan.id}:${readOptionSnapshot(currentCarePlan).snapshotVersion}`;
  return {
    resourceType: 'Bundle', type: 'transaction',
    entry: [put(updated), audit([`Consent/${updated.id}`, `CarePlan/${currentCarePlan.id}`], input.clinicianReference, 'review-option-snapshot', key, input.now)],
  };
}
