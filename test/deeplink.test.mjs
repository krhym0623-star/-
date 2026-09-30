import test from 'node:test';
import assert from 'node:assert/strict';
import { authorization, createDeeplink, signedDate, validatedCoupangUrl, ENDPOINT } from '../src/deeplink.mjs';

test('서명 날짜와 HMAC 형식', () => {
  const date = new Date('2026-01-02T03:04:05Z');
  assert.equal(signedDate(date), '260102T030405Z');
  assert.match(authorization('access', 'secret', 'POST', ENDPOINT, date), /^CEA algorithm=HmacSHA256, access-key=access, signed-date=260102T030405Z, signature=[a-f0-9]{64}$/);
});

test('허용되지 않은 URL 거부', () => {
  assert.throws(() => validatedCoupangUrl('https://coupang.com.evil.example/item'), /coupang.com/);
  assert.throws(() => validatedCoupangUrl('http://www.coupang.com/item'), /coupang.com/);
});

test('딥링크 응답에서 변환된 URL 추출', async () => {
  const link = await createDeeplink({
    accessKey: 'access', secretKey: 'secret', coupangUrl: 'https://www.coupang.com/np/coupangglobal',
    fetcher: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { coupangUrls: ['https://www.coupang.com/np/coupangglobal'] });
      return { ok: true, json: async () => ({ rCode: '0', data: [{ shortenUrl: 'https://coupa.ng/example' }] }) };
    },
  });
  assert.equal(link, 'https://coupa.ng/example');
});
