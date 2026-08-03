import type {
  QuestionnaireResponse,
  QuestionnaireResponseItem,
} from "@medplum/fhirtypes";
import {
  COMPREHENSION_CONCEPT_IDS,
  type ComprehensionStatus,
  type TeachBackResult,
} from "@consentloop/shared";
import { COMPREHENSION_STATUS_SYSTEM } from "./constants";

const COMPREHENSION_STATUSES: readonly ComprehensionStatus[] = [
  "understood",
  "partial",
  "contradicted",
  "uncertain",
  "not-discussed",
];

function isComprehensionStatus(value: string | undefined): value is ComprehensionStatus {
  return value !== undefined && COMPREHENSION_STATUSES.includes(value as ComprehensionStatus);
}

function answerString(
  items: QuestionnaireResponseItem[] | undefined,
  linkId: string,
): string | undefined {
  return items
    ?.find((item) => item.linkId === linkId)
    ?.answer?.[0]?.valueString;
}

function stringAnswerItem(linkId: string, value: string): QuestionnaireResponseItem {
  return {
    linkId,
    answer: [{ valueString: value }],
  };
}

function replaceOrAppendItem(
  items: QuestionnaireResponseItem[],
  replacement: QuestionnaireResponseItem,
): QuestionnaireResponseItem[] {
  const index = items.findIndex((item) => item.linkId === replacement.linkId);
  if (index < 0) return [...items, replacement];

  return items.map((item, itemIndex) =>
    itemIndex === index ? replacement : item
  );
}

/**
 * Immutably records one voice-agent teach-back evaluation in the session QR.
 *
 * This helper intentionally cannot complete a QuestionnaireResponse. A caller
 * must make the separate, explicit final-submission decision after every
 * required concept has been reviewed. A previously completed response stays
 * completed so a harmless replay cannot reopen it.
 *
 * When a corrected answer follows a misconception, omitting `misconception`
 * preserves the original patient misunderstanding for clinician review while
 * replacing `evidence` with the patient's corrected words.
 */
export function upsertTeachBackResult(
  questionnaireResponse: QuestionnaireResponse,
  result: TeachBackResult,
): QuestionnaireResponse {
  const conceptLinkId = result.conceptId;
  const currentItems = questionnaireResponse.item ?? [];
  const existingGroup = currentItems.find(
    (item) => item.linkId === conceptLinkId,
  );
  let groupItems = [...(existingGroup?.item ?? [])];

  groupItems = replaceOrAppendItem(groupItems, {
    linkId: `${conceptLinkId}.status`,
    answer: [
      {
        valueCoding: {
          system: COMPREHENSION_STATUS_SYSTEM,
          code: result.status,
          display: result.status,
        },
      },
    ],
  });
  groupItems = replaceOrAppendItem(
    groupItems,
    stringAnswerItem(`${conceptLinkId}.evidence`, result.evidence),
  );

  // Do not erase the original misconception when the follow-up result is a
  // correction and therefore has no new misconception text.
  if (result.misconception?.trim()) {
    groupItems = replaceOrAppendItem(
      groupItems,
      stringAnswerItem(`${conceptLinkId}.misconception`, result.misconception),
    );
  }

  if (result.clarification?.trim()) {
    groupItems = replaceOrAppendItem(
      groupItems,
      stringAnswerItem(`${conceptLinkId}.clarification`, result.clarification),
    );
  }

  const updatedGroup: QuestionnaireResponseItem = {
    ...existingGroup,
    linkId: conceptLinkId,
    item: groupItems,
  };
  const groupIndex = currentItems.findIndex(
    (item) => item.linkId === conceptLinkId,
  );
  const updatedItems =
    groupIndex < 0
      ? [...currentItems, updatedGroup]
      : currentItems.map((item, index) =>
          index === groupIndex ? updatedGroup : item
        );

  return {
    ...questionnaireResponse,
    status:
      questionnaireResponse.status === "completed"
        ? "completed"
        : "in-progress",
    item: updatedItems,
  };
}

/**
 * Reads the complete patient evidence used by the clinician UI. Unlike
 * `parseComprehensionConcepts`, this includes the patient's words and the
 * misconception/clarification trail rather than only the workflow status.
 */
export function parseTeachBackResults(
  questionnaireResponse: QuestionnaireResponse,
): TeachBackResult[] {
  const results: TeachBackResult[] = [];

  for (const conceptId of COMPREHENSION_CONCEPT_IDS) {
    const group = questionnaireResponse.item?.find(
      (item) => item.linkId === conceptId,
    );
    const statusCode = group?.item
      ?.find((item) => item.linkId === `${conceptId}.status`)
      ?.answer?.[0]?.valueCoding?.code;
    if (!isComprehensionStatus(statusCode)) continue;

    const evidence = answerString(group?.item, `${conceptId}.evidence`) ?? "";
    const misconception = answerString(
      group?.item,
      `${conceptId}.misconception`,
    );
    const clarification = answerString(
      group?.item,
      `${conceptId}.clarification`,
    );

    results.push({
      conceptId,
      status: statusCode,
      evidence,
      ...(misconception === undefined ? {} : { misconception }),
      ...(clarification === undefined ? {} : { clarification }),
      requiresClinician:
        statusCode === "contradicted" || statusCode === "uncertain",
    });
  }

  return results;
}
