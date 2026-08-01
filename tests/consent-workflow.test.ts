import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTeachBackUpdate,
  consentWorkflowStorageKey,
  createDefaultWorkflowSnapshot,
  isTeachBackUpdate,
  loadConsentWorkflow,
  persistTeachBackUpdate,
} from "../app/lib/consent-workflow";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(consentWorkflowStorageKey, initial);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("critical whole-knee misconception blocks and surfaces clinician review", () => {
  const current = createDefaultWorkflowSnapshot("2026-08-01T10:00:00.000Z");
  const updated = applyTeachBackUpdate(
    current,
    {
      conceptId: "tissue-treated",
      status: "contradicted",
      evidence: "The surgeon is replacing my whole knee.",
      misconception: "Patient described a total knee replacement.",
    },
    "2026-08-01T10:01:00.000Z",
  );
  assert.equal(updated.taskStatus, "on-hold");
  assert.equal(updated.consentStatus, "draft");
  assert.equal(updated.clinicianEscalation, "requested");
  assert.equal(updated.concepts["tissue-treated"].status, "contradicted");
  assert.match(updated.events[0].action, /Clinician review/);
});

test("correction preserves the original misconception and resolves escalation", () => {
  const contradicted = applyTeachBackUpdate(
    createDefaultWorkflowSnapshot("2026-08-01T10:00:00.000Z"),
    {
      conceptId: "tissue-treated",
      status: "contradicted",
      evidence: "My whole knee is being replaced.",
      misconception: "Whole-joint replacement misconception.",
    },
    "2026-08-01T10:01:00.000Z",
  );
  const corrected = applyTeachBackUpdate(
    contradicted,
    {
      conceptId: "tissue-treated",
      status: "understood",
      evidence: "Only the torn meniscus may be repaired or trimmed.",
      clarification: "Compared the whole joint with the smaller treated tissue.",
    },
    "2026-08-01T10:02:00.000Z",
  );
  assert.equal(corrected.concepts["tissue-treated"].status, "understood");
  assert.equal(
    corrected.concepts["tissue-treated"].misconception,
    "Whole-joint replacement misconception.",
  );
  assert.equal(corrected.clinicianEscalation, "resolved");
  assert.equal(corrected.consentStatus, "draft");
});

test("refresh hydration restores the last synthetic workflow when Medplum is unavailable", async () => {
  const saved = applyTeachBackUpdate(
    createDefaultWorkflowSnapshot("2026-08-01T10:00:00.000Z"),
    {
      conceptId: "tissue-treated",
      status: "understood",
      evidence: "The torn meniscus may be treated.",
    },
    "2026-08-01T10:02:00.000Z",
  );
  const storage = memoryStorage(JSON.stringify(saved));
  const restored = await loadConsentWorkflow({
    storage,
    fetcher: async () => new Response("not configured", { status: 503 }),
  });
  assert.equal(restored.concepts["tissue-treated"].status, "understood");
  assert.equal(restored.updatedAt, "2026-08-01T10:02:00.000Z");
});

test("failed live write persists the safe synthetic snapshot", async () => {
  const storage = memoryStorage();
  const updated = await persistTeachBackUpdate(
    createDefaultWorkflowSnapshot("2026-08-01T10:00:00.000Z"),
    {
      conceptId: "tissue-treated",
      status: "contradicted",
      evidence: "The complete joint is replaced.",
      misconception: "Whole-joint replacement misconception.",
    },
    {
      storage,
      now: "2026-08-01T10:03:00.000Z",
      fetcher: async () => new Response("offline", { status: 503 }),
    },
  );
  assert.equal(updated.source, "demo-cache");
  assert.equal(updated.taskStatus, "on-hold");
  assert.ok(storage.getItem(consentWorkflowStorageKey));
});

test("teach-back validation rejects unsupported and ungrounded input", () => {
  assert.equal(
    isTeachBackUpdate({
      conceptId: "brain-surgery",
      status: "understood",
      evidence: "invented",
    }),
    false,
  );
  assert.equal(
    isTeachBackUpdate({
      conceptId: "tissue-treated",
      status: "approved",
      evidence: "invented",
    }),
    false,
  );
  assert.equal(
    isTeachBackUpdate({
      conceptId: "tissue-treated",
      status: "understood",
      evidence: "",
    }),
    false,
  );
});
