import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewReport } from '../src/review-report.mjs';

const row = (observedAt, price, extra = {}) => ({ productId: '1', keyword: 'SSD',
  productName: 'SSD 1TB', observedAt, price, isRocket: true, productUrl: 'https://example.com/1',
  ambiguous: false, ...extra });

test('동일 옵션 미확인 기록은 후보 대신 관측 통계만 생성한다', () => {
  const observations = [row('2026-09-29T00:00:00Z', 100), row('2026-09-30T00:00:00Z', 100),
    row('2026-09-30T12:00:00Z', 100), row('2026-10-01T00:00:00Z', 50, { ambiguous: true })];
  const report = buildReviewReport({ version: 1, observations, runs: [{}, {}, {}, {}] });
  assert.equal(report.coverage.ambiguousRows, 1);
  assert.equal(report.coverage.candidates, 0);
});

test('하루 이상의 관측 후 하락만 수동 검토 후보가 된다', () => {
  const observations = [row('2026-09-29T00:00:00Z', 100), row('2026-09-30T00:00:00Z', 100),
    row('2026-09-30T12:00:00Z', 100), row('2026-10-01T00:00:00Z', 50)];
  const report = buildReviewReport({ version: 1, observations, runs: [{}, {}, {}, {}] });
  assert.equal(report.coverage.observedPriceChanges, 1);
  assert.equal(report.candidates[0].status, 'needs_human_review');
  assert.equal(report.candidates[0].discountPct, 50);
  assert.equal(report.candidates[0].reason, 'option_identity_unverified');
});

test('검색어 또는 배송 표기가 다른 이력을 섞지 않는다', () => {
  const observations = [row('2026-09-29T00:00:00Z', 100), row('2026-09-30T00:00:00Z', 100),
    row('2026-09-30T12:00:00Z', 100, { isRocket: false }),
    row('2026-10-01T00:00:00Z', 50, { keyword: '하드' })];
  const report = buildReviewReport({ version: 1, observations, runs: [{}, {}, {}, {}] });
  assert.equal(report.coverage.unambiguousGroups, 3);
  assert.equal(report.coverage.candidates, 0);
});
