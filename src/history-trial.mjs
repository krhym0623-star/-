import { pathToFileURL } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { searchProducts } from './price-trial.mjs';
import { median } from './deal-engine.mjs';
import { AUTO_KEYWORD, selectKeyword } from './keyword-pool.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const MIN_INTERVAL_MS = HOUR_MS;
export const MAX_CALLS_PER_DAY = 8;
export const emptyState = () => ({ version: 1, observations: [], reviewQueue: [], runs: [] });

export function validateState(state) {
  if (state?.version !== 1 || !Array.isArray(state.observations) || !Array.isArray(state.reviewQueue) ||
    (state.runs !== undefined && !Array.isArray(state.runs))) {
    throw new Error('이전 기록 형식이 올바르지 않습니다. 기록을 덮어쓰지 않습니다.');
  }
}

export function checkBudget(state, now) {
  validateState(state);
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('관측 시각이 올바르지 않습니다.');
  const priorRuns = [...new Set((state.runs ?? state.observations).map((row) => row.observedAt))]
    .map((value) => Date.parse(value));
  if (priorRuns.some((value) => !Number.isFinite(value) || value > timestamp)) {
    throw new Error('이전 기록의 시각이 올바르지 않습니다. API 요청을 중단합니다.');
  }
  const recent = priorRuns.filter((value) => timestamp - value < DAY_MS);
  if (recent.length >= MAX_CALLS_PER_DAY) throw new Error('24시간 관측 한도 8회에 도달했습니다. API 요청을 중단합니다.');
  if (recent.length && timestamp - Math.max(...recent) < MIN_INTERVAL_MS) {
    throw new Error('직전 관측 후 1시간이 지나지 않았습니다. API 요청을 중단합니다.');
  }
}

export function summarizeCoverage(state, currentKeyword, currentObservedAt) {
  validateState(state);
  const uniqueIds = new Set();
  const previousIds = new Set();
  const currentIds = new Set();
  const appearances = new Map();
  const keywords = new Map();
  for (const row of state.observations) {
    const id = String(row.productId ?? '').trim();
    if (!id) continue;
    uniqueIds.add(id);
    const keyword = String(row.keyword ?? '');
    if (!keywords.has(keyword)) keywords.set(keyword, new Set());
    keywords.get(keyword).add(id);
    if (row.observedAt === currentObservedAt && keyword === currentKeyword) currentIds.add(id);
    else previousIds.add(id);
    if (row.ambiguous) continue;
    const key = JSON.stringify([keyword, id, row.isRocket === true]);
    if (!appearances.has(key)) appearances.set(key, { id, times: new Set() });
    appearances.get(key).times.add(row.observedAt);
  }
  return {
    uniqueProductIds: uniqueIds.size,
    newProductIds: [...currentIds].filter((id) => !previousIds.has(id)).length,
    reobservedProductIds: [...currentIds].filter((id) => previousIds.has(id)).length,
    repeatableProductIds: new Set([...appearances.values()]
      .filter(({ times }) => times.size >= 2).map(({ id }) => id)).size,
    perKeyword: Object.fromEntries([...keywords].map(([keyword, ids]) => [keyword, ids.size])),
  };
}

export function observe(state, products, { observedAt, keyword }) {
  validateState(state);
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
          const key = 'product:' + record.productId + ':' + record.price;
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
  const runs = state.runs ?? [...new Set(state.observations.map((row) => row.observedAt))]
    .map((time) => ({ observedAt: time, keyword: null, rows: state.observations.filter((row) => row.observedAt === time).length }));
  const nextState = { version: 1, observations, reviewQueue,
    runs: [...runs, { observedAt, keyword, rows: products.length, ambiguousRows }] };
  return { state: nextState,
    stats: { keyword, rows: products.length, ambiguousRows, comparable, queued,
      observations: observations.length, pendingReview: reviewQueue.length,
      coverage: summarizeCoverage(nextState, keyword, observedAt) } };
}

export async function runHistoryTrial({ accessKey, secretKey, keyword = AUTO_KEYWORD,
  stateFile = 'history-output/state.json', search = searchProducts, now = () => new Date() }) {
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    state = emptyState();
  }
  const observedAt = now();
  checkBudget(state, observedAt);
  const selectedKeyword = selectKeyword(state, keyword);
  const products = await search({ accessKey, secretKey, keyword: selectedKeyword });
  const result = observe(state, products, { observedAt: observedAt.toISOString(), keyword: selectedKeyword });
  await mkdir('history-output', { recursive: true });
  await writeFile(stateFile, JSON.stringify(result.state, null, 2) + '\n', { flag: 'w' });
  return result.stats;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const stats = await runHistoryTrial({ accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
      keyword: process.env.COUPANG_KEYWORD || AUTO_KEYWORD });
    console.log(JSON.stringify(stats));
    console.log('후보는 수동 검토용이며 카카오톡으로 발송하지 않습니다.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : '관측 실패');
    process.exitCode = 1;
  }
}
