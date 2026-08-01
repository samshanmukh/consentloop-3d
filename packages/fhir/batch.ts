import type { Bundle } from '@medplum/fhirtypes';

export function assertBatchSucceeded(response: Bundle): void {
  const failure = response.entry?.find((entry) => !/^2\d\d(?:\s|$)/u.test(entry.response?.status ?? ''));
  if (!failure) return;
  const details = failure.response?.outcome?.issue
    ?.map((issue) => issue.diagnostics ?? issue.details?.text)
    .filter((value): value is string => Boolean(value))
    .join('; ');
  throw new Error(`FHIR transaction entry failed (${failure.response?.status ?? 'missing status'})${details ? `: ${details}` : ''}`);
}
