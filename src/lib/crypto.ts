/**
 * Generate a cryptographically random URL-safe token.
 */
export function generateToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * SHA-256 hash with a random salt. Returns `salt:hash`.
 */
export async function hashPhone(phone: string, salt?: string): Promise<string> {
  const s = salt || generateToken(16);
  const data = new TextEncoder().encode(`${s}:${phone}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${s}:${hex}`;
}

/**
 * Verify a phone hash against a plaintext number.
 */
export async function verifyPhoneHash(
  storedHash: string,
  phone: string,
): Promise<boolean> {
  const [salt] = storedHash.split(':');
  const computed = await hashPhone(phone, salt);
  return computed === storedHash;
}

/**
 * Create a minimal HMAC-SHA256 JWT (no external deps).
 */
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec = 86400,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };

  const enc = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const bodyB64 = btoa(JSON.stringify(body)).replace(/=/g, '');
  const data = `${headerB64}.${bodyB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${data}.${sigB64}`;
}

/**
 * Verify and decode a JWT. Returns the payload or null if invalid.
 */
export async function verifyJwt<T = Record<string, unknown>>(
  token: string,
  secret: string,
): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  const enc = new TextEncoder();
  const data = `${headerB64}.${bodyB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Restore base64 padding
  const sigPadded = sigB64.replace(/-/g, '+').replace(/_/g, '/') + '==';
  const sigBytes = Uint8Array.from(atob(sigPadded), c => c.charCodeAt(0));

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
  if (!valid) return null;

  const bodyPadded = bodyB64.replace(/-/g, '+').replace(/_/g, '/') + '==';
  const payload = JSON.parse(atob(bodyPadded)) as T & { exp: number };

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
