import {
  COMPREHENSION_CONCEPT_IDS,
  type ComprehensionConceptId,
  type ComprehensionStatus,
} from "@consentloop/shared";

export type WorkflowSource = "medplum" | "demo-cache";
export type ClinicianEscalationStatus = "none" | "requested" | "resolved";

export interface TeachBackRecord {
  conceptId: ComprehensionConceptId;
  status: ComprehensionStatus;
  evidence: string;
  misconception?: string;
  clarification?: string;
  updatedAt: string;
}

export interface ConsentWorkflowEvent {
  id: string;
  timestamp: string;
  resourceType: "ServiceRequest" | "QuestionnaireResponse" | "Task" | "Consent" | "Provenance";
  action: string;
  summary: string;
}

export interface ConsentWorkflowTreatmentOption {
  id: string;
  title: string;
  summary: string;
  expectedBenefits: string[];
  materialRisks: string[];
  eligibilityQuestions: string[];
  recoveryConsiderations: string[];
  clinicalStatus:
    | "appropriate"
    | "not-appropriate"
    | "needs-specialist-review"
    | "insufficient-information";
  availability:
    | "available-here"
    | "referral-available"
    | "research-only"
    | "unknown";
  evidence: Array<{
    id: string;
    title: string;
    url: string;
    jurisdiction: string;
    evidenceStrength: "high" | "moderate" | "low" | "very-low" | "not-rated";
    regulatoryStatus: string;
  }>;
}

export interface ConsentWorkflowSnapshot {
  source: WorkflowSource;
  connected: boolean;
  patientId?: string;
  serviceRequestId?: string;
  questionnaireResponseId?: string;
  taskId?: string;
  consentId?: string;
  procedureCode: string;
  procedureName: string;
  affectedRegionId: "right-knee";
  taskStatus: "requested" | "in-progress" | "on-hold" | "completed";
  consentStatus: "draft" | "active";
  clinicianEscalation: ClinicianEscalationStatus;
  workflowStatus?: "preparing" | "educating" | "review" | "ready" | "completed";
  optionSnapshotStale?: boolean;
  optionSnapshotVersion?: string;
  optionCatalogVersion?: string;
  optionSourceCoverage?: string;
  blockers?: string[];
  treatmentOptions?: ConsentWorkflowTreatmentOption[];
  diagnosticSummaries?: Array<{ reference: string; conclusion: string }>;
  concepts: Record<ComprehensionConceptId, TeachBackRecord>;
  unresolvedQuestions: string[];
  events: ConsentWorkflowEvent[];
  updatedAt: string;
}

export interface TeachBackUpdate {
  conceptId: ComprehensionConceptId;
  status: ComprehensionStatus;
  evidence: string;
  misconception?: string;
  clarification?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const consentWorkflowStorageKey = "consentloop.synthetic-workflow.v1";

const defaultStatus: Record<ComprehensionConceptId, ComprehensionStatus> = {
  "procedure-identity": "partial",
  "tissue-treated": "not-discussed",
  "risk-limitation": "not-discussed",
};

function conceptRecord(
  conceptId: ComprehensionConceptId,
  updatedAt: string,
): TeachBackRecord {
  return {
    conceptId,
    status: defaultStatus[conceptId],
    evidence: "",
    updatedAt,
  };
}

export function createDefaultWorkflowSnapshot(
  now = new Date().toISOString(),
): ConsentWorkflowSnapshot {
  return {
    source: "demo-cache",
    connected: false,
    procedureCode: "73761001",
    procedureName: "Right knee arthroscopy",
    affectedRegionId: "right-knee",
    taskStatus: "in-progress",
    consentStatus: "draft",
    clinicianEscalation: "none",
    concepts: {
      "procedure-identity": conceptRecord("procedure-identity", now),
      "tissue-treated": conceptRecord("tissue-treated", now),
      "risk-limitation": conceptRecord("risk-limitation", now),
    },
    unresolvedQuestions: [],
    events: [
      {
        id: "service-request-loaded",
        timestamp: now,
        resourceType: "ServiceRequest",
        action: "Procedure context loaded",
        summary: "Right-knee arthroscopy education is in progress.",
      },
    ],
    updatedAt: now,
  };
}

function isConceptId(value: unknown): value is ComprehensionConceptId {
  return typeof value === "string" && COMPREHENSION_CONCEPT_IDS.includes(value as ComprehensionConceptId);
}

const statuses: readonly ComprehensionStatus[] = [
  "understood",
  "partial",
  "contradicted",
  "uncertain",
  "not-discussed",
];

function isStatus(value: unknown): value is ComprehensionStatus {
  return typeof value === "string" && statuses.includes(value as ComprehensionStatus);
}

export function isTeachBackUpdate(value: unknown): value is TeachBackUpdate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const update = value as Record<string, unknown>;
  const allowed = ["conceptId", "status", "evidence", "misconception", "clarification"];
  if (!Object.keys(update).every((key) => allowed.includes(key))) return false;
  return (
    isConceptId(update.conceptId) &&
    isStatus(update.status) &&
    typeof update.evidence === "string" &&
    update.evidence.trim().length > 0 &&
    update.evidence.length <= 1_000 &&
    (update.misconception === undefined ||
      (typeof update.misconception === "string" && update.misconception.length <= 1_000)) &&
    (update.clarification === undefined ||
      (typeof update.clarification === "string" && update.clarification.length <= 1_000))
  );
}

