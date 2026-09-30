import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const ENDPOINT = '/v2/providers/affiliate_open_api/apis/openapi/deeplink';

export function signedDate(date = new Date()) {
  return `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
}

export function authorization(accessKey, secretKey, method, path, date) {
  const stamp = signedDate(date);
  const signature = createHmac('sha256', secretKey)
    .update(`${stamp}${method}${path}`)
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${stamp}, signature=${signature}`;
}

export function validatedCoupangUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['coupang.com', 'www.coupang.com'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('https://www.coupang.com 주소만 입력하세요.');
  }
  return url.toString();
}

export async function createDeeplink({ accessKey, secretKey, coupangUrl, fetcher = fetch }) {
  if (!accessKey || !secretKey) throw new Error('GitHub Actions Secrets에 파트너스 API 키 두 개를 등록하세요.');
  const originalUrl = validatedCoupangUrl(coupangUrl);
  const response = await fetcher(`https://api-gateway.coupang.com${ENDPOINT}`, {
    method: 'POST',
    headers: {
      Authorization: authorization(accessKey, secretKey, 'POST', ENDPOINT, new Date()),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ coupangUrls: [originalUrl] }),
    signal: AbortSignal.timeout(15000),
  });
  // API 오류 본문에는 요청 정보가 포함될 수 있어 로그에 그대로 표시하지 않는다.
  if (!response.ok) throw new Error(`파트너스 API HTTP ${response.status}. 파트너스 키와 API 권한을 확인하세요.`);
  const result = await response.json();
  const link = result?.data?.[0]?.shortenUrl;
  if (String(result?.rCode) !== '0' || typeof link !== 'string' || !/^https:\/\//.test(link)) {
    throw new Error(`링크 변환 실패 (API 코드: ${String(result?.rCode ?? '없음').slice(0, 20)}). 파트너스 API 권한을 확인하세요.`);
  }
  return link;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const link = await createDeeplink({
      accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
      coupangUrl: process.env.COUPANG_URL,
    });
    console.log(`파트너스 링크: ${link}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '알 수 없는 오류');
    process.exitCode = 1;
  }
}
