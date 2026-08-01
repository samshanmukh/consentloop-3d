import { consentWorkflowSchema, type ComprehensionConcept, type ConsentWorkflow } from './contracts.js';

export function defaultComprehensionConcepts(): ComprehensionConcept[] {
  return [
    { id: 'procedure-identity', title: 'Procedure identity', critical: true, status: 'not-discussed', sceneId: 'procedure' },
    { id: 'tissue-treated', title: 'Tissue being treated', critical: true, status: 'not-discussed', sceneId: 'meniscus' },
    { id: 'important-limitation-risk', title: 'Important limitation or risk', critical: true, status: 'not-discussed', sceneId: 'risk' },
  ];
}

export type WorkflowEvent =
  | { type: 'begin-education' }
  | { type: 'record-assessment'; concepts: ComprehensionConcept[] }
  | { type: 'open-review'; taskId: string }
  | { type: 'resolve-review'; taskId: string; actorReference: string }
  | { type: 'mark-snapshot-stale' }
  | { type: 'review-snapshot'; snapshotVersion: string; actorReference: string }
  | { type: 'sign'; patientReference: string; signedAt: string };

function clinician(reference: string): boolean {
  return /^(Practitioner|PractitionerRole)\/[A-Za-z0-9.-]+$/u.test(reference);
}

function ready(state: ConsentWorkflow): boolean {
  const critical = state.concepts.filter((concept) => concept.critical);
  return state.assessmentRecorded && !state.optionSnapshotStale && state.openReviewTaskIds.length === 0 && critical.length > 0
    && critical.every((concept) => concept.status === 'understood');
}

function deriveStatus(state: ConsentWorkflow): ConsentWorkflow {
  if (state.status === 'completed') return state;
  if (ready(state)) return { ...state, status: 'ready' };
  if (state.optionSnapshotStale || state.openReviewTaskIds.length > 0
    || state.concepts.some((concept) => concept.critical && ['partial', 'contradicted', 'uncertain'].includes(concept.status))) {
    return { ...state, status: 'review' };
  }
  return { ...state, status: state.status === 'preparing' ? 'preparing' : 'educating' };
}

export function initialConsentWorkflow(
  patientReference: string,
  optionSnapshotVersion: string,
  concepts: ComprehensionConcept[],
): ConsentWorkflow {
  return consentWorkflowSchema.parse({
    patientReference,
    status: 'preparing',
    consentStatus: 'draft',
    optionSnapshotVersion,
    optionSnapshotStale: false,
    assessmentRecorded: false,
    openReviewTaskIds: [],
    concepts,
  });
}

function reviewEvent(state: ConsentWorkflow, event: Extract<WorkflowEvent, { type: 'resolve-review' | 'review-snapshot' }>): ConsentWorkflow {
  if (!clinician(event.actorReference)) throw new Error('Clinical review requires a Practitioner or PractitionerRole');
  if (event.type === 'resolve-review') {
    return { ...state, openReviewTaskIds: state.openReviewTaskIds.filter((id) => id !== event.taskId) };
  }
  return { ...state, optionSnapshotStale: false, optionSnapshotVersion: event.snapshotVersion };
}

function unsignedTransition(state: ConsentWorkflow, event: Exclude<WorkflowEvent, { type: 'sign' }>): ConsentWorkflow {
  switch (event.type) {
    case 'begin-education': return { ...state, status: state.status === 'preparing' ? 'educating' : state.status };
    case 'record-assessment': return { ...state, assessmentRecorded: true, concepts: structuredClone(event.concepts) };
    case 'open-review': return { ...state, openReviewTaskIds: [...new Set([...state.openReviewTaskIds, event.taskId])] };
    case 'mark-snapshot-stale': return { ...state, optionSnapshotStale: true };
    case 'resolve-review':
    case 'review-snapshot': return reviewEvent(state, event);
  }
}

export function transitionConsentWorkflow(current: ConsentWorkflow, event: WorkflowEvent): ConsentWorkflow {
  const state = consentWorkflowSchema.parse(structuredClone(current));
  if (state.status === 'completed') {
    if (event.type === 'sign' && event.patientReference === state.patientReference && event.signedAt === state.signedAt) return state;
    throw new Error('Completed consent workflow cannot be changed');
  }
  if (event.type !== 'sign') return consentWorkflowSchema.parse(deriveStatus(unsignedTransition(state, event)));
  if (event.patientReference !== state.patientReference) throw new Error('Only the patient can sign this consent');
  if (!ready(state)) throw new Error('Consent is blocked until all material reviews and comprehension checks are complete');
  return consentWorkflowSchema.parse({ ...state, status: 'completed', consentStatus: 'active', signedAt: event.signedAt });
}

export function workflowBlockers(state: ConsentWorkflow): string[] {
  return [
    ...(state.optionSnapshotStale ? ['Treatment options changed and require clinician review'] : []),
    ...state.openReviewTaskIds.map((id) => `Open clinical review: ${id}`),
    ...state.concepts
      .filter((concept) => concept.critical && concept.status !== 'understood')
      .map((concept) => `${concept.title}: ${concept.status}`),
  ];
}
