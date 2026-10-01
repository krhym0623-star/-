import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { median } from './deal-engine.mjs';

const DAY_MS = 86_400_000;

// An offline report: no API requests, external messages, or price assertions.
export function buildReviewReport(state) {
  if (state?.version !== 1 || !Array.isArray(state.observations) || !Array.isArray(state.runs)) {
    throw new Error('가격 관측 기록 형식을 확인하세요.');
  }
  const groups = new Map();
  let ambiguousRows = 0;
  for (const row of state.observations) {
    if (row.ambiguous) { ambiguousRows++; continue; }
    const time = Date.parse(row.observedAt);
    if (!row.productId || !row.keyword || !Number.isFinite(time) ||
      !Number.isFinite(row.price) || row.price < 0) continue;
    const key = JSON.stringify([String(row.productId), row.keyword, row.isRocket === true]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const candidates = [];
  let reappeared = 0;
  let priceChanges = 0;
  for (const rows of groups.values()) {
    rows.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    if (rows.length > 1) reappeared++;
    for (let i = 1; i < rows.length; i++) if (rows[i].price !== rows[i - 1].price) priceChanges++;
    const current = rows.at(-1);
    const prior = rows.slice(0, -1);
    if (prior.length < 3 || Date.parse(current.observedAt) - Date.parse(prior[0].observedAt) < DAY_MS) continue;
    const reference = median(prior.map((row) => row.price));
    if (!(reference > 0)) continue;
    const discountPct = (reference - current.price) / reference * 100;
    if (discountPct < 15 || current.price >= Math.min(...prior.map((row) => row.price))) continue;
    candidates.push({ productId: String(current.productId), keyword: current.keyword,
      productName: current.productName, observedAt: current.observedAt, price: current.price,
      referencePrice: reference, discountPct: Number(discountPct.toFixed(2)),
      observedMinimum: Math.min(...prior.map((row) => row.price)),
      isRocket: current.isRocket === true, productUrl: current.productUrl,
      status: 'needs_human_review', reason: 'option_identity_unverified' });
  }
  candidates.sort((a, b) => b.discountPct - a.discountPct || a.productId.localeCompare(b.productId));
  return { coverage: { apiCalls: state.runs.length, observations: state.observations.length,
    unambiguousGroups: groups.size, reappearedGroups: reappeared, ambiguousRows,
    observedPriceChanges: priceChanges, candidates: candidates.length }, candidates,
    note: '관측된 검색 결과만 집계. 전체 상품·실시간 가격·옵션별 가격·역대최저가를 보증하지 않음.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = process.argv[2] ?? 'history-output/state.json';
    const report = buildReviewReport(JSON.parse(await readFile(input, 'utf8')));
    if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
    else console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '보고서 생성 실패');
    process.exitCode = 1;
  }
}
