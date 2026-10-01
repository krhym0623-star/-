import { authorization } from './deeplink.mjs';
import { SEARCH_PATH } from './price-trial.mjs';

const CANDIDATE_FIELDS = ['productId', 'vendorItemId', 'itemId', 'productUrl'];

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function summarizeSchema(products) {
  if (!Array.isArray(products)) throw new Error('상품 배열이 아닙니다.');
  const fields = [...new Set(products.flatMap((item) => Object.keys(item ?? {})))].sort();
  const identity = Object.fromEntries(CANDIDATE_FIELDS.map((field) => [field, {
    present: products.filter((item) => present(item?.[field])).length,
    distinct: new Set(products.filter((item) => present(item?.[field])).map((item) => String(item[field]))).size,
  }]));
  const byProductId = new Map();
  for (const item of products) {
    if (!present(item?.productId)) continue;
    const id = String(item.productId);
    if (!byProductId.has(id)) byProductId.set(id, []);
    byProductId.get(id).push(item);
  }
  const duplicates = [...byProductId.values()].filter((items) => items.length > 1).map((items) => ({
    rows: items.length,
    distinctPrices: new Set(items.map((item) => String(item.productPrice ?? ''))).size,
    distinctRocketFlags: new Set(items.map((item) => String(item.isRocket ?? ''))).size,
    distinctVendorItemIds: new Set(items.filter((item) => present(item.vendorItemId)).map((item) => String(item.vendorItemId))).size,
    distinctItemIds: new Set(items.filter((item) => present(item.itemId)).map((item) => String(item.itemId))).size,
    distinctProductUrls: new Set(items.filter((item) => present(item.productUrl)).map((item) => String(item.productUrl))).size,
  }));
  return {
    rows: products.length,
    fields,
    identity,
    deliveryFields: fields.filter((field) => /rocket|delivery|shipping/i.test(field)),
    duplicateProductGroups: duplicates,
  };
}

export async function probe({ accessKey, secretKey, keyword = '삼성 SSD 1TB', fetcher = fetch }) {
  if (!accessKey || !secretKey) throw new Error('파트너스 API 키가 필요합니다.');
  const query = `keyword=${encodeURIComponent(keyword)}&limit=10`;
  const response = await fetcher(`https://api-gateway.coupang.com${SEARCH_PATH}?${query}`, {
    method: 'GET',
    headers: { Authorization: authorization(accessKey, secretKey, 'GET', SEARCH_PATH + query, new Date()) },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`상품 검색 API HTTP ${response.status}`);
  const body = await response.json();
  if (String(body?.rCode) !== '0' || !Array.isArray(body?.data?.productData)) {
    throw new Error('상품 검색 응답 형식 오류');
  }
  return summarizeSchema(body.data.productData);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const summary = await probe({
      accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '진단 실패');
    process.exitCode = 1;
  }
}
