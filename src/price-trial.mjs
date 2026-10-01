import { pathToFileURL } from 'node:url';
import { authorization } from './deeplink.mjs';

export const SEARCH_PATH = '/v2/providers/affiliate_open_api/apis/openapi/products/search';
export const INTERVAL_MS = 5 * 60 * 1000;
export const ROUNDS = 3;

export async function searchProducts({ accessKey, secretKey, keyword, fetcher = fetch }) {
  if (!accessKey || !secretKey) throw new Error('파트너스 API 키 두 개가 필요합니다.');
  if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 80) throw new Error('검색어를 확인하세요.');
  const query = `keyword=${encodeURIComponent(keyword.trim())}&limit=10`;
  const pathAndQuery = `${SEARCH_PATH}?${query}`;
  const response = await fetcher(`https://api-gateway.coupang.com${pathAndQuery}`, {
    method: 'GET',
    headers: { Authorization: authorization(accessKey, secretKey, 'GET', SEARCH_PATH + query, new Date()) },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`상품 검색 API HTTP ${response.status}. 추가 호출을 중단합니다.`);
  const result = await response.json();
  const raw = result?.data?.productData;
  if (String(result?.rCode) !== '0' || !Array.isArray(raw)) {
    throw new Error(`상품 검색 응답 오류 (API 코드: ${String(result?.rCode ?? '없음').slice(0, 20)}). 추가 호출을 중단합니다.`);
  }
  return raw.flatMap((item) => {
    const price = Number(item?.productPrice);
    const id = String(item?.productId ?? '');
    if (!id || !Number.isFinite(price) || price < 0) return [];
    return [{ productId: id, productName: String(item?.productName ?? '').slice(0, 180), price,
      isRocket: item?.isRocket === true || item?.isRocket === 1, rank: Number(item?.rank) || null }];
  });
}

export async function runTrial({ accessKey, secretKey, keyword, search = searchProducts,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date(), onSnapshot = () => {} }) {
  const previous = new Map();
  const snapshots = [];
  for (let round = 1; round <= ROUNDS; round++) {
    if (round > 1) await wait(INTERVAL_MS);
    const products = await search({ accessKey, secretKey, keyword });
    const observedAt = now().toISOString();
    let matched = 0;
    const changes = [];
    // Search results can contain several offers with the same productId, but
    // this API response does not provide a stable option ID. Do not compare
    // such rows against another offer or another round.
    const counts = new Map();
    for (const item of products) counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
    const unique = products.filter((item) => counts.get(item.productId) === 1);
    for (const item of unique) {
      const before = previous.get(item.productId);
      if (before !== undefined) {
        matched++;
        if (before !== item.price) changes.push({ productId: item.productId, before, after: item.price });
      }
    }
    const snapshot = { round, observedAt, keyword, count: products.length,
      ambiguousRows: products.length - unique.length, matched,
      changes, products };
    snapshots.push(snapshot);
    onSnapshot(snapshot);
    previous.clear();
    for (const item of unique) previous.set(item.productId, item.price);
  }
  return snapshots;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const fs = await import('node:fs/promises');
    const snapshots = await runTrial({
      accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
      keyword: process.env.COUPANG_KEYWORD || '삼성 SSD 1TB',
      onSnapshot: (s) => console.log(`회차 ${s.round}: ${s.count}개 결과, 옵션 구분 불가 ${s.ambiguousRows}행, 이전 회차와 비교 가능 ${s.matched}개, 가격 변경 ${s.changes.length}개`),
    });
    await fs.mkdir('trial-output', { recursive: true });
    await fs.writeFile('trial-output/snapshots.json', JSON.stringify(snapshots, null, 2) + '\n');
    console.log('총 3회 완료. 전체 기록은 실행 결과의 snapshots 아티팩트에서 확인하세요.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : '알 수 없는 오류');
    process.exitCode = 1;
  }
}
