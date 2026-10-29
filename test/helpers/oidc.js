/** مُصدِر Microsoft مزيّف للاختبار: مفتاح RSA حقيقي، JWKS، وتوقيع id_token بنفس الخوارزمية (RS256). */
export const TENANT = '11111111-2222-3333-4444-555555555555';
export const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const enc = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export async function makeIssuer(kid = 'key-1') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, use: 'sig', alg: 'RS256' };

  async function sign(claims = {}, { header = {}, tamper = false } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      aud: CLIENT,
      tid: TENANT,
      iat: now,
      nbf: now - 5,
      exp: now + 3600,
      nonce: 'n-default',
      preferred_username: 'ahmad@nawaculture.org',
      ...claims,
    };
    const h = enc({ alg: 'RS256', typ: 'JWT', kid, ...header });
    const p = enc(payload);
    const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`))).toString('base64url');
    // tamper: نغيّر الحمولة بعد التوقيع
    return tamper ? `${h}.${enc({ ...payload, preferred_username: 'admin@nawaculture.org' })}.${sig}` : `${h}.${p}.${sig}`;
  }
  return { jwk, kid, sign, keys: [jwk] };
}

/** يستبدل fetch العام بنسخة تخدم JWKS لـ login.microsoftonline.com ويعدّ الطلبات. */
export function stubJwks(getKeys) {
  const original = globalThis.fetch;
  const stub = { calls: 0, restore: () => (globalThis.fetch = original) };
  globalThis.fetch = async (input) => {
    const u = String(input?.url || input);
    if (u.startsWith(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`)) {
      stub.calls++;
      return new Response(JSON.stringify({ keys: getKeys() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
  return stub;
}

export const unsigned = (claims) => `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.`;
export { enc };
