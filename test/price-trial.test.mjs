import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts, runTrial, INTERVAL_MS } from '../src/price-trial.mjs';

test('검색 요청을 서명하고 가격만 정규화한다', async () => {
  let called = 0;
  const products = await searchProducts({ accessKey: 'a', secretKey: 'b', keyword: '삼성 SSD', fetcher: async (url, options) => {
    called++;
    assert.match(url, /keyword=%EC%82%BC%EC%84%B1%20SSD&limit=10$/);
    assert.match(options.headers.Authorization, /access-key=a/);
    return { ok: true, json: async () => ({ rCode: '0', data: { productData: [
      { productId: 123, productName: 'SSD', productPrice: 10000, isRocket: 1 },
      { productId: 124, productPrice: 'invalid' },
    ] } }) };
  } });
  assert.equal(called, 1);
  assert.deepEqual(products, [{ productId: '123', productName: 'SSD', price: 10000, isRocket: true, rank: null }]);
});

test('API 실패 시 재시도하거나 다음 회차를 호출하지 않는다', async () => {
  let calls = 0;
  await assert.rejects(runTrial({ keyword: 'test', search: async () => { calls++; throw new Error('HTTP 429'); },
    wait: () => { throw new Error('wait must not run'); } }), /HTTP 429/);
  assert.equal(calls, 1);
});

test('정확히 3회, 두 번의 5분 대기 후 같은 상품의 가격만 비교한다', async () => {
  const waits = [];
  let calls = 0;
  const snapshots = await runTrial({ keyword: 'test', wait: async (ms) => waits.push(ms),
    search: async () => [{ productId: '1', price: calls++ === 0 ? 1000 : 900 }],
    now: () => new Date('2026-09-30T00:00:00Z') });
  assert.deepEqual(waits, [INTERVAL_MS, INTERVAL_MS]);
  assert.equal(calls, 3);
  assert.deepEqual(snapshots.map(s => s.changes.length), [0, 1, 0]);
});
