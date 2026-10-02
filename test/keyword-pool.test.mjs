import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_KEYWORD, KEYWORD_POOL, selectKeyword } from '../src/keyword-pool.mjs';

test('관측하지 않은 품목을 목록 순서대로 고른다', () => {
  const state = { runs: [{ keyword: KEYWORD_POOL[0], observedAt: '2026-10-01T00:00:00Z' }] };
  assert.equal(selectKeyword(state, AUTO_KEYWORD), KEYWORD_POOL[1]);
});

test('모든 품목을 관측했다면 가장 오래된 품목을 고른다', () => {
  const runs = KEYWORD_POOL.map((keyword, index) => ({ keyword,
    observedAt: new Date(Date.parse('2026-10-01T00:00:00Z') + index * 1000).toISOString() }));
  assert.equal(selectKeyword({ runs }, AUTO_KEYWORD), KEYWORD_POOL[0]);
});

test('직접 입력한 검색어는 자동 목록보다 우선한다', () => {
  assert.equal(selectKeyword({ runs: [] }, '  에어프라이어  '), '에어프라이어');
});

test('중복되거나 비어 있는 자동 목록은 거부한다', () => {
  assert.throws(() => selectKeyword({ runs: [] }, AUTO_KEYWORD, ['SSD', 'SSD']), /중복/);
  assert.throws(() => selectKeyword({ runs: [] }, AUTO_KEYWORD, []), /확인/);
});
