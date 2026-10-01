import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, observe } from '../src/history-trial.mjs';

const item = (price, extra = {}) => ({ productId: '1', productName: 'SSD', price,
  isRocket: true, productUrl: 'https://www.coupang.com/vp/products/1', ...extra });

test('이력이 부족하면 검토 후보를 만들지 않는다', () => {
  const result = observe(emptyState(), [item(50)], { observedAt: '2026-10-01T00:00:00Z', keyword: 'SSD' });
  assert.equal(result.stats.queued, 0);
  assert.equal(result.state.observations.length, 1);
});

test('하루 이상 세 번 관측한 하락은 검토 후보로 한 번만 기록한다', () => {
  let state = emptyState();
  for (const [time, price] of [
    ['2026-09-29T00:00:00Z', 100], ['2026-09-30T00:00:00Z', 100],
    ['2026-09-30T12:00:00Z', 100], ['2026-10-01T00:00:00Z', 70],
    ['2026-10-01T01:00:00Z', 70]]) {
    state = observe(state, [item(price)], { observedAt: time, keyword: 'SSD' }).state;
  }
  assert.equal(state.observations.length, 5);
  assert.equal(state.reviewQueue.length, 1);
  assert.equal(state.reviewQueue[0].status, 'needs_human_review');
  assert.equal(state.reviewQueue[0].discountPct, 30);
});

test('중복 상품 ID는 원본 기록만 남기고 후보 평가에서 제외한다', () => {
  let state = emptyState();
  for (const time of ['2026-09-29T00:00:00Z', '2026-09-30T00:00:00Z', '2026-09-30T12:00:00Z']) {
    state = observe(state, [item(100)], { observedAt: time, keyword: 'SSD' }).state;
  }
  const result = observe(state, [item(50), item(40, { isRocket: false })],
    { observedAt: '2026-10-01T00:00:00Z', keyword: 'SSD' });
  assert.equal(result.stats.ambiguousRows, 2);
  assert.equal(result.stats.queued, 0);
  assert.equal(result.state.observations.filter((row) => row.ambiguous).length, 2);
});

test('잘못된 이전 기록은 덮어쓰지 않고 중단한다', () => {
  assert.throws(() => observe({ version: 2, observations: [], reviewQueue: [] }, [item(50)],
    { observedAt: '2026-10-01T00:00:00Z', keyword: 'SSD' }), /형식/);
});
