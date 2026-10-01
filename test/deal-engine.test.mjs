import test from 'node:test';
import assert from 'node:assert/strict';
import { alertKey, evaluateDeal, median, offerKey } from '../src/deal-engine.mjs';

test('offerKey는 가장 구체적인 판매 옵션 식별자를 우선한다', () => {
  assert.equal(offerKey({ vendorItemId: 30, itemId: 20, productId: 10 }), 'vendor:30');
  assert.equal(offerKey({ itemId: 20, productId: 10 }), 'item:20');
  assert.equal(offerKey({ productId: 10 }), 'product:10');
  assert.equal(offerKey({}), null);
});

test('중앙값을 계산한다', () => {
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([100, 200]), 150);
});

test('이력 부족 상품을 역대최저가로 오인하지 않는다', () => {
  assert.equal(evaluateDeal({ currentPrice: 50, history: [100, 100] }).tier, 'insufficient_history');
});

test('가격오류 후보는 두 번째 확인 전 자동 확정하지 않는다', () => {
  const first = evaluateDeal({ currentPrice: 40, history: [100, 100, 100], confirmations: 1 });
  const second = evaluateDeal({ currentPrice: 40, history: [100, 100, 100], confirmations: 2 });
  assert.equal(first.tier, 'needs_confirmation');
  assert.equal(second.tier, 'suspected_price_error');
});

test('같은 상품·가격·채널은 같은 중복키를 만든다', () => {
  assert.equal(alertKey({ offerKey: 'vendor:1', price: 9900, channel: 'review' }), 'review:vendor:1:9900');
});
