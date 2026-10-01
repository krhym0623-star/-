export const DEFAULT_RULES = Object.freeze({
  minObservations: 3,
  hotDealDiscountPct: 15,
  strongBuyDiscountPct: 30,
  priceErrorDiscountPct: 50,
  priceErrorConfirmations: 2,
});

export function median(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

export function offerKey(item) {
  const vendorItemId = String(item?.vendorItemId ?? '').trim();
  const itemId = String(item?.itemId ?? '').trim();
  const productId = String(item?.productId ?? '').trim();
  if (vendorItemId) return `vendor:${vendorItemId}`;
  if (itemId) return `item:${itemId}`;
  if (productId) return `product:${productId}`;
  return null;
}

export function evaluateDeal({ currentPrice, history = [], confirmations = 1, rules = DEFAULT_RULES }) {
  if (!Number.isFinite(currentPrice) || currentPrice < 0) throw new Error('현재 가격이 올바르지 않습니다.');
  const prices = history.map((entry) => Number(entry?.price ?? entry)).filter((price) => Number.isFinite(price) && price >= 0);
  if (prices.length < rules.minObservations) {
    return { tier: 'insufficient_history', discountPct: null, medianPrice: median(prices), allTimeLow: false };
  }
  const medianPrice = median(prices);
  const discountPct = medianPrice > 0 ? ((medianPrice - currentPrice) / medianPrice) * 100 : 0;
  const allTimeLow = currentPrice < Math.min(...prices);
  let tier = 'normal';
  if (discountPct >= rules.priceErrorDiscountPct) {
    tier = confirmations >= rules.priceErrorConfirmations ? 'suspected_price_error' : 'needs_confirmation';
  } else if (allTimeLow && discountPct >= rules.strongBuyDiscountPct) {
    tier = 'strong_buy';
  } else if (discountPct >= rules.hotDealDiscountPct) {
    tier = 'hot_deal';
  } else if (allTimeLow) {
    tier = 'all_time_low';
  }
  return { tier, discountPct: Number(discountPct.toFixed(2)), medianPrice, allTimeLow };
}

export function alertKey({ offerKey: key, price, channel }) {
  if (!key || !Number.isFinite(price) || !channel) throw new Error('알림 중복키 입력값을 확인하세요.');
  return `${channel}:${key}:${price}`;
}
