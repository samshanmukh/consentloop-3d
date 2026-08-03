// ⚠️ FROZEN CONTRACT — agreed by the team before Hour 1 ends.
// Every app/package imports these types rather than redefining them.
// Changing a shape here is a stop-everyone event: message the other two first.

// ─── 3D scene control (Person 2 owns the renderer, Person 3 emits commands) ──

export type SceneId =
  | "normal-knee"
  | "damaged-meniscus"
  | "arthroscope-insertion"
  | "treated-region";

export type SceneCommand =
  | { type: "focus"; target: "meniscus" | "incision" | "joint" }
  | { type: "highlight"; target: string; color: string }
  | { type: "animate"; animation: string }
  | { type: "reset" };

// ─── Comprehension concepts ──────────────────────────────────────────────────

/** The three MVP teach-back concepts. Fixed set — do not add without team sign-off. */
export type ComprehensionConceptId =
  | "procedure-identity"
  | "tissue-treated"
  | "risk-limitation";

export type ComprehensionStatus =
  | "understood"
  | "partial"
  | "contradicted"
  | "uncertain"
  | "not-discussed";

export interface ComprehensionConcept {
  id: ComprehensionConceptId;
  title: string;
  critical: boolean;
  status: ComprehensionStatus;
  sceneId: SceneId;
}

/**
 * Canonical metadata for the three concepts — title + which scene it maps to.
 * Person 1's Questionnaire, Person 2's scene picker, and Person 3's evaluator
 * all key off these same ids so nothing drifts out of sync.
 */
export const CONCEPT_DEFINITIONS: Record<
  ComprehensionConceptId,
  { title: string; critical: boolean; sceneId: SceneId }
> = {
  "procedure-identity": {
    title: "What procedure is being performed",
    critical: true,
    sceneId: "arthroscope-insertion",
  },
  "tissue-treated": {
    title: "Which tissue is being treated",
    critical: true,
    sceneId: "damaged-meniscus",
  },
  "risk-limitation": {
    title: "A key risk or limitation of the procedure",
    critical: true,
    sceneId: "treated-region",
  },
};

export const COMPREHENSION_CONCEPT_IDS = Object.keys(
  CONCEPT_DEFINITIONS
) as ComprehensionConceptId[];

// ─── Teach-back evaluator output (Person 3 produces this) ───────────────────

export interface TeachBackResult {
  conceptId: ComprehensionConceptId;
  status: ComprehensionStatus;
  evidence: string;
  misconception?: string;
  clarification?: string;
  sceneCommand?: SceneCommand;
  requiresClinician: boolean;
}

// ─── Consent session (Person 1's FHIR workflow, read by both UIs) ───────────

export type ConsentSessionStatus =
  | "preparing"
  | "educating"
  | "review"
  | "ready"
  | "completed";

export interface ConsentSession {
  patientId: string;
  serviceRequestId: string;
  taskId: string;
  consentId: string;
  questionnaireResponseId: string;
  procedureCode: string;
  status: ConsentSessionStatus;
}

// ─── Live FHIR event stream (clinician dashboard) ────────────────────────────

export interface ConsentEvent {
  timestamp: string;
  resourceType: string;
  resourceId: string;
  action: string;
  summary: string;
  resource: Record<string, unknown>;
}
