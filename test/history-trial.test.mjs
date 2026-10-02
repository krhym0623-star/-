import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState, observe, checkBudget, runHistoryTrial, MAX_CALLS_PER_DAY, MIN_INTERVAL_MS } from '../src/history-trial.mjs';

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

test('1시간 간격과 24시간 8회 제한을 API 요청 전에 검사한다', () => {
  const start = Date.parse('2026-10-01T00:00:00Z');
  const state = emptyState();
  state.runs.push({ observedAt: new Date(start).toISOString(), rows: 0 });
  assert.throws(() => checkBudget(state, new Date(start + MIN_INTERVAL_MS - 1)), /1시간/);
  assert.doesNotThrow(() => checkBudget(state, new Date(start + MIN_INTERVAL_MS)));
  for (let i = 1; i < MAX_CALLS_PER_DAY; i++) {
    state.runs.push({ observedAt: new Date(start + i * MIN_INTERVAL_MS).toISOString(), rows: 0 });
  }
  assert.throws(() => checkBudget(state, new Date(start + 8 * MIN_INTERVAL_MS)), /8회/);
  assert.doesNotThrow(() => checkBudget(state, new Date(start + 24 * MIN_INTERVAL_MS)));
});

test('연속 수동 실행을 막을 때 실제 검색 API를 호출하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coupon-history-'));
  try {
    const state = emptyState();
    state.runs.push({ observedAt: '2026-10-01T00:00:00Z', rows: 0 });
    const stateFile = join(dir, 'state.json');
    await writeFile(stateFile, JSON.stringify(state));
    let calls = 0;
    await assert.rejects(runHistoryTrial({ stateFile, keyword: 'SSD',
      now: () => new Date('2026-10-01T00:30:00Z'),
      search: async () => { calls++; return [item(50)]; } }), /1시간/);
    assert.equal(calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('자동 순환은 아직 관측하지 않은 다음 품목을 API에 한 번 전달한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coupon-history-'));
  try {
    const state = emptyState();
    state.runs.push({ observedAt: '2026-10-01T00:00:00Z', keyword: '삼성 SSD 1TB', rows: 10 });
    const stateFile = join(dir, 'state.json');
    await writeFile(stateFile, JSON.stringify(state));
    const keywords = [];
    const stats = await runHistoryTrial({ stateFile, keyword: '자동 순환',
      now: () => new Date('2026-10-01T01:00:00Z'),
      search: async ({ keyword }) => { keywords.push(keyword); return [item(50)]; } });
    assert.deepEqual(keywords, ['외장 SSD 1TB']);
    assert.equal(stats.keyword, '외장 SSD 1TB');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('품목 확대용 지표는 검색어 사이의 중복 ID와 재관측 가능 ID를 구분한다', () => {
  let state = observe(emptyState(), [item(100), item(90, { productId: '2' }),
    item(80, { productId: '3' }), item(70, { productId: '3' })],
  { observedAt: '2026-10-01T00:00:00Z', keyword: 'SSD' }).state;
  let result = observe(state, [item(95), item(60, { productId: '4' })],
    { observedAt: '2026-10-02T00:00:00Z', keyword: 'SSD' });
  assert.deepEqual(result.stats.coverage, {
    uniqueProductIds: 4, newProductIds: 1, reobservedProductIds: 1,
    repeatableProductIds: 1, perKeyword: { SSD: 4 },
  });
  state = result.state;
  result = observe(state, [item(92), item(50, { productId: '5' })],
    { observedAt: '2026-10-03T00:00:00Z', keyword: '외장 SSD' });
  assert.deepEqual(result.stats.coverage, {
    uniqueProductIds: 5, newProductIds: 1, reobservedProductIds: 1,
    repeatableProductIds: 1, perKeyword: { SSD: 4, '외장 SSD': 2 },
  });
  assert.equal(result.stats.ambiguousRows, 0);
  assert.equal(state.observations.filter((row) => row.ambiguous).length, 2);
});
