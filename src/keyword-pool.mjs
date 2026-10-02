export const AUTO_KEYWORD = '자동 순환';

// Eight calls per day means one observation per keyword when the full daily
// budget is used. Keep the pool small until duplicate and error rates are known.
export const KEYWORD_POOL = Object.freeze([
  '삼성 SSD 1TB',
  '외장 SSD 1TB',
  'microSD 512GB',
  'DDR5 32GB',
  '보조배터리 20000mAh',
  '65W GaN 충전기',
  '무선 이어폰',
  '로봇청소기',
]);

export function selectKeyword(state, requested = AUTO_KEYWORD, pool = KEYWORD_POOL) {
  const value = typeof requested === 'string' ? requested.trim() : '';
  if (value && value !== AUTO_KEYWORD) return value;
  if (!Array.isArray(pool) || !pool.length || pool.some((keyword) => typeof keyword !== 'string' || !keyword.trim())) {
    throw new Error('자동 순환 검색어 목록을 확인하세요.');
  }
  const unique = [...new Set(pool.map((keyword) => keyword.trim()))];
  if (unique.length !== pool.length) throw new Error('자동 순환 검색어가 중복되었습니다.');

  const lastSeen = new Map();
  for (const run of state?.runs ?? []) {
    if (!unique.includes(run.keyword)) continue;
    const time = Date.parse(run.observedAt);
    if (!Number.isFinite(time)) continue;
    lastSeen.set(run.keyword, Math.max(lastSeen.get(run.keyword) ?? -Infinity, time));
  }
  return unique.reduce((oldest, keyword) =>
    (lastSeen.get(keyword) ?? -Infinity) < (lastSeen.get(oldest) ?? -Infinity) ? keyword : oldest,
  unique[0]);
}
