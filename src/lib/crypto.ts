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
