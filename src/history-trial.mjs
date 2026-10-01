import { pathToFileURL } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { searchProducts } from './price-trial.mjs';
import { median } from './deal-engine.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
export const emptyState = () => ({ version: 1, observations: [], reviewQueue: [] });

export function observe(state, products, { observedAt, keyword }) {
  if (state?.version !== 1 || !Array.isArray(state.observations) || !Array.isArray(state.reviewQueue)) {
    throw new Error('이전 기록 형식이 올바르지 않습니다. 기록을 덮어쓰지 않습니다.');
  }
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) throw new Error('관측 시각이 올바르지 않습니다.');
  const counts = new Map();
  for (const item of products) counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
  const observations = [...state.observations];
  const reviewQueue = [...state.reviewQueue];
  let ambiguousRows = 0;
  let comparable = 0;
  let queued = 0;
  for (const item of products) {
    if (!item.productId || !Number.isFinite(item.price) || item.price < 0) continue;
    const ambiguous = counts.get(item.productId) !== 1;
    const record = {
      productId: String(item.productId), observedAt, keyword, price: item.price,
      productName: item.productName ?? '', rank: item.rank ?? null,
      isRocket: item.isRocket === true, isFreeShipping: item.isFreeShipping === true,
      productUrl: item.productUrl ?? null, ambiguous,
    };
    if (ambiguous) ambiguousRows++;
    if (!ambiguous) {
      const prior = observations.filter((row) => !row.ambiguous && row.productId === record.productId &&
        row.keyword === keyword && row.isRocket === record.isRocket && Date.parse(row.observedAt) < timestamp);
      if (prior.length >= 3 && timestamp - Math.min(...prior.map((row) => Date.parse(row.observedAt))) >= DAY_MS) {
        comparable++;
        const middle = median(prior.map((row) => row.price));
        const discountPct = middle > 0 ? (middle - record.price) / middle * 100 : 0;
        if (discountPct >= 15 && record.price < Math.min(...prior.map((row) => row.price))) {
          // Product ID is not a stable option ID in this API. Queue for human
          // checking; never call this a verified deal or post it automatically.
          const key = `product:${record.productId}:${record.price}`;
          if (!reviewQueue.some((entry) => entry.key === key)) {
            reviewQueue.push({ key, observedAt, keyword, productName: record.productName,
              price: record.price, baselineMedian: middle,
              discountPct: Number(discountPct.toFixed(2)), productUrl: record.productUrl,
              status: 'needs_human_review', reason: 'option_identity_unverified' });
            queued++;
          }
        }
      }
    }
    observations.push(record);
  }
  return { state: { version: 1, observations, reviewQueue },
    stats: { rows: products.length, ambiguousRows, comparable, queued,
      observations: observations.length, pendingReview: reviewQueue.length } };
}

export async function runHistoryTrial({ accessKey, secretKey, keyword, stateFile = 'history-output/state.json',
  search = searchProducts, now = () => new Date() }) {
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    state = emptyState();
  }
  // Only one API call. Never overwrite state if the request or validation fails.
  const products = await search({ accessKey, secretKey, keyword });
  const result = observe(state, products, { observedAt: now().toISOString(), keyword });
  await mkdir('history-output', { recursive: true });
  await writeFile(stateFile, JSON.stringify(result.state, null, 2) + '\n', { flag: 'w' });
  return result.stats;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const stats = await runHistoryTrial({ accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
      keyword: process.env.COUPANG_KEYWORD || '삼성 SSD 1TB' });
    console.log(JSON.stringify(stats));
    console.log('후보는 수동 검토용이며 카카오톡으로 발송하지 않습니다.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : '관측 실패');
    process.exitCode = 1;
  }
}
