import test from 'node:test';
import assert from 'node:assert/strict';
import { probe, summarizeSchema } from '../src/schema-probe.mjs';

test('중복 상품의 옵션 식별 가능성만 집계하고 원본 값은 출력하지 않는다', () => {
  const summary = summarizeSchema([
    { productId: 7, vendorItemId: 'secret-offer-a', productUrl: 'https://example.com/private-a', productPrice: 100, isRocket: false },
    { productId: 7, vendorItemId: 'secret-offer-b', productUrl: 'https://example.com/private-b', productPrice: 90, isRocket: true },
  ]);
  assert.equal(summary.rows, 2);
  assert.equal(summary.identity.vendorItemId.distinct, 2);
  assert.deepEqual(summary.duplicateProductGroups, [{
    rows: 2, distinctPrices: 2, distinctRocketFlags: 2,
    distinctVendorItemIds: 2, distinctItemIds: 0, distinctProductUrls: 2,
  }]);
  assert.equal(JSON.stringify(summary).includes('secret-offer'), false);
  assert.equal(JSON.stringify(summary).includes('example.com'), false);
});

test('정확히 한 번 요청하고 실패 응답을 재시도하지 않는다', async () => {
  let calls = 0;
  await assert.rejects(probe({ accessKey: 'a', secretKey: 'b', fetcher: async () => {
    calls++;
    return { ok: false, status: 429 };
  } }), /HTTP 429/);
  assert.equal(calls, 1);
});