function allUnderstood(
  concepts: ConsentWorkflowSnapshot["concepts"],
): boolean {
  return COMPREHENSION_CONCEPT_IDS.every(
    (conceptId) => concepts[conceptId].status === "understood",
  );
}

export function applyTeachBackUpdate(
  current: ConsentWorkflowSnapshot,
  update: TeachBackUpdate,
  now = new Date().toISOString(),
): ConsentWorkflowSnapshot {
  const previous = current.concepts[update.conceptId];
  const concepts = {
    ...current.concepts,
    [update.conceptId]: {
      conceptId: update.conceptId,
      status: update.status,
      evidence: update.evidence.trim(),
      ...(previous.misconception || update.misconception
        ? { misconception: previous.misconception ?? update.misconception?.trim() }
        : {}),
      ...(update.clarification
        ? { clarification: update.clarification.trim() }
        : previous.clarification
          ? { clarification: previous.clarification }
          : {}),
      updatedAt: now,
    },
  };
  const needsClinician = update.status === "contradicted" || update.status === "uncertain";
  const resolvedEscalation =
    update.status === "understood" && current.clinicianEscalation === "requested";
  const taskStatus: ConsentWorkflowSnapshot["taskStatus"] = needsClinician
    ? "on-hold"
    : allUnderstood(concepts)
      ? "completed"
      : "in-progress";
  const clinicianEscalation: ClinicianEscalationStatus = needsClinician
    ? "requested"
    : resolvedEscalation
      ? "resolved"
      : current.clinicianEscalation;

  const questionnaireEvent: ConsentWorkflowEvent = {
    id: `qr-${update.conceptId}-${now}`,
    timestamp: now,
    resourceType: "QuestionnaireResponse",
    action: "Teach-back updated",
    summary: `${update.conceptId}: ${update.status}`,
  };
  const workflowEvent: ConsentWorkflowEvent = {
    id: `task-${update.conceptId}-${now}`,
    timestamp: now,
    resourceType: "Task",
    action: needsClinician
      ? "Clinician review requested"
      : resolvedEscalation
        ? "Misconception resolved"
        : "Education task updated",
    summary: needsClinician
      ? "Critical understanding remains unresolved; Consent stays draft."
      : "Workflow was recomputed from the latest teach-back evidence.",
  };

  return {
    ...current,
    source: current.connected ? current.source : "demo-cache",
    concepts,
    taskStatus,
    consentStatus: "draft",
    clinicianEscalation,
    events: [workflowEvent, questionnaireEvent, ...current.events].slice(0, 24),
    updatedAt: now,
  };
}

function parseStoredSnapshot(raw: string | null): ConsentWorkflowSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ConsentWorkflowSnapshot;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.procedureCode === "73761001" &&
      parsed.affectedRegionId === "right-knee" &&
      parsed.concepts &&
      COMPREHENSION_CONCEPT_IDS.every((id) => isStatus(parsed.concepts[id]?.status))
    ) {
      return parsed;
    }
  } catch {
    // Ignore corrupt synthetic cache and start from the approved fixture.
  }
  return null;
}

function saveSnapshot(storage: StorageLike | undefined, snapshot: ConsentWorkflowSnapshot) {
  try {
    storage?.setItem(consentWorkflowStorageKey, JSON.stringify(snapshot));
  } catch {
    // Storage is a convenience fallback; the live Medplum response remains authoritative.
  }
}

export async function loadConsentWorkflow(
  options: {
    fetcher?: FetchLike;
    storage?: StorageLike;
    endpoint?: string;
  } = {},
): Promise<ConsentWorkflowSnapshot> {
  const endpoint = options.endpoint ?? "/api/consent-workflow";
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (fetcher) {
    try {
      const response = await fetcher(endpoint, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const snapshot = (await response.json()) as ConsentWorkflowSnapshot;
        if (snapshot.connected && snapshot.source === "medplum") {
          saveSnapshot(options.storage, snapshot);
          return snapshot;
        }
      }
    } catch {
      // Fall through to the last synthetic snapshot so the educational demo stays usable.
    }
  }

  return (
    parseStoredSnapshot(options.storage?.getItem(consentWorkflowStorageKey) ?? null) ??
    createDefaultWorkflowSnapshot()
  );
}

export async function persistTeachBackUpdate(
  current: ConsentWorkflowSnapshot,
  update: TeachBackUpdate,
  options: {
    fetcher?: FetchLike;
    storage?: StorageLike;
    endpoint?: string;
    now?: string;
  } = {},
): Promise<ConsentWorkflowSnapshot> {
  if (!isTeachBackUpdate(update)) {
    throw new Error("Teach-back update is invalid or unsupported.");
  }

  const optimistic = applyTeachBackUpdate(
    current,
    update,
    options.now ?? new Date().toISOString(),
  );
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (fetcher) {
    try {
      const response = await fetcher(options.endpoint ?? "/api/consent-workflow", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (response.ok) {
        const saved = (await response.json()) as ConsentWorkflowSnapshot;
        if (saved.connected && saved.source === "medplum") {
          saveSnapshot(options.storage, saved);
          return saved;
        }
      }
    } catch {
      // Preserve the local synthetic walkthrough when live FHIR is unavailable.
    }
  }

  saveSnapshot(options.storage, optimistic);
  return optimistic;
}
