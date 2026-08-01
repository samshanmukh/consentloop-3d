import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOptionCatalog,
  CATALOG_COVERAGE,
  MENISCUS_OPTIONS,
  readCatalogOptions,
  validateOptionCatalog,
} from '../packages/fhir/index.js';

test('builds a deterministic four-path FHIR option catalog', () => {
  const first = buildOptionCatalog();
  const second = buildOptionCatalog();
  const options = readCatalogOptions(first);

  assert.deepEqual(first, second);
  assert.equal(options.length, 4);
  assert.ok(options.some((option) => option.id === 'regenerative-specialist-review'));
  assert.ok(options.every((option) => !('availability' in option)));
  assert.doesNotThrow(() => validateOptionCatalog(first));
});

test('changes version when reviewed source content changes', () => {
  const changed = MENISCUS_OPTIONS.map((option, optionIndex) => ({
    ...structuredClone(option),
    evidence: option.evidence.map((source, sourceIndex) => ({
      ...structuredClone(source),
      claims:
        optionIndex === 0 && sourceIndex === 0 ? [...source.claims, 'New reviewed claim.'] : [...source.claims],
    })),
  }));

  assert.notEqual(buildOptionCatalog().version, buildOptionCatalog(changed).version);
});

test('rejects expired evidence and tampered versions', () => {
  const expired = MENISCUS_OPTIONS.map((option, optionIndex) => ({
    ...structuredClone(option),
    evidence: option.evidence.map((source, sourceIndex) => ({
      ...structuredClone(source),
      reviewedAt: optionIndex === 0 && sourceIndex === 0 ? '2024-01-01' : source.reviewedAt,
    })),
  }));
  const expiredCatalog = buildOptionCatalog(expired, CATALOG_COVERAGE);
  assert.throws(() => validateOptionCatalog(expiredCatalog), /expired review date/u);

  const tampered = { ...buildOptionCatalog(), version: 'wrong' };
  assert.throws(() => validateOptionCatalog(tampered), /version does not match/u);
});
